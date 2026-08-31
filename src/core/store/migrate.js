// One-time migration from the contextforge key scheme to bcc:. Runs on every
// boot; a no-op once the old key is gone.

import { keyFor } from './store.js';

const OLD_BASKET = 'contextforge:basket:v1';

export function migrate() {
  const moved = [];
  try {
    const old = localStorage.getItem(OLD_BASKET);
    if (old != null) {
      const target = keyFor('basket');
      const existing = localStorage.getItem(target);
      if (existing == null) {
        localStorage.setItem(target, old);
      } else {
        // both exist: union by id, newest wins, so nothing already in bcc: is lost
        try {
          const byId = new Map();
          for (const i of [...JSON.parse(old), ...JSON.parse(existing)]) if (i?.id) byId.set(i.id, i);
          localStorage.setItem(target, JSON.stringify([...byId.values()]));
        } catch { /* keep the bcc: copy */ }
      }
      localStorage.removeItem(OLD_BASKET);
      moved.push(OLD_BASKET);
    }
  } catch (err) {
    console.warn('[bcc] migration skipped:', err.message);
  }
  if (typeof document !== 'undefined') document.getElementById('contextforge-root')?.remove();
  return moved;
}
