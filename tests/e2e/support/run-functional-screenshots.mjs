import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const testsRoot = path.resolve(e2eRoot, '..');
const repoRoot = path.resolve(e2eRoot, '../..');
const artifactRoot = path.resolve(
	process.env.NEXUS_TEST_ARTIFACT_DIR ?? path.join(testsRoot, '.artifacts', 'manual-functional-screenshots'),
);
fs.mkdirSync(artifactRoot, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(artifactRoot, 'run-'));
const stagingDir = path.join(runRoot, 'screenshots');
const targetDir = path.join(repoRoot, 'doc', 'imgs', 'e2e');

fs.mkdirSync(stagingDir, { recursive: true });

const result = spawnSync(
	path.join(testsRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright'),
	['test', '--config', path.join(testsRoot, 'playwright.config.ts')],
	{
		cwd: e2eRoot,
		env: {
			...process.env,
			NEXUS_TEST_ARTIFACT_DIR: runRoot,
			E2E_CAPTURE_SCREENSHOTS: '1',
			E2E_SCREENSHOT_OUTPUT_DIR: stagingDir,
		},
		stdio: 'inherit',
	},
);

if ((result.status ?? 1) !== 0) {
	console.error(`Functional screenshots failed; retained artifacts: ${runRoot}`);
	process.exit(result.status ?? 1);
}

const screenshots = fs
	.readdirSync(stagingDir)
	.filter((name) => name.endsWith('.png'))
	.sort();

if (screenshots.length === 0) {
	console.error('No functional screenshots were produced by the E2E run.');
	process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
	if (entry.isFile() && entry.name.endsWith('.png')) fs.rmSync(path.join(targetDir, entry.name));
}
for (const filename of screenshots) {
	fs.copyFileSync(path.join(stagingDir, filename), path.join(targetDir, filename));
}

console.log(`Updated ${screenshots.length} functional screenshots in ${targetDir}:`);
for (const filename of screenshots) console.log(`- ${filename}`);
