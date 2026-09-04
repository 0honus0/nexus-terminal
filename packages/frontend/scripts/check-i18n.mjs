import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), 'src');
const locales = ['en-US', 'zh-CN', 'ja-JP'];
const byLocale = new Map(locales.map((locale) => [locale, new Map()]));

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
};

const files = walk(root).filter((file) => /[\\/]i18n[\\/](?:messages[\\/])?(en-US|zh-CN|ja-JP)\.json$/.test(file));

const flatten = (value, prefix = '', result = new Map()) => {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      result.set(fullKey, child);
    } else if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, fullKey, result);
    } else {
      throw new Error(`Invalid i18n value at ${fullKey}; only nested objects and strings are allowed.`);
    }
  }
  return result;
};

for (const file of files) {
  const locale = path.basename(file, '.json');
  const flattened = flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
  const target = byLocale.get(locale);
  for (const [key, value] of flattened) {
    if (target.has(key)) throw new Error(`Duplicate i18n key ${key} in ${file}.`);
    target.set(key, value);
  }
}

const reference = byLocale.get('en-US');
for (const locale of locales) {
  const current = byLocale.get(locale);
  const missing = [...reference.keys()].filter((key) => !current.has(key));
  const extra = [...current.keys()].filter((key) => !reference.has(key));
  if (missing.length || extra.length) {
    throw new Error(
      `${locale} i18n key mismatch. Missing: ${missing.join(', ') || '-'}; extra: ${extra.join(', ') || '-'}`,
    );
  }
}

const sourceFiles = walk(root).filter((file) => /\.(?:ts|vue)$/.test(file));
const missingReferences = [];
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1/g)) {
    const key = match[2];
    if (reference.has(key)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    missingReferences.push(`${path.relative(process.cwd(), file)}:${line}: ${key}`);
  }
}
if (missingReferences.length) {
  throw new Error(`Static i18n references are missing from en-US:\n${missingReferences.join('\n')}`);
}

// Protocol names, transport methods and file formats intentionally remain language-neutral.
const visibleLiteralAllowlist = new Set([
  'SSH',
  'RDP',
  'VNC',
  'SOCKS5',
  'HTTP',
  'GET',
  'POST',
  'PUT',
  'URL',
  'IP',
  'hCaptcha',
  'reCAPTCHA',
  'zip',
  'tar.gz',
  'tar.bz2',
  'CD→',
  '←CD',
]);
const visibleLiteralErrors = [];
for (const file of sourceFiles.filter((item) => item.endsWith('.vue'))) {
  const source = fs.readFileSync(file, 'utf8');
  const templateMatch = source.match(/<template>([\s\S]*?)<\/template>/);
  if (!templateMatch) continue;
  const template = templateMatch[1];
  const templateStartLine = source.slice(0, source.indexOf('<template>')).split('\n').length;
  const record = (match, kind, value) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || visibleLiteralAllowlist.has(normalized) || /^&[a-z]+;$/.test(normalized)) return;
    const line = templateStartLine + template.slice(0, match.index).split('\n').length;
    visibleLiteralErrors.push(`${path.relative(process.cwd(), file)}:${line}: ${kind} "${normalized}"`);
  };
  for (const match of template.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) record(match, 'text', match[1]);
  for (const match of template.matchAll(
    /(?:^|\s)(label|title|placeholder|aria-label|alt|empty-text)="([^"{}]*[A-Za-z][^"{}]*)"/gm,
  )) {
    record(match, match[1], match[2]);
  }
}
if (visibleLiteralErrors.length) {
  throw new Error(
    `User-visible English literals found in Vue templates. Move them to the owning i18n fragment or explicitly classify a language-neutral technical token:\n${visibleLiteralErrors.join('\n')}`,
  );
}

console.log(
  `i18n check passed: ${reference.size} keys across ${locales.length} locales in ${files.length} fragments; static references and visible Vue literals are valid.`,
);
