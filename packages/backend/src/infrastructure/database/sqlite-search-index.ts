import { lexicalIndexTokens, normalizeLexicalSource } from '../../platform/search/lexical-search';

export const sqliteSearchTerms = (value: string): string => lexicalIndexTokens(value).join(' ');

const payloadText = (payload: unknown): string => {
  if (typeof payload === 'string') return payload;
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return JSON.stringify(payload);
  const record = payload as Record<string, unknown>;
  for (const key of ['text', 'content', 'message', 'summary']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return JSON.stringify(payload);
};

export const sqliteLedgerSearchTerms = (payloadJson: string): string => {
  try {
    return sqliteSearchTerms(payloadText(JSON.parse(payloadJson)));
  } catch {
    return sqliteSearchTerms(payloadJson);
  }
};

const quoteFtsToken = (token: string): string => `"${token.replaceAll('"', '""')}"`;

const strongestQueryTerms = (queryTerms: readonly string[]): string[] => {
  const normalized = [...new Set(queryTerms.map((term) => normalizeLexicalSource(term).trim()).filter(Boolean))];
  return normalized.filter(
    (term) => !normalized.some((other) => other !== term && other.length > term.length && other.includes(term)),
  );
};

const matchGroup = (term: string): string | null => {
  const tokens = lexicalIndexTokens(term);
  if (tokens.length === 0) return null;

  const words = tokens.filter((token) => token.startsWith('nxw')).map(quoteFtsToken);
  const cjk = tokens.filter((token) => token.startsWith('nxc') && [...token.slice(3)].length === 2).map(quoteFtsToken);
  const trigrams = tokens.filter((token) => token.startsWith('nxg')).map(quoteFtsToken);
  const alternatives: string[] = [];

  if (words.length > 0) alternatives.push(words.length === 1 ? words[0]! : `(${words.join(' AND ')})`);
  if (cjk.length > 0) alternatives.push(cjk.length === 1 ? cjk[0]! : `(${cjk.join(' AND ')})`);
  if (trigrams.length > 0) alternatives.push(trigrams.length === 1 ? trigrams[0]! : `(${trigrams.join(' AND ')})`);
  if (alternatives.length === 0) return null;
  return alternatives.length === 1 ? alternatives[0]! : `(${alternatives.join(' OR ')})`;
};

export const sqliteSearchMatchQuery = (queryTerms: readonly string[]): string | null => {
  const groups = strongestQueryTerms(queryTerms)
    .map(matchGroup)
    .filter((group): group is string => Boolean(group));
  if (groups.length === 0) return null;
  return groups.length === 1 ? groups[0]! : `(${groups.join(' OR ')})`;
};
