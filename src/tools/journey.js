// Journey recorder: record form fills and clicks across a few pages, edit the
// steps, replay them. Both an in-progress recording and a pending run survive a
// hard navigation via sessionStorage and resume the moment BCC is re-injected —
// one keystroke per hard load. Can end by taking a checkpoint.

import { toast, el, highlighter, relativeTime } from '../core/overlay/ui.js';
import { journeys, basket } from '../core/store/store.js';
import { recordJourney, runJourney, loadPending, clearPending, savePending, PROMPT } from '../core/journey.js';
import { describeOrigin } from '../core/site.js';
import * as settings from '../app/settings.js';
import { onBoot } from '../app/main.js';
import { start as startTool } from '../app/registry.js';
import { download, pickFile, stamp, slug } from '../core/files.js';
import { copy } from '../core/clipboard.js';

const RECORDING_KEY = 'bcc:journey:recording';
const readRec = () => { try { const r = sessionStorage.getItem(RECORDING_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const writeRec = (state) => { try { sessionStorage.setItem(RECORDING_KEY, JSON.stringify(state)); } catch { /* ignore */ } };
const clearRec = () => { try { sessionStorage.removeItem(RECORDING_KEY); } catch { /* ignore */ } };

// Auto-resume: a pending run or an in-progress recording re-opens the tool.
onBoot((api) => {
  const pending = loadPending();
  const rec = readRec();
  if (pending || rec) setTimeout(() => { try { api.start('journey', { resume: pending, resumeRecording: rec }); } catch { /* toasted */ } }, 50);
});

const stepLabel = (s) => {
  const sel = s.selectors?.[0];
  const target = sel ? `${sel.kind}: ${sel.value}` : s.tag;
  if (s.action === 'input' || s.action === 'select') return `${s.action} "${s.askEachRun ? '‹ask each run›' : s.value}" → ${target}`;
  if (s.action === 'check') return `${s.value ? 'tick' : 'untick'} ${target}`;
  if (s.action === 'click') return `click ${s.text ? `"${s.text}"` : ''} (${target})`;
  if (s.action === 'submit') return `submit form ${s.implicit ? '(implicit, skipped on replay)' : ''}`;
  return `${s.action} ${target}`;
};

export default {
  id: 'journey',
  title: 'Journey recorder',
  desc: 'Record form fills and clicks across a few pages, edit, replay — resumes across hard navigations.',
  icon: '🧭',
  group: 'journeys',
  sites: ['web', '*'],
  keywords: ['record', 'replay', 'automation', 'forms', 'wizard', 'steps', 'macro'],

  start(ctx) {
    const p = ctx.panel({ width: 560, height: 520 });
    const here = describeOrigin(settings.get('envMap'));
    const hl = highlighter({ variant: 'hl--step' });

    let recorder = null;
    let steps = [];
    let current = null;                          // the journey being edited/run { id?, name, steps }
    let running = null;                          // { index, status }
    let endWithCheckpoint = false;
    let resolveFailure = null;
    let lastResult = null;

    const banner = el('div', { class: 'muted', style: 'margin-bottom:6px' });
    const stepsEl = el('div', { style: 'max-height:260px;overflow:auto' });
    const failureEl = el('div', { style: 'display:none;border:1px solid #f5c451;border-radius:8px;padding:8px;margin:6px 0' });
    const libraryEl = el('details', { style: 'margin-top:8px' });
    p.body.append(banner, stepsEl, failureEl, libraryEl);

    const persistRecording = () => writeRec({ steps: steps.map(({ _el, ...s }) => s), name: current?.name ?? '', startedAt: current?.startedAt ?? new Date().toISOString() });

    function startRecording({ keep = false } = {}) {
      if (recorder) return;
      if (!keep) { steps = []; current = { name: '', startedAt: new Date().toISOString() }; }
      recorder = recordJourney(() => { persistRecording(); renderSteps(); });
      // recordJourney keeps its own array; mirror it
      recorder.steps.push(...steps.map((s) => ({ ...s })));
      steps = recorder.steps;
      persistRecording();
      render();
    }
    function stopRecording() {
      if (!recorder) return steps;
      steps = recorder.stop();
      recorder = null;
      clearRec();
      render();
      return steps;
    }

    function renderSteps() {
      stepsEl.replaceChildren();
      const list = recorder ? recorder.steps : steps;
      if (!list.length) { stepsEl.append(el('div', { class: 'muted', style: 'padding:10px 0' }, recorder ? 'Recording — fill forms and click through the pages. Each page load: re-run BCC and recording carries on.' : 'No steps. Press Record, or open a saved journey below.')); return; }
      list.forEach((s, i) => {
        const state = running?.index === i ? running.status : null;
        const valueIn = (s.action === 'input' || s.action === 'select') ? el('input', { type: 'text', value: s.askEachRun ? '' : s.value ?? '', placeholder: s.askEachRun ? 'asked each run' : 'value', disabled: !!s.askEachRun, style: 'width:140px', onchange: (e) => { s.value = e.target.value; persistRecording(); } }) : null;
        stepsEl.append(el('div', { class: 'row item', style: `${s.implicit ? 'opacity:.55;' : ''}${state === 'done' ? 'background:#1c2a1e;' : state ? 'background:#2a2a1c;' : ''}` },
          el('span', { class: 'muted', style: 'width:22px;text-align:right' }, String(i + 1)),
          el('span', { style: 'width:16px' }, state === 'done' ? '✓' : state === 'waiting' ? '…' : state === 'failed' ? '✗' : ''),
          el('span', { class: 'grow ellipsis', title: `${stepLabel(s)}\n${s.url}\nselectors: ${(s.selectors ?? []).map((x) => `${x.kind}=${x.value}`).join(' | ')}` }, stepLabel(s)),
          valueIn,
          valueIn ? el('label', { class: 'row muted', title: 'Ask for this value every run (e.g. an invoice number that must differ)' }, el('input', { type: 'checkbox', checked: !!s.askEachRun, onchange: (e) => { s.askEachRun = e.target.checked; persistRecording(); renderSteps(); } }), 'ask') : null,
          el('button', { class: 'sm ghost', title: 'Move up', onclick: () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; persistRecording(); renderSteps(); } } }, '↑'),
          el('button', { class: 'sm ghost', title: 'Move down', onclick: () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; persistRecording(); renderSteps(); } } }, '↓'),
          el('button', { class: 'sm ghost danger', onclick: () => { list.splice(i, 1); persistRecording(); renderSteps(); } }, '✕'),
        ));
      });
    }

    function renderLibrary() {
      const list = journeys.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      libraryEl.replaceChildren(el('summary', {}, `Saved journeys (${list.length})`));
      for (const j of list) {
        libraryEl.append(el('div', { class: 'row item' },
          el('strong', { class: 'ellipsis', style: 'max-width:180px' }, j.name),
          el('span', { class: 'muted grow' }, `${j.app}${j.env && j.env !== 'unknown' ? `/${j.env}` : ''} · ${j.steps.length} steps · ${relativeTime(j.createdAt)}`),
          el('button', { class: 'sm primary', onclick: () => { load(j); replay(); } }, '▶ Run'),
          el('button', { class: 'sm', onclick: () => load(j) }, 'Open'),
          el('button', { class: 'sm', onclick: () => download(`journey-${slug(j.name)}-${stamp()}.json`, JSON.stringify({ kind: 'bcc-export', namespace: 'journeys', items: [j] }, null, 2)) }, 'Export'),
          el('button', { class: 'sm danger', onclick: () => { if (confirm(`Delete "${j.name}"?`)) journeys.remove(j.id); } }, '✕')));
      }
      libraryEl.append(el('div', { class: 'row', style: 'margin-top:6px' }, el('button', { class: 'sm', onclick: async () => { const f = await pickFile(); if (!f) return; try { const r = journeys.import(f.text); toast(`Imported ${r.added}`); } catch (err) { toast(err.message); } } }, 'Import journey file')));
    }

    function load(j) { stopRecording(); current = { ...j }; steps = j.steps.map((s) => ({ ...s })); running = null; render(); }

    function save() {
      const list = stopRecording();
      if (!list.length) return toast('Nothing to save');
      const name = prompt('Name this journey', current?.name || `${here.app} ${document.title}`.slice(0, 60));
      if (name == null) return null;
      const data = { kind: 'journey', name, app: here.app, env: here.env, startUrl: current?.startUrl ?? list[0]?.url ?? location.pathname, steps: list, createdAt: current?.createdAt ?? new Date().toISOString(), endWithCheckpoint };
      const saved = current?.id && journeys.get(current.id) ? journeys.update(current.id, data) : journeys.add(data);
      current = saved;
      toast(`Saved "${name}" (${list.length} steps)`);
      render();
      return saved;
    }

    const askFailure = (step, i, err) => new Promise((resolve) => {
      running = { index: i, status: 'failed' }; renderSteps();
      failureEl.style.display = 'block';
      failureEl.replaceChildren(
        el('div', { class: 'warn' }, `Step ${i + 1} failed: ${err.message}`),
        el('div', { class: 'muted', style: 'margin:4px 0' }, stepLabel(step)),
        el('div', { class: 'row' },
          el('button', { class: 'sm', onclick: () => finish('retry') }, 'Retry'),
          el('button', { class: 'sm', onclick: () => finish('skip') }, 'Skip'),
          el('button', { class: 'sm danger', onclick: () => finish('abort') }, 'Abort')));
      const finish = (choice) => { failureEl.style.display = 'none'; resolveFailure = null; resolve(choice); };
      resolveFailure = finish;
    });

    async function replay({ from = 0, values = {} } = {}) {
      stopRecording();
      if (!steps.length) return toast('No steps to replay');
      const journey = { id: current?.id ?? 'unsaved', steps, endWithCheckpoint };
      running = { index: from, status: 'waiting' };
      banner.textContent = `Replaying ${current?.name ?? 'journey'} from step ${from + 1}…`;
      const result = await runJourney(journey, {
        from, values, endWithCheckpoint,
        ask: async (step, i) => prompt(`Value for step ${i + 1}: ${stepLabel(step)}`, ''),
        onStep: (step, i, status) => { running = { index: i, status }; renderSteps(); },
        onFailure: ctx.options.onFailure ?? askFailure,
        highlight: (elm) => { try { hl.show(elm.getBoundingClientRect(), null); } catch { /* ignore */ } },
        timeout: ctx.options.timeout ?? 10000,
      });
      hl.hide();
      lastResult = result;
      if (result.ok) {
        banner.textContent = `✓ Journey complete (${steps.length} steps).`;
        if (endWithCheckpoint) { try { const cps = startTool('checkpoints'); cps.save({ journey: current?.name ?? 'journey', step: 'after replay', tags: ['journey'] }); toast('Journey done — checkpoint saved'); } catch { /* fine */ } }
        else toast('Journey complete');
      } else if (result.reason !== 'navigating') {
        banner.textContent = `✗ Stopped at step ${result.at + 1}: ${result.reason}`;
      }
      running = null; renderSteps();
      return result;
    }

    const recBtn = el('button', { class: 'primary' });
    recBtn.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));
    const endCp = el('input', { type: 'checkbox', checked: endWithCheckpoint, onchange: (e) => { endWithCheckpoint = e.target.checked; } });
    p.foot.append(
      recBtn,
      el('button', { onclick: () => replay() }, '▶ Replay'),
      el('button', { onclick: save }, 'Save'),
      el('label', { class: 'row muted', title: 'Take a checkpoint automatically when the replay finishes' }, endCp, 'end with checkpoint'),
      el('button', { onclick: () => { const list = recorder ? recorder.steps : steps; if (!list.length) return toast('Nothing to add'); basket.add({ kind: 'journey', name: current?.name ?? 'journey', steps: list.map(({ _el, ...s }) => s), url: location.href }); toast('Added to basket'); } }, 'Add to basket'),
      el('button', { onclick: async () => { await copy(JSON.stringify((recorder ? recorder.steps : steps).map(({ _el, ...s }) => s), null, 2)); toast('Steps JSON copied'); } }, 'Copy JSON'),
      el('button', { onclick: () => { stopRecording(); steps = []; current = null; running = null; clearPending(); render(); } }, 'Clear'),
    );

    function render() {
      recBtn.textContent = recorder ? '■ Stop recording' : '● Record';
      recBtn.className = recorder ? 'danger' : 'primary';
      if (recorder) banner.textContent = `● Recording on ${location.pathname}. Steps: ${recorder.steps.length}.`;
      else if (!running) banner.textContent = current?.name ? `Journey: ${current.name} (${steps.length} steps)` : `${steps.length} step(s). Scope: form fills, selects, ticks, clicks and submits — not a general automation engine.`;
      renderSteps(); renderLibrary();
    }

    const off = journeys.onChange(() => { if (!p.closed) renderLibrary(); });
    render();

    // --- resume paths ---------------------------------------------------------
    const { resume, resumeRecording } = ctx.options;
    if (resumeRecording?.steps) {
      steps = resumeRecording.steps; current = { name: resumeRecording.name, startedAt: resumeRecording.startedAt };
      startRecording({ keep: true });
      toast(`Journey recording resumed (${steps.length} steps so far)`);
    } else if (resume?.journeyId) {
      const j = journeys.get(resume.journeyId) ?? (resume.journeyId === 'unsaved' && resume.steps ? { steps: resume.steps } : null);
      if (j) {
        current = { ...j }; steps = j.steps.map((s) => ({ ...s })); endWithCheckpoint = !!resume.endWithCheckpoint; endCp.checked = endWithCheckpoint;
        toast(`Resuming journey at step ${resume.index + 1}`);
        setTimeout(() => replay({ from: resume.index, values: resume.values ?? {} }), 200);
      } else { clearPending(); toast('Pending journey not found — cleared'); }
    }

    return {
      stop(reason) {
        // On a hard navigation keep the in-progress recording so it resumes on the next page.
        if (reason === 'pagehide') { recorder?.stop(); recorder = null; } else stopRecording();
        off(); hl.destroy(); if (resolveFailure) resolveFailure('abort'); p.close();
      },
      record: startRecording, stopRecording, replay, save, load,
      get steps() { return recorder ? recorder.steps : steps; }, set steps(v) { steps = v; render(); },
      get result() { return lastResult; }, setEndWithCheckpoint: (on) => { endWithCheckpoint = on; endCp.checked = on; },
      // for unsaved journeys that cross a navigation, stash the steps in the pending record too
      persistUnsaved: () => savePending({ journeyId: 'unsaved', index: 0, steps, values: {} }),
      PROMPT,
    };
  },
};
