export const THREAD_PLACEHOLDER_TITLE = 'New conversation';
export const AUTO_THREAD_TITLE_MAX_CHARACTERS = 80;

export const deriveAutomaticThreadTitle = (text: string): string | null => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const characters = Array.from(normalized);
  if (characters.length <= AUTO_THREAD_TITLE_MAX_CHARACTERS) return normalized;
  return characters.slice(0, AUTO_THREAD_TITLE_MAX_CHARACTERS).join('').trimEnd();
};
