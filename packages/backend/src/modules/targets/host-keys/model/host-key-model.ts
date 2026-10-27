import { targetModelFailure } from '../../model/target-technical-failure.js';
import type { HostKeyStorage, HostKeyRecord } from '../storage/host-key-storage.js';

import type { HostKeyTrust, ConfirmHostKey } from './host-key-types.js';

export class HostKeyModel {
	constructor(private readonly storage: HostKeyStorage) {}

	async list(): Promise<HostKeyTrust[]> {
		const rows = await this.storage.list().catch(targetModelFailure);
		return rows.map((row) => this.toTrust(row));
	}

	async confirm(command: ConfirmHostKey): Promise<HostKeyTrust> {
		return this.toTrust(
			await this.storage
				.confirm({
					host: command.host,
					port: command.port,
					fingerprint: command.fingerprint,
				})
				.catch(targetModelFailure),
		);
	}

	remove(host: string, port: number): Promise<boolean> {
		return this.storage.remove(host, port).catch(targetModelFailure);
	}

	private toTrust(value: HostKeyRecord): HostKeyTrust {
		return { host: value.host, port: value.port, fingerprint: value.fingerprint, confirmedAt: value.confirmedAt };
	}
}
