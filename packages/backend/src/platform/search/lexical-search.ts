const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_CHUNK = /[\p{L}\p{N}]+/gu;

export const normalizeLexicalSource = (value: string): string =>
  value.normalize('NFKC').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

const addToken = (selected: Set<string>, prefix: string, value: string): void => {
  if (!value) return;
  selected.add(`${prefix}${value}`);
};

export const lexicalIndexTokens = (value: string): string[] => {
  const selected = new Set<string>();
  for (const chunk of normalizeLexicalSource(value).match(WORD_CHUNK) ?? []) {
    const chars = [...chunk];
    addToken(selected, 'nxw', chunk);

    if (CJK.test(chunk)) {
      for (const width of [2, 3]) {
        for (let index = 0; index + width <= chars.length; index += 1) {
          addToken(selected, 'nxc', chars.slice(index, index + width).join(''));
        }
      }
      continue;
    }

    if (chars.length >= 3 && chars.length <= 96) {
      for (let index = 0; index + 3 <= chars.length; index += 1) {
        addToken(selected, 'nxg', chars.slice(index, index + 3).join(''));
      }
    }
  }
  return [...selected];
};

export const lexicalQueryTerms = (value: string, maxTerms = 64): string[] => {
  if (!Number.isSafeInteger(maxTerms) || maxTerms < 1 || maxTerms > 256) throw new Error('VALIDATION_FAILED');
  const selected = new Set<string>();
  const chunks = normalizeLexicalSource(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const chunk of chunks) {
    const characters = [...chunk];
    if (CJK.test(chunk)) {
      if (characters.length >= 2 && characters.length <= 32) selected.add(chunk);
      for (const width of [2, 3]) {
        for (let index = 0; index + width <= characters.length && selected.size < maxTerms; index += 1) {
          selected.add(characters.slice(index, index + width).join(''));
        }
      }
    } else if (chunk.length >= 2) {
      selected.add(chunk);
    }
    if (selected.size >= maxTerms) break;
  }
  return [...selected].slice(0, maxTerms);
};
