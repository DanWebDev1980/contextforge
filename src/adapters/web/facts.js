// Page facts: an environment fingerprint in one click. Framework + version,
// build ids, viewport, UA, feature flags in storage, web vitals so far, long
// tasks. The first section of any bug report.

import { isReactPage, reactVersion } from './fiber.js';
import { readArea } from './storage.js';

export function detectFramework() {
  const out = [];
  if (isReactPage()) out.push({ name: 'React', version: reactVersion() });
  if (window.__NEXT_DATA__ || document.getElementById('__next')) out.push({ name: 'Next.js', version: window.next?.version ?? null, buildId: window.__NEXT_DATA__?.buildId ?? null });
  if (window.ng || document.querySelector('[ng-version]')) out.push({ name: 'Angular', version: document.querySelector('[ng-version]')?.getAttribute('ng-version') ?? null });
  if (window.angular) out.push({ name: 'AngularJS', version: window.angular.version?.full ?? null });
  if (window.__VUE__ || document.querySelector('[data-v-app]') || document.getElementById('app')?.__vue_app__) out.push({ name: 'Vue', version: document.getElementById('app')?.__vue_app__?.version ?? window.Vue?.version ?? null });
  if (window.Svelte || document.querySelector('[class*="svelte-"]')) out.push({ name: 'Svelte', version: null });
  if (window.jQuery) out.push({ name: 'jQuery', version: window.jQuery.fn?.jquery ?? null });
  if (window.__remixContext) out.push({ name: 'Remix', version: null });
  if (document.querySelector('script[type="module"][src*="/@vite/"], script[src*="/assets/index-"]')) out.push({ name: 'Vite build', version: null });
  if (document.querySelector('script[src*="webpack"], script[src*="/static/js/main."]')) out.push({ name: 'webpack build', version: null });
  return out;
}

export function buildInfo() {
  const meta = {};
  for (const m of document.querySelectorAll('meta[name], meta[property]')) {
    const name = (m.getAttribute('name') ?? m.getAttribute('property') ?? '').toLowerCase();
    if (/version|build|release|commit|sha|generator|app-?env|environment/.test(name)) meta[name] = m.getAttribute('content');
  }
  const scripts = [...document.scripts].map((s) => s.src).filter(Boolean).map((src) => src.split('/').pop().split('?')[0]).slice(0, 12);
  const hashes = scripts.map((n) => n.match(/[.-]([a-f0-9]{8,})\./i)?.[1]).filter(Boolean);
  const globals = {};
  for (const k of ['__APP_VERSION__', 'APP_VERSION', 'BUILD_ID', '__BUILD__', 'VERSION', '__ENV__', 'ENV', '__CONFIG__', 'appConfig', 'env']) {
    try { const v = window[k]; if (v != null && (typeof v !== 'object' || Object.keys(v).length < 40)) globals[k] = typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 120); } catch { /* ignore */ }
  }
  return { meta, scripts, hashes, globals };
}

export function featureFlags(flagRegex) {
  const out = [];
  for (const area of ['local', 'session']) {
    for (const [k, v] of Object.entries(readArea(area))) {
      if (flagRegex.test(k)) out.push({ area, key: k, value: String(v).slice(0, 120) });
      else if (/^\s*\{/.test(v) && v.length < 20000) {
        try { const o = JSON.parse(v); for (const [fk, fv] of Object.entries(o)) if (flagRegex.test(fk) && (typeof fv === 'boolean' || typeof fv === 'string')) out.push({ area, key: `${k}.${fk}`, value: String(fv) }); } catch { /* ignore */ }
      }
    }
  }
  for (const c of document.cookie.split(';')) { const [n] = c.split('='); if (n && flagRegex.test(n.trim())) out.push({ area: 'cookie', key: n.trim(), value: c.split('=').slice(1).join('=').trim().slice(0, 120) }); }
  return out;
}

/** Vitals from buffered performance entries — what happened so far, not a lab score. */
export function webVitals() {
  const nav = performance.getEntriesByType('navigation')[0];
  const out = {
    ttfb: nav ? Math.round(nav.responseStart - nav.startTime) : null,
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
    load: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
    fcp: null, lcp: null, cls: null, inp: null, longTasks: null, resources: performance.getEntriesByType('resource').length,
    transferKB: Math.round(performance.getEntriesByType('resource').reduce((n, e) => n + (e.transferSize || 0), 0) / 1024),
  };
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  if (fcp) out.fcp = Math.round(fcp.startTime);
  const buffered = (type, fn) => {
    try {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
      const po = new PerformanceObserver(() => {});
      po.observe({ type, buffered: true });
      const list = po.takeRecords();
      po.disconnect();
      fn(list);
    } catch { /* unsupported */ }
  };
  buffered('largest-contentful-paint', (list) => { const last = list[list.length - 1]; if (last) out.lcp = Math.round(last.startTime); });
  buffered('layout-shift', (list) => { out.cls = Math.round(list.filter((e) => !e.hadRecentInput).reduce((n, e) => n + e.value, 0) * 1000) / 1000; });
  buffered('event', (list) => { const worst = list.reduce((m, e) => Math.max(m, e.duration), 0); if (list.length) out.inp = Math.round(worst); });
  buffered('longtask', (list) => { out.longTasks = list.length; });
  return out;
}

export function collectFacts(flagRegex) {
  const frameworks = detectFramework();
  return {
    url: location.href,
    title: document.title,
    frameworks,
    framework: frameworks[0] ?? { name: 'unknown', version: null },
    build: buildInfo(),
    flags: featureFlags(flagRegex),
    vitals: webVitals(),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches },
    userAgent: navigator.userAgent,
    language: navigator.language,
    online: navigator.onLine,
    serviceWorker: !!navigator.serviceWorker?.controller,
    storage: { local: Object.keys(readArea('local')).length, session: Object.keys(readArea('session')).length, cookies: document.cookie ? document.cookie.split(';').length : 0 },
    at: new Date().toISOString(),
  };
}

export function factsMarkdown(f) {
  const v = f.vitals;
  const ms = (n) => (n == null ? '—' : `${n} ms`);
  const lines = [
    `- **URL**: ${f.url}`,
    `- **Title**: ${f.title}`,
    `- **Framework**: ${f.frameworks.length ? f.frameworks.map((x) => `${x.name}${x.version ? ` ${x.version}` : ''}${x.buildId ? ` (build ${x.buildId})` : ''}`).join(', ') : 'not detected'}`,
    Object.keys(f.build.meta).length ? `- **Build meta**: ${Object.entries(f.build.meta).map(([k, x]) => `${k}=${x}`).join(', ')}` : null,
    f.build.hashes.length ? `- **Script hashes**: ${f.build.hashes.slice(0, 4).join(', ')}` : null,
    Object.keys(f.build.globals).length ? `- **Config globals**: ${Object.entries(f.build.globals).map(([k, x]) => `${k}=${x}`).join('; ')}` : null,
    `- **Viewport**: ${f.viewport.width}×${f.viewport.height} @${f.viewport.dpr}x, ${f.viewport.colorScheme}${f.viewport.reducedMotion ? ', reduced motion' : ''}`,
    `- **UA**: ${f.userAgent}`,
    `- **Storage**: ${f.storage.local} local, ${f.storage.session} session, ${f.storage.cookies} cookies${f.serviceWorker ? ' · service worker active' : ''}`,
    `- **Vitals so far**: TTFB ${ms(v.ttfb)} · FCP ${ms(v.fcp)} · LCP ${ms(v.lcp)} · CLS ${v.cls ?? '—'} · INP ${ms(v.inp)} · long tasks ${v.longTasks ?? '—'} · ${v.resources} resources, ${v.transferKB} KB`,
  ].filter(Boolean);
  if (f.flags.length) {
    lines.push('', '**Feature flags found in storage**', '', ...f.flags.map((fl) => `- \`${fl.key}\` = \`${fl.value}\` _(${fl.area})_`));
  }
  return lines.join('\n');
}
