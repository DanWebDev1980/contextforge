// A checkpoint: where you are in an app — storage, cookies, URL, scroll — named
// and filed by app / env / page / journey / step. Pure functions; the storage
// adapter supplies the snapshot and does the writing.

export const CHECKPOINT_VERSION = 1;

const newId = () => `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Build a checkpoint from a snapshot (adapters/web/storage.js#snapshot) plus
 * naming. `include` narrows which keys/cookies are kept: { local:[…], session:[…], cookies:[…] }.
 * `isSensitive(key)` flags credential-looking keys; they are kept but listed.
 */
export function makeCheckpoint(snap, {
  app, env = 'unknown', page, journey = '', step = '', tags = [], notes = '', include = null, isSensitive = () => false, bccVersion = null,
} = {}) {
  const pick = (obj, keys) => (keys ? Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => keys.includes(k))) : { ...(obj ?? {}) });
  const storage = {
    local: pick(snap.storage?.local, include?.local),
    session: pick(snap.storage?.session, include?.session),
  };
  const cookies = (snap.cookies ?? []).filter((c) => !include?.cookies || include.cookies.includes(c.name));
  const sensitive = [
    ...Object.keys(storage.local), ...Object.keys(storage.session), ...cookies.map((c) => c.name),
  ].filter((k, i, arr) => arr.indexOf(k) === i && isSensitive(k));
  const now = new Date().toISOString();
  return {
    kind: 'checkpoint',
    version: CHECKPOINT_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    app: app || hostOf(snap.url?.origin) || 'unknown',
    env,
    page: page ?? snap.meta?.title ?? '',
    journey, step,
    tags: [...tags],
    notes,
    starred: false,
    url: { ...snap.url },
    storage,
    cookies,
    scroll: { ...(snap.scroll ?? { x: 0, y: 0 }) },
    sensitive,
    meta: { ...(snap.meta ?? {}), bccVersion },
  };
}

function hostOf(origin) { try { return new URL(origin).hostname; } catch { return null; } }

export const keyCount = (cp) => Object.keys(cp.storage?.local ?? {}).length + Object.keys(cp.storage?.session ?? {}).length + (cp.cookies?.length ?? 0);

/** Every (area, key, value) triple in a checkpoint. */
export function entries(cp) {
  const out = [];
  for (const area of ['local', 'session']) for (const [key, value] of Object.entries(cp.storage?.[area] ?? {})) out.push({ area, key, value });
  for (const c of cp.cookies ?? []) out.push({ area: 'cookie', key: c.name, value: c.value });
  return out;
}

/**
 * The exportable form: sensitive keys removed unless `includeSensitive`,
 * with a `withheld` list so the reader knows what is missing.
 */
export function redactForExport(cp, { includeSensitive = false } = {}) {
  if (includeSensitive || !cp.sensitive?.length) return { ...cp, withheld: [] };
  const drop = new Set(cp.sensitive);
  const strip = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => !drop.has(k)));
  return {
    ...cp,
    storage: { local: strip(cp.storage?.local), session: strip(cp.storage?.session) },
    cookies: (cp.cookies ?? []).filter((c) => !drop.has(c.name)),
    withheld: [...drop],
  };
}

/** Key-level diff of a checkpoint against the current snapshot. */
export function diffAgainst(cp, snap) {
  const rows = [];
  const cur = {
    local: snap.storage?.local ?? {}, session: snap.storage?.session ?? {},
    cookie: Object.fromEntries((snap.cookies ?? []).map((c) => [c.name, c.value])),
  };
  const saved = {
    local: cp.storage?.local ?? {}, session: cp.storage?.session ?? {},
    cookie: Object.fromEntries((cp.cookies ?? []).map((c) => [c.name, c.value])),
  };
  for (const area of ['local', 'session', 'cookie']) {
    const keys = new Set([...Object.keys(saved[area]), ...Object.keys(cur[area])]);
    for (const key of keys) {
      const a = saved[area][key], b = cur[area][key];
      const status = a === undefined ? 'added' : b === undefined ? 'missing' : a === b ? 'same' : 'changed';
      rows.push({ area, key, saved: a, current: b, status });
    }
  }
  const summary = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
  return { rows, summary, restorable: rows.some((r) => r.status !== 'added') };
}

/** Keys whose values mention the checkpoint's own origin — API base URLs cached in storage, typically. */
export function valuesContaining(cp, origin = cp.url?.origin) {
  if (!origin) return [];
  return entries(cp).filter((e) => typeof e.value === 'string' && e.value.includes(origin));
}

/** A copy with `from` replaced by `to` inside every string value. */
export function rewriteValues(cp, from, to) {
  if (!from || !to || from === to) return cp;
  const rw = (v) => (typeof v === 'string' ? v.split(from).join(to) : v);
  return {
    ...cp,
    storage: {
      local: Object.fromEntries(Object.entries(cp.storage?.local ?? {}).map(([k, v]) => [k, rw(v)])),
      session: Object.fromEntries(Object.entries(cp.storage?.session ?? {}).map(([k, v]) => [k, rw(v)])),
    },
    cookies: (cp.cookies ?? []).map((c) => ({ ...c, value: rw(c.value) })),
  };
}

/** Where to navigate after writing storage: the checkpoint's path on `targetOrigin`. */
export function restoreUrl(cp, targetOrigin) {
  return `${targetOrigin}${cp.url?.path ?? '/'}${cp.url?.search ?? ''}${cp.url?.hash ?? ''}`;
}

/** Sort/filter/group helpers for the library table. */
export function filterCheckpoints(list, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((cp) => [cp.app, cp.env, cp.page, cp.journey, cp.step, cp.notes, ...(cp.tags ?? []), cp.url?.path].join(' ').toLowerCase().includes(q));
}

export function sortCheckpoints(list, by = 'createdAt', dir = 'desc') {
  const val = (cp) => (by === 'keys' ? keyCount(cp) : String(cp[by] ?? ''));
  const sorted = [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    return typeof x === 'number' ? x - y : x.localeCompare(y);
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}

export function groupCheckpoints(list, by) {
  if (!by) return [{ key: null, items: list }];
  const groups = new Map();
  for (const cp of list) {
    const k = cp[by] || '(none)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(cp);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, items }));
}

/** Validate an imported checkpoint object; returns a list of problems. */
export function validateCheckpoint(cp) {
  const problems = [];
  if (cp?.kind !== 'checkpoint') problems.push('kind must be "checkpoint"');
  if (!cp?.id) problems.push('missing id');
  if (!cp?.storage || typeof cp.storage !== 'object') problems.push('missing storage');
  if (cp?.cookies && !Array.isArray(cp.cookies)) problems.push('cookies must be an array');
  return problems;
}
