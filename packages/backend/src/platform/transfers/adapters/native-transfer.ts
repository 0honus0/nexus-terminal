import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createInterface, type Interface } from 'node:readline';
import type { MachineConnection, MachineSftpLease } from '../../ssh/ssh-port.js';
import { NativeTransferFailure } from '../transfer-port.js';
import type { NativeTransferPort, NativeTransferRequest, NativeTransferMethod } from '../transfer-port.js';

function quote(value: string): string {
	return "'" + value.replaceAll("'", "'\\''") + "'";
}

function endpoint(input: NativeTransferRequest): void {
	const dns = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/u.test(input.host);
	if (
		(!dns && !isIP(input.host)) ||
		!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(input.username) ||
		!Number.isInteger(input.port) ||
		input.port < 1 ||
		input.port > 65535 ||
		!/^[a-f0-9-]{36}$/u.test(input.executionId)
	) {
		throw new NativeTransferFailure('invalid_endpoint', 'not_started');
	}
}

async function run(
	input: NativeTransferRequest,
	machine: MachineConnection,
	command: string,
	mutating = false,
): Promise<boolean> {
	input.signal.throwIfAborted();
	const remaining = input.deadline - Date.now();
	if (remaining <= 0) {
		throw new NativeTransferFailure('transport_lost', 'not_started');
	}
	const result = await machine.execute(command, {
		signal: input.signal,
		timeoutMs: remaining,
		maxOutputBytes: 64 * 1024,
	});
	if (result.outcome.status === 'unknown') {
		throw new NativeTransferFailure('transport_lost', mutating ? 'unknown' : 'not_started');
	}
	return result.outcome.status === 'completed';
}

function pinnedKey(bytes: Uint8Array, fingerprint: string, host: string, port: number): string {
	const key = Buffer.from(bytes);
	if (key.length < 5 || key.length > 16 * 1024 || key.readUInt32BE(0) > key.length - 4) {
		throw new NativeTransferFailure('host_key_rejected', 'not_started');
	}
	const algorithm = key.subarray(4, 4 + key.readUInt32BE(0)).toString('ascii');
	const actual = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/u, '');
	if (!/^[A-Za-z0-9@._+-]{1,128}$/u.test(algorithm) || actual !== fingerprint) {
		throw new NativeTransferFailure('host_key_rejected', 'not_started');
	}
	return `${port === 22 ? host : '[' + host + ']:' + port} ${algorithm} ${key.toString('base64')}\n`;
}

/** Native source-side clients only. No application identity or task registry enters this adapter. */
export class NativeServerTransfer implements NativeTransferPort {
	async execute(input: NativeTransferRequest): Promise<NativeTransferMethod> {
		endpoint(input);
		let fs: MachineSftpLease | null = null;
		let created = false;
		let mutated = false;
		const directory = '/tmp/nexus-transfer-' + input.executionId;
		const failures: unknown[] = [];
		let result: NativeTransferMethod | null = null;
		try {
			const method = await this.select(input);
			const knownHosts = pinnedKey(input.hostPublicKey, input.hostKeyFingerprint, input.host, input.port);
			await input.validate();
			const stat = await input.source.openSftp(input.signal);
			fs = stat;
			const info = await stat.lstat(input.sourcePath, {
				signal: input.signal,
				timeoutMs: Math.min(15_000, input.deadline - Date.now()),
			});
			if (info.isSymbolicLink && method !== 'rsync') {
				// SCP dereferences links; retain SFTP's link-preserving fallback.
				throw new NativeTransferFailure('tool_missing', 'not_started');
			}
			if (info.isDirectory !== input.directory || (!info.isDirectory && !info.isFile && !info.isSymbolicLink)) {
				throw new NativeTransferFailure('command_failed', 'not_started');
			}
			await input.validate();
			const stage = await run(input, input.source, `umask 077; mkdir -m 700 -- ${quote(directory)}`, true);
			if (!stage) {
				throw new NativeTransferFailure('command_failed', 'not_started');
			}
			created = true;
			await fs.writeFile(directory + '/known_hosts', Buffer.from(knownHosts), {
				flags: 'wx',
				mode: 0o600,
				signal: input.signal,
				timeoutMs: Math.min(15_000, input.deadline - Date.now()),
			});
			if (input.authentication.kind === 'private_key') {
				await fs.writeFile(
					directory + '/key',
					Buffer.from(
						input.authentication.privateKey + (input.authentication.privateKey.endsWith('\n') ? '' : '\n'),
					),
					{
						flags: 'wx',
						mode: 0o600,
						signal: input.signal,
						timeoutMs: Math.min(15_000, input.deadline - Date.now()),
					},
				);
			}
			await input.validate();
			// A source-side SSH handshake is read-only at the target. Establish
			// peer reachability/authentication before any destination mutation;
			// the caller may relay only when this probe definitively fails.
			const { prefix, options } = this.sshOptions(input, directory);
			if (method === 'scp') {
				// Keep scp in the foreground of its PTY. Wrapping scp itself in
				// sshpass creates another session and disables OpenSSH's meter.
				await fs.writeFile(directory + '/ssh-client', Buffer.from('#!/bin/sh\nexec ' + prefix + 'ssh "$@"\n'), {
					flags: 'wx',
					mode: 0o700,
					signal: input.signal,
					timeoutMs: Math.min(15_000, input.deadline - Date.now()),
				});
			}
			const peer =
				prefix +
				'ssh ' +
				[...options, '-p', String(input.port), input.username + '@' + input.host, 'true'].map(quote).join(' ');
			if (!(await run(input, input.source, peer))) {
				throw new NativeTransferFailure('peer_unreachable', 'not_started');
			}
			await input.validate();
			input.onMutation();
			mutated = true;
			const target = await run(input, input.target, `mkdir -p -- ${quote(input.targetDirectory)}`, true);
			if (!target) {
				throw new NativeTransferFailure('command_failed', 'failed');
			}
			await input.validate();
			input.onMethod(method);
			const transfer = await this.transfer(
				input,
				this.command(input, method, directory),
				method === 'scp' && info.isFile ? info.size : undefined,
			);
			if (!transfer) {
				throw new NativeTransferFailure('command_failed', 'failed');
			}
			await input.validate();
			result = method;
		} catch (cause) {
			failures.push(
				cause instanceof NativeTransferFailure
					? cause
					: new NativeTransferFailure('transport_lost', mutated || created ? 'unknown' : 'not_started', {
							cause,
						}),
			);
		} finally {
			// Cleanup uses its own deadline and is still attempted after authority or execution cancellation.
			if (created) {
				try {
					const cleanup = await input.source.execute(
						`rm -f -- ${quote(directory + '/key')} ${quote(directory + '/known_hosts')} ${quote(directory + '/ssh-client')} && rmdir -- ${quote(directory)}`,
						{ timeoutMs: 15_000, maxOutputBytes: 1024 },
					);
					if (cleanup.outcome.status !== 'completed') {
						throw new NativeTransferFailure('cleanup_unconfirmed', 'unknown');
					}
				} catch (cause) {
					failures.push(new NativeTransferFailure('cleanup_unconfirmed', 'unknown', { cause }));
				}
			}
			try {
				await fs?.close();
			} catch (cause) {
				failures.push(new NativeTransferFailure('cleanup_unconfirmed', 'unknown', { cause }));
			}
		}
		if (failures.length) {
			if (failures.length === 1 && failures[0] instanceof NativeTransferFailure) {
				throw failures[0];
			}
			throw new NativeTransferFailure('cleanup_unconfirmed', 'unknown', {
				cause: new AggregateError(failures, 'Transfer and cleanup failed'),
			});
		}
		if (result === null) {
			throw new NativeTransferFailure('transport_lost', 'unknown');
		}
		return result;
	}

	private async transfer(input: NativeTransferRequest, command: string, scpFileBytes?: number): Promise<boolean> {
		const remaining = input.deadline - Date.now();
		if (remaining <= 0) {
			throw new NativeTransferFailure('transport_lost', 'not_started');
		}
		const signal = AbortSignal.any([input.signal, AbortSignal.timeout(remaining)]);
		// OpenSSH emits its native progress meter only to a terminal. Only the
		// control channel gets a PTY; file bytes still travel directly over SSH.
		const running = await input.source.openRawCommand(
			command,
			signal,
			'signal',
			scpFileBytes === undefined ? undefined : { columns: 160, rows: 24, term: 'dumb' },
		);
		let stopStderr: (() => void) | undefined;
		let lines: Interface | undefined;
		try {
			stopStderr = running.onStderr(() => undefined);
			lines = createInterface({ input: running.readable, crlfDelay: Infinity });
			running.writable.end();
			for await (const line of lines) {
				if (signal.aborted) {
					continue;
				}
				if (scpFileBytes !== undefined) {
					const scp = /\s(\d{1,3})%\s+[\d.]+[KMGTPE]?B\s+[\d.]+[KMGTPE]?B\/s\s+/u.exec(line);
					if (scp) {
						const percent = Number(scp[1]);
						if (percent <= 100) {
							input.onProgress(Math.floor((scpFileBytes * percent) / 100), percent);
						}
					}
					continue;
				}
				// LC_ALL=C pins rsync's numeric format. Ignore filenames and
				// diagnostics; only native progress facts leave this adapter.
				const match = /^\s*([0-9,]+)\s+(\d{1,3})%\s/u.exec(line);
				if (!match) {
					continue;
				}
				const bytes = Number(match[1]!.replaceAll(',', ''));
				const percent = Number(match[2]);
				if (Number.isSafeInteger(bytes) && bytes >= 0 && percent <= 100) {
					input.onProgress(bytes, percent);
				}
			}
			const result = await running.outcome;
			if (result.status === 'unknown') {
				throw new NativeTransferFailure('transport_lost', 'unknown');
			}
			return result.status === 'completed';
		} catch (cause) {
			const failures: unknown[] = [cause];
			try {
				running.cancel();
			} catch (cancelFailure) {
				failures.push(cancelFailure);
			}
			try {
				await running.outcome;
			} catch (exitFailure) {
				failures.push(exitFailure);
			}
			if (failures.length > 1) {
				throw new NativeTransferFailure('transport_lost', 'unknown', {
					cause: new AggregateError(failures, 'Transfer progress and shutdown failed'),
				});
			}
			throw cause;
		} finally {
			try {
				lines?.close();
			} finally {
				stopStderr?.();
			}
		}
	}

	private async select(input: NativeTransferRequest): Promise<NativeTransferMethod> {
		const auth = input.authentication;
		const password = auth.kind === 'password' || auth.passphrase !== null;
		const required = ['ssh', ...(password ? ['sshpass'] : [])];
		for (const tool of required) {
			if (!(await run(input, input.source, `command -v ${quote(tool)} >/dev/null 2>&1`))) {
				throw new NativeTransferFailure('tool_missing', 'not_started');
			}
		}
		if (input.method !== 'scp') {
			const source = await run(input, input.source, 'command -v rsync >/dev/null 2>&1');
			const target = await run(input, input.target, 'command -v rsync >/dev/null 2>&1');
			if (
				source &&
				target &&
				(await run(input, input.source, 'rsync --info=progress2 --outbuf=L --version >/dev/null 2>&1')) &&
				(await run(input, input.target, 'rsync -s --version >/dev/null 2>&1'))
			) {
				return 'rsync';
			}
			if (input.method === 'rsync') {
				throw new NativeTransferFailure('tool_missing', 'not_started');
			}
		}
		if (input.method === 'auto' && input.directory) {
			// Recursive SCP follows nested symlinks. Auto must preserve directory
			// contents like rsync/SFTP without scanning the tree in advance.
			throw new NativeTransferFailure('tool_missing', 'not_started');
		}
		for (const machine of [input.source, input.target]) {
			if (!(await run(input, machine, 'command -v scp >/dev/null 2>&1'))) {
				throw new NativeTransferFailure('tool_missing', 'not_started');
			}
		}
		return 'scp';
	}

	private sshOptions(input: NativeTransferRequest, directory: string): { prefix: string; options: string[] } {
		const options = [
			'-F',
			'/dev/null',
			'-o',
			'StrictHostKeyChecking=yes',
			'-o',
			'GlobalKnownHostsFile=/dev/null',
			'-o',
			'UserKnownHostsFile=' + directory + '/known_hosts',
			'-o',
			'IdentitiesOnly=yes',
			'-o',
			'ClearAllForwardings=yes',
			'-o',
			'ConnectTimeout=15',
			'-o',
			'ServerAliveInterval=15',
			'-o',
			'ServerAliveCountMax=2',
			'-o',
			'NumberOfPasswordPrompts=1',
		];
		const auth = input.authentication;
		let prefix = '';
		if (auth.kind === 'password') {
			prefix = 'sshpass -p ' + quote(auth.password) + ' ';
			options.push('-o', 'PreferredAuthentications=password,keyboard-interactive');
		} else {
			options.push('-i', directory + '/key');
			if (auth.passphrase !== null) {
				prefix = 'sshpass -P ' + quote('Enter passphrase for key') + ' -p ' + quote(auth.passphrase) + ' ';
			} else {
				options.push('-o', 'BatchMode=yes');
			}
		}
		return { prefix, options };
	}

	private command(input: NativeTransferRequest, method: NativeTransferMethod, directory: string): string {
		const { prefix, options } = this.sshOptions(input, directory);
		const host = isIP(input.host) === 6 ? '[' + input.host + ']' : input.host;
		const targetDirectory = input.targetDirectory === '/' ? '/' : input.targetDirectory + '/';
		const destination = input.username + '@' + host + ':' + quote(targetDirectory);
		if (method === 'rsync') {
			const ssh = prefix + 'ssh ' + [...options, '-p', String(input.port)].map(quote).join(' ');
			// Secluded arguments travel in the rsync protocol; shell quoting inside the remote path would become literal.
			const remotePath = input.username + '@' + host + ':' + targetDirectory;
			return (
				'LC_ALL=C rsync -aWs --info=progress2 --outbuf=L --no-inc-recursive -e ' +
				quote(ssh) +
				' -- ' +
				quote(input.sourcePath) +
				' ' +
				quote(remotePath)
			);
		}
		return (
			'LC_ALL=C scp -O -p ' +
			[
				'-S',
				directory + '/ssh-client',
				...options,
				'-P',
				String(input.port),
				...(input.directory ? ['-r'] : []),
				'--',
				input.sourcePath,
				destination,
			]
				.map(quote)
				.join(' ')
		);
	}
}
