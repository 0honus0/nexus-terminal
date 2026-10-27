import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

let active = false;

const assertDenied = (probe, expectedPermission) => {
	try {
		probe();
	} catch (error) {
		if (error?.code === 'ERR_ACCESS_DENIED' && error?.permission === expectedPermission) return true;
		throw error;
	}
	throw new Error(`FULLSTACK_PERMISSION_NOT_ENFORCED:${expectedPermission}`);
};

export default {
	async activate({ context, request }) {
		const fileReadDenied = assertDenied(() => fs.readFileSync('/etc/passwd', 'utf8'), 'FileSystemRead');
		const childProcessDenied = assertDenied(() => spawnSync(process.execPath, ['--version']), 'ChildProcess');
		const current = await request({ method: 'storage.get', params: { key: 'backend.status' } });
		if (!current.ok || current.result.method !== 'storage.get') throw new Error('Backend storage read failed');
		const saved = await request({
			method: 'storage.put',
			params: {
				key: 'backend.status',
				expectedVersion: current.result.value?.version ?? 0,
				operationId: randomUUID(),
				valueJson: JSON.stringify({
					state: 'active',
					source: 'backend',
					appId: context.appId,
					version: context.version,
					protocolVersion: context.protocol,
					fileReadDenied,
					childProcessDenied,
				}),
			},
		});
		if (!saved.ok || saved.result.method !== 'storage.put') throw new Error('Backend storage write failed');
		active = true;
	},

	health() {
		return active;
	},

	quiesce() {
		active = false;
	},

	dispose() {
		active = false;
	},
};
