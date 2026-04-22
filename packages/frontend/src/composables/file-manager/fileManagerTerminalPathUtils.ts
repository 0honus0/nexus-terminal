export const SILENT_PWD_PREFIX = '__NX_PWD__';
export const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export const isAbsolutePath = (value: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(value);

export const parsePathFromSilentOutput = (output: string): string | null => {
  const lines = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(ANSI_ESCAPE_PATTERN, '').trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  for (const line of lines) {
    const prefixedPath = line.startsWith(SILENT_PWD_PREFIX)
      ? line.slice(SILENT_PWD_PREFIX.length).trim()
      : '';
    if (prefixedPath && isAbsolutePath(prefixedPath)) {
      return prefixedPath;
    }
    if (isAbsolutePath(line)) {
      return line;
    }
  }

  return null;
};
