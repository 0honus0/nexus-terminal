import type { DesktopTargetStorage, StoredDesktopTarget } from '../storage/desktop-target-storage.js';
import type { DesktopTargetSnapshot, ResolvedDesktopTarget } from './desktop-target-types.js';
import { TargetFailure } from '../../target-failure.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';

/** Required explicit storage → application transformation. */
function toDesktopSnapshot(source: StoredDesktopTarget): DesktopTargetSnapshot {
	if (source.type !== 'RDP' && source.type !== 'VNC') {
		throw new TargetFailure('invalid_input');
	}
	return {
		id: source.id,
		version: source.version,
		protocol: source.type,
		host: source.host,
		port: source.port,
		username: source.username,
		route: source.route,
		rdpRemoteApp: source.rdpRemoteApp,
		rdpRemoteAppDirectory: source.rdpRemoteAppDirectory,
		rdpRemoteAppArguments: source.rdpRemoteAppArguments,
		ciphertext: source.encryptedPassword,
	};
}

export class DesktopTargetModel {
	constructor(
		private readonly storage: DesktopTargetStorage,
		private readonly secrets: SecretBox | null,
	) {}

	async get(id: number): Promise<DesktopTargetSnapshot | null> {
		const item = await this.storage.get(id);
		return item ? toDesktopSnapshot(item) : null;
	}

	resolve(snapshot: DesktopTargetSnapshot): ResolvedDesktopTarget {
		if (snapshot.ciphertext && !this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		return {
			id: snapshot.id,
			version: snapshot.version,
			protocol: snapshot.protocol,
			host: snapshot.host,
			port: snapshot.port,
			username: snapshot.username,
			password:
				snapshot.ciphertext && this.secrets
					? this.secrets.decrypt(snapshot.ciphertext, 'connection:password')
					: null,
			rdpRemoteApp: snapshot.rdpRemoteApp,
			rdpRemoteAppDirectory: snapshot.rdpRemoteAppDirectory,
			rdpRemoteAppArguments: snapshot.rdpRemoteAppArguments,
		};
	}

	markAttempt(id: number, version: number, timestamp: number): Promise<boolean> {
		return this.storage.markAttempt(id, version, timestamp);
	}
}
