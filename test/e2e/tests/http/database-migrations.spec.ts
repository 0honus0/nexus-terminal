import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const e2eRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(e2eRoot, '../..');
const tsxBin = path.join(repoRoot, 'packages', 'backend', 'node_modules', '.bin', 'tsx');
const verifier = path.join(e2eRoot, 'support', 'verify-historical-rdp-migration.ts');

test('historical migration ids do not block the RDP options schema upgrade', () => {
    const output = execFileSync(tsxBin, [verifier], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    expect(output).toContain('historical RDP migration upgrade and connection list query passed');
});
