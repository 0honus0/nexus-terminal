import { controlledSshRoot } from '../service-paths';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect } from '../fixtures';

export const html = '<!doctype html><html><body><h1>HTML_REGRESSION_OK</h1></body></html>\n';

export const directory = '/file-manager-regressions';

export const fixtureRoot = path.join(controlledSshRoot);

export const archiveFiles = [
	{ name: 'index.html', bytes: Buffer.from(html) },
	{ name: 'nested/中文.txt', bytes: Buffer.from('nested ZIP regression\n') },
	{ name: 'nested/empty.txt', bytes: Buffer.alloc(0) },
];

export async function createFixtures(): Promise<void> {
	await mkdir(path.join(fixtureRoot, directory, 'nested'), { recursive: true });
	for (const file of archiveFiles) {
		await writeFile(path.join(fixtureRoot, directory, file.name), file.bytes);
	}
	for (const filename of ['regression.html', 'regression.htm', 'missing.html', 'denied.html']) {
		await writeFile(path.join(fixtureRoot, filename), html);
	}
}

export async function expectExactZip(archivePath: string): Promise<void> {
	const entries = await promisify(execFile)('unzip', ['-Z1', archivePath]);
	expect(
		entries.stdout
			.trim()
			.split('\n')
			.filter((entry) => !entry.endsWith('/'))
			.sort(),
	).toEqual(archiveFiles.map((file) => file.name).sort());
	for (const file of archiveFiles) {
		const extracted = await promisify(execFile)('unzip', ['-p', archivePath, file.name], { encoding: 'buffer' });
		expect(extracted.stdout).toEqual(file.bytes);
	}
}
