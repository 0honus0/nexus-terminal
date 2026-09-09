const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

const decodePath = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeRemotePath = (currentFilePath: string, linkedPath: string): string => {
  const parts = linkedPath.startsWith('/')
    ? []
    : currentFilePath
        .split('/')
        .filter(Boolean)
        .slice(0, -1);

  for (const segment of linkedPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }

  return `/${parts.join('/')}`;
};

/**
 * Resolves Markdown links that refer to another Markdown document on the same remote filesystem.
 * External/protocol links and same-document anchors return null so the browser can handle them normally.
 */
export const resolveMarkdownDocumentLink = (currentFilePath: string, href: string): string | null => {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || EXTERNAL_SCHEME.test(trimmed)) return null;

  const linkedPath = trimmed.split('#', 1)[0]!.split('?', 1)[0]!;
  if (!linkedPath) return null;
  const decodedPath = decodePath(linkedPath);
  if (!MARKDOWN_EXTENSION.test(decodedPath)) return null;

  return normalizeRemotePath(currentFilePath, decodedPath);
};
