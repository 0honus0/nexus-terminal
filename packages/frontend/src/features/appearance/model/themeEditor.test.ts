import { describe, expect, it } from 'vitest';
import { parseThemeObject } from './themeEditor';

describe('parseThemeObject', () => {
  it('accepts string token maps without changing values', () => {
    expect(parseThemeObject('{"background":"#123456","foreground":"var(--text)"}')).toEqual({
      value: { background: '#123456', foreground: 'var(--text)' },
    });
  });

  it('rejects arrays and non-string token values', () => {
    expect(parseThemeObject('[]')).toEqual({ error: 'object-required' });
    expect(parseThemeObject('{"background":42}')).toEqual({ error: 'string-values-required' });
  });

  it('returns a parse error for malformed JSON', () => {
    expect(parseThemeObject('{')).toHaveProperty('error');
  });
});
