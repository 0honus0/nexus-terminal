/**
 * Writes plain text to the system clipboard with a legacy DOM fallback for
 * browsers/webviews that do not expose or allow navigator.clipboard.writeText.
 *
 * Product features own their success/error feedback; this primitive only owns
 * the browser compatibility mechanics.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection-based compatibility path.
    }
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  Object.assign(textarea.style, {
    position: 'fixed',
    inset: '0 auto auto -10000px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.append(textarea);

  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
    active?.focus({ preventScroll: true });
  }

  if (!copied) throw new Error('Clipboard write is unavailable.');
}
