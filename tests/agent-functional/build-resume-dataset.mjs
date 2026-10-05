import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('tests/agent-functional');
const dir = path.join(root, 'data/2026-10-05');
const files = fs
  .readdirSync(dir)
  .filter((name) => name.startsWith('resume-') && name.endsWith('.json'))
  .sort();
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const extras = {};
const cases = [];
for (const name of files) {
  if (!name.endsWith('-input.json')) continue;
  const base = name.slice(0, -'-input.json'.length);
  const resultName = `${base}-result.json`;
  if (!files.includes(resultName)) continue;
  const input = read(name);
  const raw = read(resultName);
  const run = raw.data;
  cases.push({
    id: base,
    input,
    actual: {
      httpStatus: raw.status,
      run: run
        ? Object.fromEntries(
            [
              'id',
              'threadId',
              'parentRunId',
              'status',
              'goalStatus',
              'verificationStatus',
              'needsReconciliation',
              'definition',
              'plan',
              'usage',
              'version',
              'createdAt',
              'completedAt',
            ]
              .filter((key) => key in run)
              .map((key) => [key, run[key]]),
          )
        : null,
      entries: raw.fullEntries ?? run?.recentEntries ?? raw.history?.data?.items ?? raw,
    },
  });
}
const caseFiles = new Set(cases.flatMap((c) => [`${c.id}-input.json`, `${c.id}-result.json`]));
for (const file of files) if (!caseFiles.has(file)) extras[file] = read(file);
const data = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  branch: 'test',
  mainBaseline: 'edbe87aa2356e1e3fe0a87afe73f852555d76273',
  fixes: ['974a310d', '55998cf4', '4a1194f1'],
  environment: {
    frontendPort: 9998,
    entry: 'https://api.honus.top',
    cdp: '172.30.30.11:9223',
    account: 'honus',
    providerEndpoint: 'https://newapi.honus.top/v1',
    modelId: 'deepseek/deepseek-v4.1-flash',
    sshTarget: 'pve_debian',
    runner: '127.0.0.1:47821',
    isolation: 'logical',
    toolchain: 'base-tools fixture with system Node wrapper',
  },
  interpretation:
    'Do not treat successful core tool steps as proof the whole Run passed. Preserve failed/interrupted cases and completion-gate notices. UI cases and authenticated public API cases are distinguished in the report. Credentials excluded.',
  checks: {
    repositoryCheck: 'PASS',
    backendBuild: 'PASS',
    runnerBuild: 'PASS',
    backendScenarios: { passed: 82, failed: 0 },
    agentE2E: {
      passed: 35,
      failed: 1,
      failureStage: 'SSH reset fixture before actual test',
      conclusiveProductFailure: false,
    },
    formatAll: 'FAIL on local ignored evidence/harness; modified production files pass targeted Prettier check',
  },
  cases,
  supplementaryEvidence: extras,
};
const serialized =
  JSON.stringify(
    data,
    (key, value) => {
      if (/^(credential|password|confirmPassword|secret|token|cookie|authorization|csrfToken|runnerToken)$/i.test(key))
        return '[REDACTED]';
      if (typeof value === 'string')
        return value
          .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
          .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
      return value;
    },
    2,
  ) + '\n';
if (/sk-[A-Za-z0-9_-]{20,}|honustest/.test(serialized)) throw new Error('UNREDACTED_TEST_CREDENTIAL');
fs.writeFileSync(path.join(root, 'RESUME_DATASET.json'), serialized, { mode: 0o600 });
console.log(
  JSON.stringify({
    cases: cases.length,
    supplementaryEvidence: Object.keys(extras).length,
    bytes: Buffer.byteLength(serialized),
    credentialScan: 'PASS',
  }),
);
