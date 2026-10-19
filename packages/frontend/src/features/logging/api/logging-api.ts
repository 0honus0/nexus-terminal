import { readBackendLoggingView, readBackendLoggingUpdate } from '@nexus-terminal/shared/operations/http-codec';
import type { BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';
import { requestOperation, OperationsRequestFailure } from '@/client/operations/operations-request';
import type { BackendLogging } from '../model/logging-types';

function fromLogging(value: ReturnType<typeof readBackendLoggingView>): BackendLogging {
	return {
		version: value.version,
		level: value.level,
		effectiveLevel: value.effectiveLevel,
		updatedAt: value.updatedAt,
	};
}

export const loggingApi = {
	async get(signal: AbortSignal): Promise<BackendLogging> {
		return fromLogging(
			await requestOperation({
				path: '/settings/logging',
				method: 'GET',
				decode: readBackendLoggingView,
				signal,
			}),
		);
	},

	async update(expectedVersion: number, level: BackendLogLevel, signal: AbortSignal): Promise<BackendLogging> {
		const value = await requestOperation({
			path: '/settings/logging',
			method: 'PUT',

			input: () => readBackendLoggingUpdate({ expectedVersion, level }),

			decode: readBackendLoggingView,
			signal,
		});
		if (value.version !== expectedVersion + 1 || value.level !== level)
			throw new OperationsRequestFailure('protocol_failure', 'unknown');
		return fromLogging(value);
	},
};
