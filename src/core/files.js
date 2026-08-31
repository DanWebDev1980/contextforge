// File export / import from inside the page. Works everywhere, no clipboard
// permission games — the primary cross-origin transport for checkpoints and
// recordings.

export function download(name, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return name;
}

/** Open a file picker and resolve with the chosen file's text (null if cancelled). */
export function pickFile({ accept = '.json,application/json' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      try { resolve({ name: file.name, text: await file.text() }); } catch { resolve(null); }
    });
    // Chrome fires no event on cancel; clean up when focus returns without a change.
    const onFocus = () => { setTimeout(() => { if (input.isConnected) { input.remove(); resolve(null); } }, 800); removeEventListener('focus', onFocus); };
    addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '').replace(/(\d{8})(\d{6})/, '$1-$2');
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bcc';
