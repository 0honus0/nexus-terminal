export interface ThemeParseResult {
  value?: Record<string, string>;
  error?: string;
}

export const formatThemeObject = (theme: Record<string, string>): string => JSON.stringify(theme, null, 2);

export const parseThemeObject = (source: string): ThemeParseResult => {
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'object-required' };
    const entries = Object.entries(parsed);
    if (entries.some(([, value]) => typeof value !== 'string')) return { error: 'string-values-required' };
    return { value: Object.fromEntries(entries) as Record<string, string> };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
};
