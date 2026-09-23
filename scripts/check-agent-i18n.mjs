#!/usr/bin/env node
/*
 * Guards the Agent i18n surface against three defects recorded in doc/problem.md:
 *   1. §7.15-a: a locale silently missing the English dictionary's keys;
 *   2. §7.15-a: `zh-CN` / `ja-JP` keeping an English sentence verbatim (e.g.
 *      "Denylist revision {revision}" shown inside a Chinese UI);
 *   3. §7.14-c: user-facing Chinese hardcoded in the component sources, which
 *      leaks into the English/Japanese UI.
 *
 * Anything that is genuinely untranslatable (brand, protocol, URL/sample
 * values, pure placeholders) belongs in BRAND_TERMS below, and any source line
 * that legitimately needs CJK belongs in SOURCE_CJK_ALLOWLIST.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = resolve(here, '../packages/frontend/src/features/agent');
const localeDir = join(agentDir, 'i18n');
const LOCALES = ['en-US', 'zh-CN', 'ja-JP'];

// Source lines that may keep CJK on purpose (e.g. a CJK-only regex range).
const SOURCE_CJK_ALLOWLIST = new Set([]);

// Brand / protocol / format values that are intentionally identical across locales.
const BRAND_TERMS = new Set([
  'agent.settings.providers.protocolChat',
  'agent.settings.providers.protocolResponses',
  'agent.settings.providers.baseUrlPlaceholder',
  'agent.settings.providers.modelPlaceholder',
  'agent.settings.providers.fallbackCount',
  'agent.settings.browserRuntime.title',
  'agent.settings.mcpIntegrations.endpoint',
  'agent.settings.acpRuntime.profileId',
  'agent.settings.guardrails.eventBatchValue',
  'agent.settings.guardrails.commitQueueValue',
  'agent.workspaceRuntime.targetSource',
  'agent.tasks.runId',
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

if (problems.length) {
  console.error(`Agent i18n check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  'Agent i18n check passed (key parity + no verbatim English in zh-CN / ja-JP + no hardcoded CJK in agent sources).',
);
