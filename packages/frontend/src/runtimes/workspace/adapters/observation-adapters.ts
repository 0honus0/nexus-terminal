import {
	readWorkspaceDockerCommand,
	readWorkspaceDockerStats,
	readWorkspaceDockerStatusResponse,
	readWorkspaceDockerStatsResponse,
} from '@nexus-terminal/shared/remote/docker/workspace-codec';
import { readWorkspaceEmptyResponse } from '@nexus-terminal/shared/remote/workspace/workspace-codec';
import { DockerFailure, toDockerStatus, toDockerStats, type DockerChannel } from '@/features/docker/public';
import { StatusFailure, toStatusSample, type StatusChannel } from '@/features/status-monitor/public';
import { WorkspaceDispatchFailure, WorkspaceRequestFailure } from '../model/workspace-error-types';
import type { WorkspaceSocket, WorkspaceAttachmentRequest } from '../protocol/workspaceSocket';

interface StatusSubscription {
	request: WorkspaceAttachmentRequest;
	started: Promise<void>;
}

function statusFailure(cause: unknown): StatusFailure {
	if (cause instanceof StatusFailure) {
		return cause;
	}
	const code = cause instanceof WorkspaceRequestFailure ? cause.code : 'remote_unavailable';
	return new StatusFailure(code, { cause });
}

function dockerFailure(cause: unknown, mutation: boolean): DockerFailure {
	if (cause instanceof DockerFailure) {
		return cause;
	}
	if (cause instanceof WorkspaceDispatchFailure) {
		return new DockerFailure(
			cause.code === 'limit_exceeded' ? cause.code : 'remote_unavailable',
			'not_dispatched',
			{
				cause,
			},
		);
	}
	if (cause instanceof WorkspaceRequestFailure) {
		return new DockerFailure(cause.code, cause.code === 'operation_unknown' ? 'unknown' : 'confirmed', { cause });
	}
	return new DockerFailure(
		mutation ? 'operation_unknown' : 'remote_unavailable',
		mutation ? 'unknown' : 'confirmed',
		{
			cause,
		},
	);
}

export function createStatusChannel(
	socket: WorkspaceSocket,
	canSend: () => boolean,
): StatusChannel & { disconnect(): void } {
	let subscription: StatusSubscription | undefined;
	return {
		subscribe(handler, error) {
			const offSample = socket.on('status.sample', (sample) => {
				if (subscription && canSend()) {
					handler(toStatusSample(sample));
				}
			});
			const offError = socket.on('status.error', (payload) => {
				if (subscription && canSend()) {
					error?.(new StatusFailure(payload.message));
				}
			});
			return () => {
				offSample();
				offError();
			};
		},

		async start() {
			if (!canSend()) {
				throw new StatusFailure('remote_unavailable');
			}
			if (subscription) {
				return subscription.started;
			}
			const request = socket.bindRequests();
			const started = (async () => {
				let response: unknown;
				try {
					response = await request('status.start', {});
				} catch (cause) {
					throw statusFailure(cause);
				}
				try {
					readWorkspaceEmptyResponse(response);
				} catch (cause) {
					throw new StatusFailure('protocol_failure', { cause });
				}
			})();
			subscription = { request, started };
			return started;
		},

		async stop() {
			const owner = subscription;
			subscription = undefined;
			if (!owner) {
				return;
			}
			// Even a lost start receipt may have installed the remote subscription.
			await owner.started.catch(() => undefined);
			let response: unknown;
			try {
				response = await owner.request('status.stop', {});
			} catch (cause) {
				throw statusFailure(cause);
			}
			try {
				readWorkspaceEmptyResponse(response);
			} catch (cause) {
				throw new StatusFailure('protocol_failure', { cause });
			}
		},

		disconnect() {
			subscription = undefined;
		},
	};
}

export function createDockerChannel(socket: WorkspaceSocket, canSend: () => boolean): DockerChannel {
	const request = async (operation: string, input: object, mutation = false): Promise<unknown> => {
		if (!canSend()) {
			throw new DockerFailure('remote_unavailable', 'not_dispatched');
		}
		try {
			return await socket.bindRequests()(operation, input);
		} catch (cause) {
			throw dockerFailure(cause, mutation);
		}
	};

	return {
		async getStatus() {
			const response = await request('docker.status', {});
			try {
				return toDockerStatus(readWorkspaceDockerStatusResponse(response));
			} catch (cause) {
				throw new DockerFailure('protocol_failure', 'confirmed', { cause });
			}
		},

		async command(containerId, command) {
			let input;
			try {
				input = readWorkspaceDockerCommand({ containerId, command });
			} catch (cause) {
				throw new DockerFailure('invalid_input', 'not_dispatched', { cause });
			}
			const response = await request('docker.command', input, true);
			try {
				readWorkspaceEmptyResponse(response);
			} catch (cause) {
				throw new DockerFailure('protocol_failure', 'unknown', { cause });
			}
		},

		async getStats(containerId) {
			let input;
			try {
				input = readWorkspaceDockerStats({ containerId });
			} catch (cause) {
				throw new DockerFailure('invalid_input', 'not_dispatched', { cause });
			}
			const response = await request('docker.stats', input);
			try {
				const value = readWorkspaceDockerStatsResponse(response);
				if (
					value &&
					value.id !== containerId &&
					value.id !== containerId.slice(0, 12) &&
					value.name !== containerId
				) {
					throw new DockerFailure('protocol_failure', 'confirmed');
				}
				return toDockerStats(value);
			} catch (cause) {
				throw new DockerFailure('protocol_failure', 'confirmed', { cause });
			}
		},
	};
}
