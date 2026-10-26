import assert from 'node:assert/strict';
import { copyRemoteEntries } from '../../../../packages/backend/dist/modules/remote/files/service/file-copy.js';
import { RemoteFileFailure } from '../../../../packages/backend/dist/modules/remote/files/model/file-types.js';

const directory = { kind: 'directory', size: 0, mode: 0o755, modifiedAt: 1, accessedAt: 1, uid: 0, gid: 0 };
const file = { kind: 'file', size: 3, mode: 0o644, modifiedAt: 2, accessedAt: 2, uid: 0, gid: 0 };
const bodies = new Map();
const metadata = new Map([['/dest', directory]]);
const stats = new Map();
const source = {
	targetId: 1,
	fingerprint: 'source',

	stat: async () => directory,

	scan: async () => Array.from({ length: 100 }, (_, index) => ({ name: `${index}.txt`, info: file })),

	openRead: async () =>
		(async function* () {
			yield Buffer.from('abc');
		})(),
};
const destination = {
	targetId: 2,
	fingerprint: 'destination',

	async stat({ path }) {
		stats.set(path, (stats.get(path) ?? 0) + 1);
		const info = metadata.get(path);
		if (!info) throw new RemoteFileFailure('not_found');
		return info;
	},

	async mkdir({ path }) {
		metadata.set(path, directory);
	},

	async chmod({ path, mode }) {
		metadata.set(path, { ...metadata.get(path), mode });
	},

	async utimes({ path, accessedAt, modifiedAt }) {
		metadata.set(path, { ...metadata.get(path), accessedAt, modifiedAt });
	},

	async openUploadStage({ path }) {
		const chunks = [];
		return {
			async append(bytes) {
				chunks.push(Buffer.from(bytes));
			},

			async commit() {
				const bytes = Buffer.concat(chunks);
				bodies.set(path, bytes);
				metadata.set(path, { ...file, size: bytes.length });
			},

			async discard() {
				throw new Error('Unexpected stage discard');
			},
		};
	},
};
for (let task = 1; task <= 2; task++) {
	const result = await copyRemoteEntries(
		source,
		destination,
		['/source'],
		'/dest',
		'copy',
		() => 30_000,
		new AbortController().signal,
		() => {},
		() => {},
		async () => false,
	);
	assert.equal(result.completedFiles, 100);
	assert.equal(result.transferredBytes, 300);
	assert.equal(stats.get('/dest'), task, 'parent validation is shared within a task, never across tasks');
	for (let index = 0; index < 100; index++) assert.equal(bodies.get(`/dest/source/${index}.txt`).toString(), 'abc');
}
console.log('Verified task-local parent checks and exact content across 200 file copies');
