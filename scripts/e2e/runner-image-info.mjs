import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function getRunnerImageInfo({ root = path.resolve(import.meta.dirname, '../..'), now = Date.now() } = {}) {
	const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

	const rootPackage = readJson('package.json');
	const e2ePackage = readJson('tests/package.json');
	const nodeVersion = fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim();
	const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(String(rootPackage.packageManager ?? ''))?.[1];
	const playwrightVersion = e2ePackage.devDependencies?.['@playwright/test'];
	if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) throw new Error(`Invalid .node-version: ${nodeVersion}`);
	if (!pnpmVersion) throw new Error(`Invalid root packageManager: ${rootPackage.packageManager}`);
	if (!/^\d+\.\d+\.\d+$/.test(String(playwrightVersion))) {
		throw new Error(`Invalid Playwright version: ${playwrightVersion}`);
	}
	if (!Number.isFinite(now) || now < 0) throw new Error('Invalid runner refresh time');

	const definitionFiles = [
		'.node-version',
		'.dockerignore',
		'package.json',
		'pnpm-lock.yaml',
		'pnpm-workspace.yaml',
		'packages/backend/package.json',
		'packages/shared/package.json',
		'packages/frontend/package.json',
		'tests/package.json',
		'tests/fixtures/runner/Dockerfile',
		'scripts/e2e/build-runner-image.sh',
		'scripts/e2e/runner-image-info.mjs',
	];

	function collectFiles(directory) {
		for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
			const name = directory + '/' + entry.name;
			if (entry.isDirectory()) collectFiles(name);
			else if (entry.isFile()) definitionFiles.push(name);
			else throw new Error('Runner inputs must be regular files: ' + name);
		}
	}

	collectFiles('scripts/patches');
	collectFiles('packages/frontend/vendor');
	const hash = crypto.createHash('sha256');
	for (const name of definitionFiles.sort()) {
		hash.update(`file=${name}\n`);
		hash.update(fs.readFileSync(path.join(root, name)));
		hash.update('\n');
	}
	const fingerprint = hash.digest('hex');
	// Refresh the base image/OS weekly; the dependency identity stays valid across a week boundary.
	const refreshWeek = Math.floor(now / (7 * 24 * 60 * 60 * 1000));
	return {
		node: nodeVersion,
		playwright: playwrightVersion,
		pnpm: pnpmVersion,
		fingerprint,
		refreshWeek,
	};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
	const info = getRunnerImageInfo();
	const field = process.argv[2];
	if (!field || field === 'json') process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
	else if (Object.hasOwn(info, field)) process.stdout.write(`${info[field]}\n`);
	else throw new Error(`Unknown runner image info field: ${field}`);
}
