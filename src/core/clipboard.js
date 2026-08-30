/**
 * Copy text to the clipboard.
 *
 * navigator.clipboard requires a secure context *and* document focus. Clicking a
 * button inside our shadow root satisfies both, but a keyboard shortcut fired
 * while DevTools has focus does not — hence the execCommand fallback, which is
 * deprecated but still the only thing that works in that case.
 */
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export async function readClipboard() {
  try { return await navigator.clipboard.readText(); } catch { return null; }
}
