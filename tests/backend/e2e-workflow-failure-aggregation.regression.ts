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
assert(/- name: Record E2E group outcome\n\s+if: always\(\)/.test(workflow));
assert(workflow.indexOf('Upload Playwright report') < workflow.indexOf('Record E2E group outcome'));
assert(workflow.includes('name: Aggregate Playwright result'));
assert(workflow.includes('pattern: e2e-result-group-*'));
assert(workflow.includes('Expected $EXPECTED_GROUPS E2E group results'));
assert(
  workflow.indexOf('Expected $EXPECTED_GROUPS E2E group results') < workflow.indexOf('for result in "${results[@]}"'),
);
assert(workflow.includes('require_success "Aggregated Playwright result" "$PLAYWRIGHT_RESULT"'));
assert(config.includes('maxFailures: 0'));
assert(config.includes('corepack pnpm exec tsx src/index.ts'));
assert(config.includes('corepack pnpm run dev --host 127.0.0.1'));
assert(!config.includes('&& pnpm exec tsx src/index.ts'));

process.stdout.write('E2E workflow failure aggregation regression: PASS\n');
