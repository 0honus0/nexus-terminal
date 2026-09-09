const prettyKey = (key: string): string => {
  if (key.length === 1) return key.toUpperCase();
  return key === ' ' ? 'Space' : key;
};

export const shortcutFromKeyboardEvent = (event: KeyboardEvent): string => {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) parts.push(prettyKey(event.key));
  return parts.join('+');
};

export const normalizeShortcut = (value: string): string =>
  value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join('+');
