import { TargetFailure } from '../../target-failure.js';
import type { HostKeyModel } from '../model/host-key-model.js';
import type { ConfirmHostKey, HostKeyTrust } from '../model/host-key-types.js';

function canonicalHost(host: string): string {
	if (typeof host !== 'string' || !host.trim() || host.length > 253 || /[\s\u0000-\u001f\u007f]/u.test(host)) {
		throw new TargetFailure('invalid_input');
	}
	return host.toLowerCase().trim();
}

function validPort(port: number): number {
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
		throw new TargetFailure('invalid_input');
	}
	return port;
}

export class HostKeyService {
	constructor(private readonly model: HostKeyModel) {}

	list(): Promise<HostKeyTrust[]> {
		return this.model.list();
	}

	confirm(input: ConfirmHostKey): Promise<HostKeyTrust> {
		const host = canonicalHost(input.host);
		const port = validPort(input.port);
		// Host key is the SSH wire public key SHA-256, not a target config hash.
		if (typeof input.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/u.test(input.fingerprint)) {
			throw new TargetFailure('invalid_input');
		}
		return this.model.confirm({ host, port, fingerprint: input.fingerprint });
	}

	remove(host: string, port: number): Promise<boolean> {
		return this.model.remove(canonicalHost(host), validPort(port));
	}
}
