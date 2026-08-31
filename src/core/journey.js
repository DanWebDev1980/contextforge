// Journeys: record form fills and clicks across a few pages, replay them.
// Deliberately not an automation engine — forms and submits, that is all.
//
// Selector strategy (all computed at record time, replay falls through):
//   data-testid → label / aria-label → role + accessible name → id → short CSS path
// Password fields record ‹prompt› instead of the value and ask at replay.
// A run that crosses a hard navigation is persisted in sessionStorage and
// resumed the moment BCC is re-injected.

import { selectorFor } from '../adapters/web/inspect.js';

export const PENDING_KEY = 'bcc:journey:pending';
export const PROMPT = '‹prompt›';

const IMPLICIT_ROLES = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button', option: 'option' };
const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider', number: 'spinbutton', search: 'searchbox' };

export function roleOf(el) {
  const explicit = el.getAttribute?.('role');
  if (explicit) return explicit;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input') return INPUT_ROLES[el.type] ?? 'textbox';
  if (tag === 'a' && !el.hasAttribute('href')) return null;
  return IMPLICIT_ROLES[tag] ?? null;
}

/** A reasonable accessible name — enough to find the control again. */
export function accessibleName(el) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const aria = el.getAttribute?.('aria-label');
  if (aria) return clean(aria);
  const labelledBy = el.getAttribute?.('aria-labelledby');
  if (labelledBy) {
    const t = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    if (t) return clean(t);
  }
  if (el.labels?.length) return clean([...el.labels].map((l) => l.textContent).join(' '));
  const wrapping = el.closest?.('label');
  if (wrapping) return clean([...wrapping.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')) || clean(wrapping.textContent);
  if (/^(button|a|summary)$/i.test(el.tagName) || el.getAttribute?.('role') === 'button') return clean(el.textContent) || clean(el.getAttribute('title'));
  if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type)) return clean(el.value);
  if (el.alt) return clean(el.alt);
  if (el.placeholder) return clean(el.placeholder);
  if (el.title) return clean(el.title);
  return '';
}

/** Every selector we can compute, best first. */
export function selectorsFor(el) {
  const out = [];
  const testId = el.getAttribute?.('data-testid') || el.getAttribute?.('data-test-id') || el.getAttribute?.('data-test') || el.getAttribute?.('data-cy');
  if (testId) out.push({ kind: 'testid', value: testId });
  const name = accessibleName(el);
  const role = roleOf(el);
  if (name) out.push({ kind: 'label', value: name, tag: el.tagName.toLowerCase() });
  if (role && name) out.push({ kind: 'role', value: `${role}:${name}` });
  if (el.id && !/^\w*\d{3,}|^[a-f0-9]{8,}$/i.test(el.id)) out.push({ kind: 'id', value: el.id });
  if (el.name && el.form) out.push({ kind: 'name', value: `${el.tagName.toLowerCase()}[name="${el.name}"]` });
  const css = selectorFor(el);
  if (css) out.push({ kind: 'css', value: css });
  return out;
}

const visible = (el) => !!el && el.isConnected && !(el.offsetWidth === 0 && el.offsetHeight === 0 && !el.getClientRects().length);

/** Resolve a step's selectors against the live DOM, best strategy first. */
export function resolve(selectors, root = document) {
  for (const s of selectors ?? []) {
    let candidates = [];
    try {
      switch (s.kind) {
        case 'testid': candidates = [...root.querySelectorAll(`[data-testid="${s.value}"],[data-test-id="${s.value}"],[data-test="${s.value}"],[data-cy="${s.value}"]`)]; break;
        case 'label': candidates = [...root.querySelectorAll(s.tag ?? 'input,select,textarea,button,a,[role]')].filter((el) => accessibleName(el) === s.value); break;
        case 'role': { const [role, ...rest] = s.value.split(':'); const nm = rest.join(':'); candidates = [...root.querySelectorAll('*')].filter((el) => roleOf(el) === role && accessibleName(el) === nm); break; }
        case 'id': candidates = [root.getElementById?.(s.value) ?? root.querySelector(`#${CSS.escape(s.value)}`)].filter(Boolean); break;
        case 'name': case 'css': candidates = [...root.querySelectorAll(s.value)]; break;
        default: break;
      }
    } catch { candidates = []; }
    const hit = candidates.find(visible) ?? candidates[0];
    if (hit) return { el: hit, via: s.kind };
  }
  return null;
}

// --- recording ------------------------------------------------------------------

const isOurs = (t) => !!t?.closest?.('#bcc-root') || t?.getRootNode?.()?.host?.id === 'bcc-root';

/**
 * Start recording. Returns { steps, stop }. `onStep(step, steps)` fires as steps
 * are added or coalesced. Consecutive inputs on the same element collapse into
 * one step holding the final value.
 */
export function recordJourney(onStep = () => {}) {
  const steps = [];
  let lastClickAt = 0;
  const push = (step) => { steps.push(step); onStep(step, steps); };
  const targetOf = (e) => { const t = e.composedPath?.()[0] ?? e.target; return t?.nodeType === 1 ? t : t?.parentElement; };
  const describe = (el) => ({ selectors: selectorsFor(el), tag: el.tagName.toLowerCase(), type: el.type ?? null, url: location.pathname + location.search, at: new Date().toISOString() });

  const onInput = (e) => {
    const el = targetOf(e);
    if (!el || isOurs(el) || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return;   // handled by click / change
    const value = el.type === 'password' ? PROMPT : el.value;
    const last = steps[steps.length - 1];
    if (last && last.action === 'input' && last._el === el) { last.value = value; onStep(last, steps); return; }
    push({ action: 'input', value, ...describe(el), _el: el });
  };
  const onChange = (e) => {
    const el = targetOf(e);
    if (!el || isOurs(el)) return;
    if (el.tagName === 'SELECT') {
      const last = steps[steps.length - 1];
      if (last && (last.action === 'select' || last.action === 'input') && last._el === el) { last.action = 'select'; last.value = el.value; onStep(last, steps); return; }
      push({ action: 'select', value: el.value, ...describe(el), _el: el });
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      push({ action: 'check', value: el.checked, ...describe(el), _el: el });
    }
  };
  const onClick = (e) => {
    const el = targetOf(e);
    if (!el || isOurs(el) || e.button !== 0) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(button|submit|reset|checkbox|radio)$/.test(el.type)) return; // focusing a field is not a step
    if (el.type === 'checkbox' || el.type === 'radio') return;   // recorded on change
    const clickable = el.closest('button, a, [role="button"], input[type=submit], input[type=button], summary, [onclick]') ?? el;
    if (clickable.tagName === 'LABEL' || clickable.closest('label')) return;   // label clicks forward to the control
    lastClickAt = Date.now();
    push({ action: 'click', ...describe(clickable), text: (clickable.textContent ?? '').trim().slice(0, 60), _el: clickable });
  };
  const onSubmit = (e) => {
    const form = e.target;
    if (!form || isOurs(form)) return;
    // a submit right after a click is the click's consequence; replaying the click submits again
    const implicit = Date.now() - lastClickAt < 150;
    push({ action: 'submit', implicit, ...describe(form), _el: form });
  };

  addEventListener('input', onInput, true);
  addEventListener('change', onChange, true);
  addEventListener('click', onClick, true);
  addEventListener('submit', onSubmit, true);

  return {
    steps,
    stop() {
      removeEventListener('input', onInput, true);
      removeEventListener('change', onChange, true);
      removeEventListener('click', onClick, true);
      removeEventListener('submit', onSubmit, true);
      return steps.map(({ _el, ...s }) => s);
    },
  };
}

// --- replay ---------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** React-safe value write: native setter, then the events React listens to. */
export function setValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus?.();
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setChecked(el, on) {
  if (!!el.checked !== !!on) el.click();
  else el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function waitForStep(step, { timeout = 10000, every = 100 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const hit = resolve(step.selectors);
    if (hit) return hit;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}

export function savePending(state) { try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(state)); } catch { /* ignore */ } }
export function loadPending() { try { const r = sessionStorage.getItem(PENDING_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
export function clearPending() { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }

/**
 * Run steps from `from`. Before every step the pending state is written, so a
 * hard load resumes at the next step. `ask(step, i)` supplies ‹prompt› /
 * ask-each-run values. `onFailure(step, i, err)` returns 'skip' | 'retry' | 'abort'.
 */
export async function runJourney(journey, {
  from = 0, values = {}, ask = async () => null, onStep = () => {}, onFailure = async () => 'abort', highlight = () => {}, stepDelay = 120, timeout = 10000, endWithCheckpoint = false,
} = {}) {
  const steps = journey.steps ?? [];
  for (let i = from; i < steps.length; i++) {
    const step = steps[i];
    if (step.action === 'submit' && step.implicit) { onStep(step, i, 'skipped'); continue; }
    for (;;) {
      onStep(step, i, 'waiting');
      const hit = await waitForStep(step, { timeout });
      if (!hit) {
        const choice = await onFailure(step, i, new Error(`no element matched ${step.selectors?.map((s) => `${s.kind}=${s.value}`).join(' | ')}`));
        if (choice === 'retry') continue;
        if (choice === 'skip') break;
        clearPending();
        return { ok: false, at: i, reason: 'not found' };
      }
      const el = hit.el;
      try { el.scrollIntoView?.({ block: 'center', inline: 'nearest' }); } catch { /* ignore */ }
      highlight(el, step);
      // persist BEFORE acting: if this step navigates, we resume at i + 1
      savePending({ journeyId: journey.id, index: i + 1, values, endWithCheckpoint, steps: journey.id === 'unsaved' ? steps : undefined });
      try {
        let value = step.value;
        if (step.action === 'input' || step.action === 'select') {
          if (value === PROMPT || step.askEachRun) {
            value = values[i] ?? await ask(step, i);
            if (value == null) { clearPending(); return { ok: false, at: i, reason: 'cancelled' }; }
            values[i] = value;
          }
          setValue(el, value);
        } else if (step.action === 'check') setChecked(el, value);
        else if (step.action === 'click') el.click();
        else if (step.action === 'submit') { if (el.requestSubmit) el.requestSubmit(); else el.submit(); }
        onStep(step, i, 'done', hit.via);
      } catch (err) {
        const choice = await onFailure(step, i, err);
        if (choice === 'retry') continue;
        if (choice === 'skip') break;
        clearPending();
        return { ok: false, at: i, reason: err?.message };
      }
      break;
    }
    await sleep(stepDelay);
  }
  clearPending();
  return { ok: true, at: steps.length };
}
