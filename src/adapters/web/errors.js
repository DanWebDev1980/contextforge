// Error capture: console.error / console.warn, window error events and
// unhandled promise rejections, with stacks and the URL at the time. From
// injection onwards — there is no API for past console output. Restores the
// console methods on stop.

const MAX = 500;

function describe(arg) {
  if (arg instanceof Error) return { message: `${arg.name}: ${arg.message}`, stack: arg.stack ?? null };
  if (typeof arg === 'string') return { message: arg, stack: null };
  try { return { message: JSON.stringify(arg).slice(0, 500), stack: null }; } catch { return { message: String(arg), stack: null }; }
}

function fromArgs(args) {
  const parts = args.map(describe);
  return {
    message: parts.map((p) => p.message).join(' ').slice(0, 1000),
    stack: parts.find((p) => p.stack)?.stack ?? cleanStack(new Error().stack),
  };
}

/** Drop our own frames from a synthetic stack. */
function cleanStack(stack) {
  return String(stack ?? '').split('\n').slice(1).filter((l) => !/bcc\.js|bccConsole|captureErrors/.test(l)).slice(0, 12).join('\n') || null;
}

export function captureErrors(onEntry) {
  const entries = [];
  const originals = { error: console.error, warn: console.warn };
  const add = (level, data) => {
    const last = entries[entries.length - 1];
    if (last && last.level === level && last.message === data.message) { last.count += 1; last.at = new Date().toISOString(); onEntry(last, entries); return; }
    const entry = { level, ...data, url: location.href, at: new Date().toISOString(), count: 1 };
    entries.push(entry);
    if (entries.length > MAX) entries.shift();
    onEntry(entry, entries);
  };

  console.error = function bccConsoleError(...args) {
    try { add('error', fromArgs(args)); } catch { /* never break the page */ }
    return originals.error.apply(this, args);
  };
  console.warn = function bccConsoleWarn(...args) {
    try { add('warn', fromArgs(args)); } catch { /* ignore */ }
    return originals.warn.apply(this, args);
  };
  const patched = { error: console.error, warn: console.warn };

  const onError = (e) => {
    try {
      if (e.target && e.target !== window && !(e instanceof ErrorEvent)) {
        // resource load failure (img/script/link)
        add('resource', { message: `failed to load <${e.target.tagName?.toLowerCase()}> ${e.target.src || e.target.href || ''}`, stack: null });
        return;
      }
      add('uncaught', { message: e.message || String(e.error ?? 'error'), stack: e.error?.stack ?? (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null) });
    } catch { /* ignore */ }
  };
  const onRejection = (e) => {
    try { const r = e.reason; add('unhandledrejection', r instanceof Error ? { message: `${r.name}: ${r.message}`, stack: r.stack ?? null } : { message: String(r), stack: null }); } catch { /* ignore */ }
  };
  addEventListener('error', onError, true);
  addEventListener('unhandledrejection', onRejection, true);

  return {
    entries,
    stop() {
      if (console.error === patched.error) console.error = originals.error;
      if (console.warn === patched.warn) console.warn = originals.warn;
      removeEventListener('error', onError, true);
      removeEventListener('unhandledrejection', onRejection, true);
    },
  };
}
