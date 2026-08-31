// Same path, another environment of the same app — from the env map. Lives in
// the dock menu too, so it is one click without opening the panel.

import { toast, el, envBadge } from '../core/overlay/ui.js';
import { describeOrigin, envsFor, rewriteOrigin, validateEnvMap } from '../core/site.js';
import * as settings from '../app/settings.js';
import { addMenuSection } from '../app/dock.js';
import { start as startTool } from '../app/registry.js';

export function switchTo(origin) {
  const target = rewriteOrigin(location.href, origin);
  toast(`→ ${target}`);
  location.assign(target);
}

addMenuSection('Environment', () => {
  const envMap = settings.get('envMap');
  const here = describeOrigin(envMap);
  const envs = envsFor(envMap, here.app);
  if (!envs.length) return [{ label: 'Map this origin to an app/env…', icon: '🌐', onclick: () => startTool('env') }];
  return envs.map((e) => ({ label: `${e.env}${e.current ? ' (here)' : ''}`, icon: e.current ? '●' : '○', hint: e.origin.replace(/^https?:\/\//, ''), onclick: () => { if (!e.current) switchTo(e.origin); } }));
});

export default {
  id: 'env',
  title: 'Environment switcher',
  desc: 'Open the same path on another environment of this app, from your env map.',
  icon: '🌐',
  group: 'state',
  sites: ['web', '*'],
  keywords: ['environment', 'dev', 'test', 'prod', 'switch', 'origin', 'env map'],

  start(ctx) {
    const p = ctx.panel({ width: 420 });

    function render() {
      const envMap = settings.get('envMap');
      const here = describeOrigin(envMap);
      const envs = envsFor(envMap, here.app);
      p.body.replaceChildren();

      if (!envs.length) {
        const appIn = el('input', { type: 'text', placeholder: 'app name, e.g. billing', value: here.app === location.hostname.replace(/^www\./, '') ? '' : here.app });
        const envIn = el('input', { type: 'text', placeholder: 'env name, e.g. test', list: 'bcc-env-names' });
        p.body.append(
          el('div', { class: 'muted' }, `${location.origin} is not in your env map yet. Name it once and every tool resolves app + env from it.`),
          el('datalist', { id: 'bcc-env-names' }, ['dev', 'local', 'test', 'uat', 'staging', 'prod'].map((v) => el('option', { value: v }))),
          el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px' }, appIn, envIn),
          el('div', { class: 'row', style: 'margin-top:8px' }, el('button', {
            class: 'primary',
            onclick: () => {
              const app = appIn.value.trim(), env = envIn.value.trim();
              if (!app || !env) return toast('Both names are needed');
              const next = { ...envMap, [app]: { ...(envMap[app] ?? {}), [env]: location.origin } };
              const problems = validateEnvMap(next);
              if (problems.length) return toast(problems[0]);
              settings.set('envMap', next);
              toast(`${location.origin} → ${app}/${env}`);
              render();
            },
          }, 'Add this origin'), el('span', { class: 'muted' }, 'or edit the whole map in Settings')),
        );
        return;
      }

      p.body.append(el('div', { class: 'row', style: 'margin-bottom:8px' }, el('strong', {}, here.app), envBadge(here.env), el('span', { class: 'muted grow ellipsis' }, location.pathname + location.search)));
      for (const e of envs) {
        p.body.append(el('div', { class: 'row item' },
          envBadge(e.env),
          el('span', { class: 'grow mono ellipsis', title: e.origin }, e.origin),
          e.current ? el('span', { class: 'muted' }, 'you are here') : el('button', { class: 'primary sm', onclick: () => switchTo(e.origin) }, 'Open same path →'),
          e.current ? null : el('button', { class: 'sm', title: 'Open in a new tab', onclick: () => window.open(rewriteOrigin(location.href, e.origin), '_blank') }, '↗'),
        ));
      }
      const envIn = el('input', { type: 'text', placeholder: 'add env name', style: 'width:110px' });
      const originIn = el('input', { type: 'url', placeholder: 'https://host', style: 'flex:1' });
      p.body.append(el('div', { class: 'row', style: 'margin-top:10px' }, envIn, originIn, el('button', {
        class: 'sm',
        onclick: () => {
          const env = envIn.value.trim(), origin = originIn.value.trim();
          if (!env || !origin) return toast('Need both');
          const next = { ...envMap, [here.app]: { ...(envMap[here.app] ?? {}), [env]: origin } };
          const problems = validateEnvMap(next);
          if (problems.length) return toast(problems[0]);
          settings.set('envMap', next); render();
        },
      }, '＋')));
    }

    p.foot.append(el('button', { onclick: () => startTool('settings') }, 'Edit env map in Settings'));
    const off = settings.settings.onChange(() => { if (!p.closed) render(); });
    render();
    return { stop() { off(); p.close(); }, switchTo };
  },
};
