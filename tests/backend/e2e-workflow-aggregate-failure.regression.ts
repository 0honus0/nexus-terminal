import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../tests/e2e/playwright.config.ts', import.meta.url), 'utf8');

assert(workflow.includes('fail-fast: false'));
assert(workflow.includes('continue-on-error: true'));
assert(workflow.includes('- name: Record E2E group outcome'));
assert(workflow.includes('name: e2e-result-group-${{ matrix.group }}'));
assert(workflow.includes('playwright-result:'));
assert(workflow.includes('name: Aggregate Playwright result'));
assert(workflow.includes('pattern: e2e-result-group-*'));
assert(workflow.includes('Expected $EXPECTED_GROUPS E2E group results'));
assert(workflow.includes("needs.playwright-result.result == 'success'"));
assert(workflow.includes('PLAYWRIGHT_RESULT: ${{ needs.playwright-result.result }}'));
assert(workflow.includes('require_success "Aggregated Playwright result" "$PLAYWRIGHT_RESULT"'));
assert(!workflow.includes('Fail E2E group after collecting all results'));
assert(!workflow.includes('PLAYWRIGHT_RESULT: ${{ needs.playwright-groups.result }}'));

assert(config.includes('maxFailures: 0'));

process.stdout.write('E2E workflow aggregate failure regression: PASS\n');
