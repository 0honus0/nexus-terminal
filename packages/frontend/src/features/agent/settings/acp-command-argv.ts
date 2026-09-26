export const parseAcpCommandToArgv = (input: string): string[] | null => {
  if (input.includes('\u0000')) return null;
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.includes('\u0000'))) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  const argv: string[] = [];
  let token = '';
  let tokenStarted = false;
  let quote: 'single' | 'double' | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === undefined) break;

    if (quote === 'single') {
      if (char === "'") quote = null;
      else token += char;
      tokenStarted = true;
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (char === '\\') {
        const next = input[index + 1];
        if (next === undefined) return null;
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          token += next;
          index += 1;
        } else {
          token += char;
        }
        tokenStarted = true;
        continue;
      }
      token += char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        argv.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }

    if (char === "'") {
      quote = 'single';
      tokenStarted = true;
      continue;
    }

    if (char === '"') {
      quote = 'double';
      tokenStarted = true;
      continue;
    }

    if (char === '\\') {
      const next = input[index + 1];
      if (next === undefined) return null;
      token += next;
      tokenStarted = true;
      index += 1;
      continue;
    }

    if (char === '\u0000') return null;
    token += char;
    tokenStarted = true;
  }

  if (quote !== null) return null;
  if (tokenStarted) argv.push(token);
  return argv;
};
