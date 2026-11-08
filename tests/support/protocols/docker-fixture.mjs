import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { onTestFinished } from 'vitest';

const execute = promisify(execFile);

/** Requires a real Docker daemon and the CI-provisioned Alpine image; never silently skips. */
export async function openDockerContainer() {
	const docker = async (...args) =>
		(await execute('docker', args, { encoding: 'utf8', timeout: 20_000 })).stdout.trim();

	await docker('info', '--format', '{{.ServerVersion}}');
	const id = await docker(
		'create',
		'--name',
		'nexus-observation-' + randomUUID(),
		'--label',
		'nexus.tests=observation',
		'--label',
		'nexus.f1=observation',
		'--stop-timeout',
		'1',
		'alpine:latest',
		'sh',
		'-c',
		'trap "exit 0" TERM; while :; do sleep 0.1; done',
	);
	let closing;

	const close = () =>
		(closing ??= Promise.resolve().then(async () => {
			const remaining = await docker('ps', '-a', '--filter', 'id=' + id, '--format', '{{.ID}}');
			if (remaining) await docker('rm', '-f', id);
		}));

	onTestFinished(close);
	return { id, docker, close };
}
