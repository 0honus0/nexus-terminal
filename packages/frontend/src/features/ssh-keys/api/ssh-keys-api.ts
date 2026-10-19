import { readTargetDeleted, targetNumber } from '@nexus-terminal/shared/targets/http';
import type { TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http';
import {
	readSshKeyList,
	readSshKeyView,
	readSshKeyInput,
	readSshKeyUpdateRequest,
	readSshKeyMutation,
} from '@nexus-terminal/shared/targets/ssh-keys/http-codec';
import { requestTarget } from '@/client/targets/target-request';
import { toSshKeySummary } from '../model/ssh-key-mapper';
import type { SshKeySummary } from '../model/ssh-key-types';

export const sshKeysApi = {
	async list(signal?: AbortSignal): Promise<SshKeySummary[]> {
		return (
			await requestTarget({ method: 'GET', path: '/ssh-keys', status: 200, decode: readSshKeyList, signal })
		).map(toSshKeySummary);
	},

	async create(input: TargetSshKeyInput, signal?: AbortSignal): Promise<SshKeySummary> {
		return toSshKeySummary(
			await requestTarget({
				method: 'POST',
				path: '/ssh-keys',
				status: 201,
				decode: readSshKeyView,

				input: () =>
					readSshKeyInput({
						name: input.name,
						privateKey: input.privateKey,
						...(input.passphrase === undefined ? {} : { passphrase: input.passphrase }),
					}),

				signal,
			}),
		);
	},

	async update(snapshot: SshKeySummary, input: TargetSshKeyChanges, signal?: AbortSignal): Promise<SshKeySummary> {
		const id = snapshot.id;
		const version = snapshot.version;
		const item = await requestTarget({
			method: 'PUT',
			path: `/ssh-keys/${id}`,
			status: 200,

			input: () => {
				targetNumber(id);
				return readSshKeyUpdateRequest({
					version,
					changes: {
						...(input.name === undefined ? {} : { name: input.name }),
						...(input.privateKey === undefined ? {} : { privateKey: input.privateKey }),
						...(input.passphrase === undefined ? {} : { passphrase: input.passphrase }),
					},
				});
			},

			decode: (value) => {
				const result = readSshKeyMutation(value);
				if (result.status !== 'updated' || result.value.id !== id || result.value.version !== version + 1) {
					throw new Error('Unrelated SSH key mutation');
				}
				return result.value;
			},

			signal,
		});
		return toSshKeySummary(item);
	},

	async remove(id: number, signal?: AbortSignal): Promise<void> {
		await requestTarget({
			method: 'DELETE',
			path: `/ssh-keys/${id}`,
			status: 200,

			input: () => {
				targetNumber(id);
				return undefined;
			},

			decode: readTargetDeleted,
			signal,
		});
	},
};
