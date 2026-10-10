import type { HostKeyStorage, HostKeyRecord } from '../storage/host-key-storage.js';

import type { HostKeyTrust, ConfirmHostKey } from './host-key-types.js';

export class HostKeyModel {
	constructor(private readonly storage: HostKeyStorage) {}

	async list(): Promise<HostKeyTrust[]> {
		const rows = await this.storage.list();
		return rows.map((row) => this.toTrust(row));
	}

	async confirm(command: ConfirmHostKey): Promise<HostKeyTrust> {
		return this.toTrust(
			await this.storage.confirm({
				host: command.host,
				port: command.port,
				fingerprint: command.fingerprint,
			}),
		);
	}

	remove(host: string, port: number): Promise<boolean> {
		return this.storage.remove(host, port);
	}

	private toTrust(value: HostKeyRecord): HostKeyTrust {
		return { host: value.host, port: value.port, fingerprint: value.fingerprint, confirmedAt: value.confirmedAt };
	}
}
