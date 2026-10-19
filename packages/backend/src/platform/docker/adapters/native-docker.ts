import {
	DockerFailure,
	type DockerPort,
	type DockerStats,
	type DockerStatus,
	type DockerContainer,
	type DockerPortBinding,
	type DockerAction,
} from '../docker-port.js';
import type { MachineCommandExecutor } from '../../ssh/ssh-port.js';
import type { MachineCommandResult } from '../../ssh/ssh-port.js';

function text(value: unknown): string {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 64 * 1024) {
		throw new DockerFailure('invalid_output');
	}
	return value;
}

function object(line: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch (cause) {
		throw new DockerFailure('invalid_output', { cause });
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new DockerFailure('invalid_output');
	}
	return value as Record<string, unknown>;
}

function ports(value: string): DockerPortBinding[] {
	if (!value) {
		return [];
	}
	return value.split(/,\s*/u).map((entry) => {
		const parts = entry.split('->');
		const privatePart = parts.at(-1)?.match(/^(\d+)\/(\w+)$/u);
		if (!privatePart?.[1] || !privatePart[2] || parts.length > 2) {
			throw new DockerFailure('invalid_output');
		}
		const port: DockerPortBinding = { privatePort: Number(privatePart[1]), protocol: privatePart[2] };
		if (parts.length === 2) {
			const match = parts[0]?.match(/^(.*):(\d+)$/u);
			if (!match?.[2]) {
				throw new DockerFailure('invalid_output');
			}
			port.ip = match[1] ?? '';
			port.publicPort = Number(match[2]);
		}
		if (
			port.privatePort < 1 ||
			port.privatePort > 65535 ||
			(port.publicPort !== undefined && (port.publicPort < 1 || port.publicPort > 65535))
		) {
			throw new DockerFailure('invalid_output');
		}
		return port;
	});
}

function stats(value: Record<string, unknown>): DockerStats {
	return {
		id: text(value.ID),
		name: text(value.Name),
		cpuPercent: text(value.CPUPerc),
		memoryUsage: text(value.MemUsage),
		memoryPercent: text(value.MemPerc),
		networkIO: text(value.NetIO),
		blockIO: text(value.BlockIO),
		processes: text(value.PIDs),
	};
}

function lines(value: string): string[] {
	return value.trim() ? value.trim().split('\n') : [];
}

function completed(result: MachineCommandResult): void {
	if (result.outcome.status === 'unknown') {
		throw new DockerFailure('unknown');
	}
	if (result.outcome.status !== 'completed') {
		throw new DockerFailure('failed');
	}
	if (result.truncated) {
		throw new DockerFailure('invalid_output');
	}
}

function identifier(id: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(id)) {
		throw new DockerFailure('failed');
	}
	return "'" + id + "'";
}

/** Native CLI syntax and Docker's JSON representation stay at this boundary. */
export class NativeDockerAdapter implements DockerPort {
	async status(execute: MachineCommandExecutor, signal: AbortSignal): Promise<DockerStatus> {
		const version = await execute("docker version --format '{{.Server.Version}}'", {
			timeoutMs: 10_000,
			maxOutputBytes: 64 * 1024,
			signal,
		});
		if (version.outcome.status === 'nonzero') {
			return { available: false, containers: [] };
		}
		completed(version);
		if (!version.stdout.trim()) {
			return { available: false, containers: [] };
		}
		const result = await execute("docker ps -a --no-trunc --format '{{json .}}'", {
			timeoutMs: 15_000,
			maxOutputBytes: 4 * 1024 * 1024,
			signal,
		});
		completed(result);
		const containers: DockerContainer[] = lines(result.stdout).map((line) => {
			const row = object(line);
			const id = text(row.ID);
			identifier(id);
			return {
				id,
				names: text(row.Names).split(','),
				image: text(row.Image),
				imageId: typeof row.ImageID === 'string' ? text(row.ImageID) : '',
				command: text(row.Command),
				created: text(row.CreatedAt),
				state: text(row.State),
				status: text(row.Status),
				ports: ports(text(row.Ports)),
				labels: text(row.Labels),
				stats: null,
			};
		});
		if (
			containers.length > 4096 ||
			new Set(containers.map((container) => container.id)).size !== containers.length
		) {
			throw new DockerFailure('invalid_output');
		}
		const running = containers.filter((container) => container.state === 'running');
		if (running.length) {
			const sampled = await execute(
				'docker stats ' +
					running.map((container) => identifier(container.id)).join(' ') +
					" --no-stream --format '{{json .}}'",
				{ timeoutMs: 15_000, maxOutputBytes: 4 * 1024 * 1024, signal },
			);
			// A container may stop between ps and stats. Null stats do not assert a zero sample.
			if (sampled.outcome.status === 'nonzero') {
				return { available: true, containers };
			}
			completed(sampled);
			const values = lines(sampled.stdout).map((line) => stats(object(line)));
			if (
				new Set(values.map((value) => value.id)).size !== values.length ||
				values.some(
					(value) =>
						!running.some(
							(container) => value.id === container.id || value.id === container.id.slice(0, 12),
						),
				)
			) {
				throw new DockerFailure('invalid_output');
			}
			for (const container of containers) {
				container.stats =
					values.find((value) => value.id === container.id || value.id === container.id.slice(0, 12)) ?? null;
			}
		}
		return { available: true, containers };
	}

	async stats(execute: MachineCommandExecutor, id: string, signal: AbortSignal): Promise<DockerStats | null> {
		const result = await execute('docker stats ' + identifier(id) + " --no-stream --format '{{json .}}'", {
			timeoutMs: 15_000,
			maxOutputBytes: 1024 * 1024,
			signal,
		});
		completed(result);
		const rows = lines(result.stdout);
		if (!rows.length) {
			return null;
		}
		if (rows.length !== 1) {
			throw new DockerFailure('invalid_output');
		}
		const value = stats(object(rows[0] ?? ''));
		if (value.id !== id && value.id !== id.slice(0, 12) && value.name !== id) {
			throw new DockerFailure('invalid_output');
		}
		return value;
	}

	async command(
		execute: MachineCommandExecutor,
		id: string,
		action: DockerAction,
		signal: AbortSignal,
	): Promise<void> {
		const verb = action === 'remove' ? 'rm -f' : action;
		const result = await execute('docker ' + verb + ' ' + identifier(id), {
			timeoutMs: action === 'stop' ? 30_000 : 20_000,
			maxOutputBytes: 1024 * 1024,
			signal,
		});
		completed(result);
	}
}
