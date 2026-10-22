import { targetModelFailure } from '../../model/target-technical-failure.js';
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
		createdAt: source.createdAt,
		protocol: source.type,
		host: source.host,
		port: source.port,
		username: source.username,
		route: source.route,
	};
}

export class DesktopTargetModel {
	constructor(
		private readonly storage: DesktopTargetStorage,
		private readonly secrets: SecretBox | null,
	) {}

	async get(id: number, admit: (snapshot: DesktopTargetSnapshot) => void): Promise<ResolvedDesktopTarget | null> {
		const item = await this.storage.get(id).catch(targetModelFailure);
		if (!item) {
			return null;
		}
		const snapshot = toDesktopSnapshot(item);
		admit(snapshot);
		return this.resolve(snapshot, item.encryptedPassword);
	}

	private resolve(snapshot: DesktopTargetSnapshot, ciphertext: string | null): ResolvedDesktopTarget {
		if (ciphertext && !this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		try {
			return {
				id: snapshot.id,
				version: snapshot.version,
				createdAt: snapshot.createdAt,
				protocol: snapshot.protocol,
				host: snapshot.host,
				port: snapshot.port,
				username: snapshot.username,
				password: ciphertext && this.secrets ? this.secrets.decrypt(ciphertext, 'connection:password') : null,
			};
		} catch (cause) {
			return targetModelFailure(cause);
		}
	}
}
