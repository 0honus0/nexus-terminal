import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	activeFileManagerList,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	openConnectedFileManager,
	resetTestSshFilesystem,
} from '../../support/ssh';

test('remote file list preserves natural multilingual ordering and directory precedence when sorting', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	const names = ['file10.txt', 'file2.txt', 'file1.txt', '中文10.txt', '中文2.txt', 'Alpha.txt', 'alpha.txt'];
	const directories = ['dir10', 'dir2'];
	const root = path.resolve('.tmp/ssh-root/sort-profile');
	await mkdir(root, { recursive: true });
	await Promise.all(names.map((name) => writeFile(path.join(root, name), name)));
	await Promise.all(directories.map((name) => mkdir(path.join(root, name))));
	await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
	await openConnectedFileManager(page);
	const manager = page.getByRole('dialog', { name: 'File Manager', exact: true });
	const input = manager.locator('.file-manager-path-input input');
	await input.fill('/sort-profile');
	await input.press('Enter');
	const rows = activeFileManagerList(page).locator('tbody tr[data-filename]:not([data-file-parent])');
	await expect(rows).toHaveCount(names.length + directories.length);
	const header = manager.getByRole('columnheader').filter({ hasText: 'Name' }).first();

	const readNames = () => rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-filename')));

	// Use the former comparator as the independent browser-locale ordering oracle.
	const expected = await page.evaluate(
		({ names, directories }) => {
			const compare = (a: string, b: string) =>
				a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

			return {
				ascending: [...directories].sort(compare).concat([...names].sort(compare)),
				descending: [...directories]
					.sort((a, b) => -compare(a, b))
					.concat([...names].sort((a, b) => -compare(a, b))),
			};
		},
		{ names, directories },
	);
	if (!(await header.innerText()).includes('▲')) await header.locator('button').click();

	// Equal case-insensitive names retain server order; compare their equivalence
	// without inventing a new case-sensitive tie-breaker.
	const normalize = (items: Array<string | null>) => items.map((name) => name?.toLowerCase());

	await expect.poll(async () => normalize(await readNames())).toEqual(normalize(expected.ascending));
	await header.locator('button').click();
	await expect.poll(async () => normalize(await readNames())).toEqual(normalize(expected.descending));
	const profile = await page.evaluate(() => {
		const samples = [];
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
		for (const count of [1000, 10000]) {
			const names = Array.from({ length: count }, (_, index) => `文件-${(index * 7919) % count}.txt`);
			for (let sample = 0; sample < 3; sample++) {
				const baseline = [...names];
				let start = performance.now();
				baseline.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
				const baselineMs = performance.now() - start;
				const candidate = [...names];
				start = performance.now();
				candidate.sort(collator.compare);
				samples.push({
					count,
					sample,
					baselineMs,
					candidateMs: performance.now() - start,
					identical: baseline.every((name, index) => name === candidate[index]),
				});
			}
		}
		return samples;
	});
	expect(profile.every((sample) => sample.identical)).toBe(true);
	console.log('[file-list-sort comparator profile]', JSON.stringify(profile));
});
