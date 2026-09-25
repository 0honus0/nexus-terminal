import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../tests/e2e/playwright.config.ts', import.meta.url), 'utf8');

assert(workflow.includes('fail-fast: false'));
assert(
  /- name: Run E2E group[\s\S]*?id: e2e[\s\S]*?continue-on-error: true[\s\S]*?run: node tests\/e2e\/support\/groups\.mjs run/.test(
    workflow,
  ),
);
assert(
  workflow.includes(
    "- name: Fail E2E group after collecting all results\n        if: ${{ always() && steps.e2e.outcome != 'success' }}",
  ),
);
assert(workflow.indexOf('Upload Playwright report') < workflow.indexOf('Fail E2E group after collecting all results'));
assert(config.includes('maxFailures: 0'));

process.stdout.write('E2E workflow failure aggregation regression: PASS\n');
