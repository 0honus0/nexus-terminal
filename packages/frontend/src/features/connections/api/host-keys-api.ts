import type { TargetHostKeyConfirmRequest } from '@nexus-terminal/shared/targets/host-keys/http';
import {
	readHostKeyList,
	readHostKeyView,
	readHostKeyRequest,
	readHostKeyConfirmRequest,
	readHostKeyRemoveResponse,
} from '@nexus-terminal/shared/targets/host-keys/http-codec';
import { requestTarget } from '@/client/targets/target-request';
import { toHostKeySummary } from '../model/host-key-mapper';
import type { HostKeySummary } from '../model/host-key-types';

export const hostKeysApi = {
	async list(signal?: AbortSignal): Promise<HostKeySummary[]> {
		return (
			await requestTarget({ method: 'GET', path: '/host-keys', status: 200, decode: readHostKeyList, signal })
		).map(toHostKeySummary);
	},

	async confirm(input: TargetHostKeyConfirmRequest, signal?: AbortSignal): Promise<HostKeySummary> {
		let command: TargetHostKeyConfirmRequest;
		const result = await requestTarget({
			method: 'POST',
			path: '/host-keys/confirm',
			status: 201,
			signal,

			input: () => {
				command = readHostKeyConfirmRequest({
					host: input.host,
					port: input.port,
					fingerprint: input.fingerprint,
				});
				return command;
			},

			decode: (value) => {
				const item = readHostKeyView(value);
				if (
					item.host !== command.host ||
					item.port !== command.port ||
					item.fingerprint !== command.fingerprint
				) {
					throw new Error('Unrelated host key confirmation');
				}
				return item;
			},
		});
		return toHostKeySummary(result);
	},

	async remove(input: HostKeySummary, signal?: AbortSignal): Promise<void> {
		// Removal is host/port based; the server does not offer fingerprint CAS.
		const host = input.host;
		const port = input.port;
		await requestTarget({
			method: 'POST',
			path: '/host-keys/remove',
			status: 200,
			signal,

			input: () => readHostKeyRequest({ host, port }),

			decode: readHostKeyRemoveResponse,
		});
	},
};
