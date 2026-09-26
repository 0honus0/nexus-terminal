#!/usr/bin/env node
/*
 * Guards the Agent i18n surface against four recurring defects:
 *   1. a locale silently missing the English dictionary's keys;
 *   2. `zh-CN` / `ja-JP` keeping an English sentence verbatim (e.g.
 *      "Denylist revision {revision}" shown inside a Chinese UI);
 *   3. user-facing Chinese hardcoded in component sources, leaking into the
 *      English/Japanese UI;
 *   4. dictionary keys that no source file can ever resolve, keeping three
 *      locales worth of dead copy alive;
 *   5. user-facing English literals embedded directly in Agent templates or UI
 *      label/error helpers instead of going through the dictionaries.
 *
 * Anything that is genuinely untranslatable (brand, protocol, URL/sample
 * values, pure placeholders) belongs in BRAND_TERMS below, and any source line
 * that legitimately needs CJK belongs in SOURCE_CJK_ALLOWLIST.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const stripNonRuntimeComments = (text) => {
  let inBlockComment = false;
  let inHtmlComment = false;
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false;
        return '';
      }
      if (inHtmlComment) {
        if (trimmed.includes('-->')) inHtmlComment = false;
        return '';
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        return '';
      }
      if (trimmed.startsWith('<!--')) {
        if (!trimmed.includes('-->')) inHtmlComment = true;
        return '';
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
      return line;
    })
    .join('\n');
};

const escapeRegExp = (value) => value.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');

const scrubUnusedSimpleBindings = (text) =>
  text.replace(
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])(agent\.[A-Za-z0-9_.-]+)\2\s*;?/g,
    (declaration, identifier) => {
      const occurrences = text.match(new RegExp(`\\b${escapeRegExp(identifier)}\\b`, 'g'))?.length ?? 0;
      return occurrences <= 1 ? '' : declaration;
    },
  );

export const collectAgentI18nReferences = (sourceText) => {
  const text = scrubUnusedSimpleBindings(stripNonRuntimeComments(sourceText));
  const literals = new Set();
  const prefixes = new Set();

  for (const match of text.matchAll(/['"`](agent\.[A-Za-z0-9_.-]+)['"`]/g)) literals.add(match[1]);
  for (const match of text.matchAll(/`(agent\.[A-Za-z0-9_.-]*)\$\{/g)) {
    prefixes.add(match[1].replace(/\.$/, ''));
  }
  for (const match of text.matchAll(/['"`](agent\.[A-Za-z0-9_.]*)\*/g)) prefixes.add(match[1]);

  return { literals, prefixes };
};

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = resolve(here, '../packages/frontend/src/features/agent');
const localeDir = join(agentDir, 'i18n');
const LOCALES = ['en-US', 'zh-CN', 'ja-JP'];

// Source lines that may keep CJK on purpose (e.g. a CJK-only regex range).
const SOURCE_CJK_ALLOWLIST = new Set([]);

// Keys that are only resolved through a runtime path the scanner cannot see.
// Keep this empty unless a key is genuinely reachable; delete the key otherwise.
const UNUSED_KEY_ALLOWLIST = new Set([]);

// Brand / protocol / format values that are intentionally identical across locales.
const BRAND_TERMS = new Set([
  'agent.settings.providers.protocolChat',
  'agent.settings.providers.protocolResponses',
  'agent.settings.providers.baseUrlPlaceholder',
  'agent.settings.providers.modelPlaceholder',
  'agent.settings.providers.fallbackCount',
  'agent.settings.browserRuntime.title',
  'agent.settings.acpRuntime.title',
  'agent.settings.mcpIntegrations.endpoint',
  'agent.settings.acpRuntime.profileId',
  'agent.settings.guardrails.eventBatchValue',
  'agent.settings.guardrails.commitQueueValue',
  'agent.workspaceRuntime.targetSource',
]);

const flatten = (value, prefix = '') => {
  const out = new Map();
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      for (const [nested, nestedValue] of flatten(entry, path)) out.set(nested, nestedValue);
    } else {
      out.set(path, entry);
    }
  }
  return out;
};

const load = (locale) => flatten(JSON.parse(readFileSync(resolve(localeDir, `${locale}.json`), 'utf8')));

const hasCjk = (text) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(text);

const looksLikeEnglishSentence = (text) => {
  if (typeof text !== 'string' || hasCjk(text) || text.length <= 12) return false;
  const words = text.match(/[A-Za-z][A-Za-z'’-]+/g) ?? [];
  return words.length >= 2;
};

const SOURCE_ENGLISH_TECHNICAL_TERMS = new Set(['SSH', 'HTTP/WS', 'TLS', 'Ed25519']);

const normalizeUiLiteral = (value) =>
  value
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isTechnicalUiLiteral = (value) => {
  const normalized = normalizeUiLiteral(value);
  if (!normalized || SOURCE_ENGLISH_TECHNICAL_TERMS.has(normalized)) return true;
  if (/^[A-Z0-9][A-Z0-9+./:_-]*$/.test(normalized)) return true;
  if (/^(?:https?|wss?):\/\//i.test(normalized)) return true;
  if (/^[A-Za-z0-9_.:+*?/-]+(?:\s*,\s*[A-Za-z0-9_.:+*?/-]+)*$/.test(normalized) && /[\d/*.:_-]/.test(normalized)) {
    return true;
  }
  return false;
};

const looksLikeSourceEnglishUi = (value) => {
  const normalized = normalizeUiLiteral(value);
  if (isTechnicalUiLiteral(normalized) || hasCjk(normalized)) return false;
  const words = normalized.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  if (words.length >= 2) return true;
  return /^[A-Z][a-z]{2,}$/.test(normalized);
};

const quotedLiterals = (line) => [...line.matchAll(/(['"`])([^'"`]+)\1/g)].map((match) => match[2]);

const english = load('en-US');
const problems = [];

for (const locale of LOCALES.filter((item) => item !== 'en-US')) {
  const dictionary = load(locale);

  for (const key of english.keys()) {
    if (!dictionary.has(key)) problems.push(`${locale}: missing key ${key}`);
  }
  for (const key of dictionary.keys()) {
    if (!english.has(key)) problems.push(`${locale}: unknown key ${key}`);
  }

  for (const [key, value] of dictionary) {
    if (!english.has(key) || english.get(key) !== value) continue;
    if (BRAND_TERMS.has(key)) continue;
    if (!looksLikeEnglishSentence(value)) continue;
    problems.push(`${locale}: untranslated English value at ${key} → ${JSON.stringify(value)}`);
  }
}

/*
 * §7.14-c: any CJK left in a component/TS source line is user-visible text that
 * skipped the dictionaries. Comments are skipped (the codebase documents in
 * Chinese), and so are the dictionaries themselves.
 */
const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'i18n') walk(full);
      continue;
    }
    if (/\.(vue|ts)$/.test(entry)) sourceFiles.push(full);
  }
};
walk(agentDir);

const ENGLISH_UI_DIRECT_LITERAL_PATTERNS = [
  /\b\w*(?:Error|Message|Title|Description|Hint)\w*\.value\s*=\s*(['"`])([^'"`]+)\1/g,
  /\b(?:label|description|message|title|hint|tooltip|placeholder)\s*:\s*(['"`])([^'"`]+)\1/g,
  /formatAgentApiError\s*\([^\n]*?,\s*(['"`])([^'"`]+)\1/g,
];
const ENGLISH_UI_NAMED_HELPER = /\b\w*(?:Label|Text|Message|Title|Description|Hint)\w*\b\s*=/i;

for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8');
  const relative = file.slice(agentDir.length + 1);

  if (file.endsWith('.vue')) {
    const templateMatch = source.match(/<template>([\s\S]*?)<\/template>/);
    if (templateMatch) {
      const template = templateMatch[1].replace(/<!--[\s\S]*?-->/g, '');
      const templateStartLine = source.slice(0, templateMatch.index + '<template>'.length).split('\n').length;
      const templateLines = template.split('\n');

      templateLines.forEach((line, offset) => {
        const trimmed = line.trim();
        if (/^[A-Za-z][A-Za-z0-9 &'’+/_-]*$/.test(trimmed) && looksLikeSourceEnglishUi(trimmed)) {
          problems.push(
            `hardcoded English UI text at ${relative}:${templateStartLine + offset} → ${JSON.stringify(trimmed)}`,
          );
        }
        for (const match of line.matchAll(/(?:^|\s)(?:title|aria-label|placeholder)=["']([^"']+)["']/g)) {
          const value = match[1].trim();
          if (!looksLikeSourceEnglishUi(value)) continue;
          problems.push(
            `hardcoded English UI attribute at ${relative}:${templateStartLine + offset} → ${JSON.stringify(value)}`,
          );
        }
      });
    }
  }

  const code = file.endsWith('.vue') ? source.slice(0, source.indexOf('<template>')) : source;
  const lines = stripNonRuntimeComments(code).split('\n');
  lines.forEach((line, index) => {
    for (const pattern of ENGLISH_UI_DIRECT_LITERAL_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const value = match[2];
        if (value.startsWith('agent.') || value.startsWith('common.')) continue;
        if (!looksLikeSourceEnglishUi(value)) continue;
        problems.push(`hardcoded English UI literal at ${relative}:${index + 1} → ${JSON.stringify(value)}`);
      }
    }
    if (!ENGLISH_UI_NAMED_HELPER.test(line)) return;
    for (const value of quotedLiterals(line)) {
      if (value.startsWith('agent.') || value.startsWith('common.')) continue;
      if (!looksLikeSourceEnglishUi(value)) continue;
      problems.push(`hardcoded English UI helper literal at ${relative}:${index + 1} → ${JSON.stringify(value)}`);
    }
  });
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
for (const file of sourceFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inBlockComment = false;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      return;
    }
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('<!--')) return;
    if (!CJK.test(line)) return;
    const id = `${file.slice(agentDir.length + 1)}:${index + 1}`;
    if (SOURCE_CJK_ALLOWLIST.has(id)) return;
    problems.push(`hardcoded CJK in source at ${id} → ${JSON.stringify(trimmed.slice(0, 90))}`);
  });
}

/*
 * §3.5 / §7.40: reachability is derived only from runtime source, never tests or
 * this checker itself. Runtime maps and dynamic prefixes remain supported, while
 * an unconsumed simple const/let `agent.*` binding is scrubbed before scanning so
 * a dummy literal cannot keep dead locale copy alive.
 */
const REFERENCE_ROOTS = [
  resolve(here, '../packages/frontend/src'),
  resolve(here, '../packages/backend/src'),
  resolve(here, '../packages/agent-runner/src'),
];

const referenceFiles = [];
const collectReferences = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.tmp' || entry === 'i18n') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectReferences(full);
    else if (/\.(vue|ts|mjs|cjs|js)$/.test(entry)) referenceFiles.push(full);
  }
};
for (const root of REFERENCE_ROOTS) collectReferences(root);

const referencedLiterals = new Set();
const referencedPrefixes = new Set();
for (const file of referenceFiles) {
  const references = collectAgentI18nReferences(readFileSync(file, 'utf8'));
  for (const literal of references.literals) referencedLiterals.add(literal);
  for (const prefix of references.prefixes) referencedPrefixes.add(prefix);
}
// A literal that is a strict prefix of dictionary keys but is not itself a key
// is a runtime-built lookahead: `translateOrRaw('agent.settings.x', value)` and
// friends concatenate the value straight onto the literal.
for (const literal of referencedLiterals) {
  if (english.has(literal)) continue;
  if ([...english.keys()].some((candidate) => candidate.startsWith(literal))) referencedPrefixes.add(literal);
}

const reachable = (key) => {
  if (referencedLiterals.has(key)) return true;
  // Template literals concatenate, so `agent.a.` + value has no separator.
  for (const prefix of referencedPrefixes) if (key === prefix || key.startsWith(prefix)) return true;
  // A key an exact literal nests under is kept as well: it is plausibly a tree
  // root the caller walks, and deleting it would be the riskier mistake.
  for (const literal of referencedLiterals) if (literal.startsWith(`${key}.`)) return true;
  return false;
};

for (const key of english.keys()) {
  if (!key.startsWith('agent.')) continue;
  if (reachable(key)) continue;
  if (UNUSED_KEY_ALLOWLIST.has(key)) continue;
  problems.push(`unused i18n key (unreachable from any source file): ${key}`);
}

if (problems.length) {
  console.error(`Agent i18n check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  'Agent i18n check passed (key parity + no verbatim locale leaks + no hardcoded CJK/English UI copy + no unused keys).',
);
