import { HttpProblemSchema } from '../../http/http-problem-http-types.js';
import { CodedError } from '../../utils/error.js';
import {
	BackupFileSchema,
	BackupJobSchema,
	BackupPlanSchema,
	BackupStatusSchema,
	backupBase,
} from '../backup-http-types.js';
import type { z } from 'zod';

export { default as BackupTile } from './BackupTile.vue';

export { default as BackupApp } from './BackupApp.vue';

type BackupFile = z.infer<typeof BackupFileSchema>;

export class BackupApi {
	async exportFile(password: string, signal: AbortSignal) {
		return BackupFileSchema.parse(await this.#request('export', signal, { password }));
	}

	async preview(file: BackupFile, password: string, signal: AbortSignal) {
		return BackupPlanSchema.parse(await this.#request('preview', signal, { file, password }));
	}

	async restore(file: BackupFile, password: string, token: string, signal: AbortSignal) {
		return BackupStatusSchema.parse(await this.#request('restore', signal, { file, password, token }));
	}

	async status(signal: AbortSignal) {
		return BackupJobSchema.parse(await this.#request('status', signal));
	}

	async #request(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
		const response = await fetch(backupBase + '/' + path, {
			signal,
			...(body && {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			}),
		});
		const result: unknown = await response.json();
		if (!response.ok) {
			const problem = HttpProblemSchema.safeParse(result);
			throw new CodedError(problem.success ? problem.data.code : 'BACKUP_REQUEST_FAILED');
		}
		signal.throwIfAborted();
		return result;
	}
}
