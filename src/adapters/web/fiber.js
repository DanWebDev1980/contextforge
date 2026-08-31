// React fiber walker: from a DOM node up to the root, naming the components
// that render it. React only — the target apps are React. In production builds
// names may be minified; the caller is told rather than shown `t`.

const FIBER_KEY = /^__reactFiber\$|^__reactInternalInstance\$/;
const MAX_STRING = 80;
const MAX_ITEMS = 12;

export function fiberOf(node) {
  let cur = node;
  while (cur) {
    const key = Object.keys(cur).find((k) => FIBER_KEY.test(k));
    if (key && cur[key]) return cur[key];
    cur = cur.parentElement;
  }
  return null;
}

export function isReactPage(root = document) {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size) return true;
  if (root.querySelector('[data-reactroot]')) return true;
  for (const el of [root.body, ...root.querySelectorAll('body > *, #root, #app, #__next')]) {
    if (el && (el._reactRootContainer || Object.keys(el).some((k) => FIBER_KEY.test(k) || k.startsWith('__reactContainer$')))) return true;
  }
  return false;
}

export function reactVersion() {
  try {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook?.renderers?.size) for (const r of hook.renderers.values()) if (r.version) return r.version;
  } catch { /* ignore */ }
  return window.React?.version ?? null;
}

/** displayName / name for a fiber type, unwrapping memo / forwardRef / lazy. */
export function nameOf(type) {
  if (!type) return null;
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return type.displayName || type.name || null;
  if (typeof type === 'object') {
    const tag = String(type.$$typeof ?? '');
    if (type.displayName) return type.displayName;
    if (/memo/.test(tag)) { const inner = nameOf(type.type); return inner ? `memo(${inner})` : 'memo'; }
    if (/forward_ref/.test(tag)) { const inner = nameOf(type.render); return inner ? `forwardRef(${inner})` : 'forwardRef'; }
    if (/context/.test(tag)) return `${type._context?.displayName ?? 'Context'}.Provider`;
    if (/lazy/.test(tag)) return 'lazy';
    if (/suspense/.test(tag)) return 'Suspense';
    if (/fragment/.test(tag)) return 'Fragment';
  }
  if (typeof type === 'symbol') return String(type.description ?? type).replace(/^react\./, '');
  return null;
}

export const looksMinified = (name) => !!name && /^[a-zA-Z_$]{1,2}$/.test(name);

/** Props, sanitised: functions → ƒ, elements → <El>, long strings truncated, depth-limited. */
export function sanitise(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'function') return `ƒ ${value.name || ''}`.trim();
  if (typeof value === 'symbol') return String(value);
  if (value instanceof Node) return `<${value.nodeName.toLowerCase()}>`;
  if (value?.$$typeof) return `<${nameOf(value.type) ?? 'Element'}/>`;
  if (depth >= 2) return Array.isArray(value) ? `[${value.length}]` : '{…}';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => sanitise(v, depth + 1)).concat(value.length > MAX_ITEMS ? [`…+${value.length - MAX_ITEMS}`] : []);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, MAX_ITEMS)) if (k !== 'children') out[k] = sanitise(v, depth + 1);
    return out;
  }
  return String(value);
}

function countHooks(fiber) {
  let n = 0;
  let s = fiber.memoizedState;
  // class components keep state as a plain object; function components a linked list
  if (typeof fiber.type === 'function' && fiber.type.prototype?.isReactComponent) return null;
  while (s && typeof s === 'object' && ('next' in s || 'memoizedState' in s) && n < 200) { n += 1; s = s.next; }
  return n;
}

function sourceOf(fiber) {
  const src = fiber._debugSource ?? fiber.memoizedProps?.__source;
  if (!src?.fileName) return null;
  const file = String(src.fileName).replace(/^.*[\\/](src|app|components|pages)[\\/]/, '$1/');
  return `${file}${src.lineNumber ? `:${src.lineNumber}` : ''}`;
}

/**
 * Walk from a node's fiber up to the root. Returns { chain, minified, react }.
 * chain: [{ name, host, props, hooks, source, key }] nearest first.
 */
export function componentChain(node, { maxDepth = 40 } = {}) {
  const fiber = fiberOf(node);
  if (!fiber) return { chain: [], react: isReactPage(), minified: false, reason: isReactPage() ? 'no fiber found on this element' : 'not a React page (no fiber keys, no devtools hook, no root container)' };
  const chain = [];
  let cur = fiber;
  let host = null;
  let minified = 0;
  let depth = 0;
  while (cur && depth < 400) {
    depth += 1;
    const name = nameOf(cur.type);
    if (typeof cur.type === 'string') { host = cur.type; cur = cur.return; continue; }
    if (name && name !== 'Fragment') {
      if (looksMinified(name)) minified += 1;
      chain.push({
        name,
        host,
        key: cur.key ?? null,
        props: sanitise(cur.memoizedProps ?? {}),
        hooks: countHooks(cur),
        source: sourceOf(cur),
      });
      host = null;
      if (chain.length >= maxDepth) break;
    }
    cur = cur.return;
  }
  return { chain, react: true, minified: minified > 0 && minified >= chain.length / 2, minifiedCount: minified, version: reactVersion() };
}
