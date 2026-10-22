import type { SessionModel } from '../../sessions/model/session-model.js';
import type { LoginFailurePolicy } from '../../login-failure-policy.js';
import type { SourceAddressModel } from '../model/source-address-model.js';
import type { AllowedNetwork, SourceAddress } from '../model/admission-types.js';
import { readAllowedNetworks } from '../source-ip-rules.js';

/** One Access entry policy shared by HTTP requests and WS upgrades. */
export class SourceAdmissionService {
	private networks: readonly AllowedNetwork[];

	constructor(
		whitelist: string,
		private readonly addresses: SourceAddressModel,
		private readonly sessions: SessionModel,
		private readonly failures: LoginFailurePolicy,
	) {
		this.networks = readAllowedNetworks(whitelist).map((entry) => addresses.parseNetwork(entry));
	}

	prepareWhitelist(whitelist: string): () => void {
		const networks = readAllowedNetworks(whitelist).map((entry) => this.addresses.parseNetwork(entry));
		return () => {
			this.networks = networks;
		};
	}

	async admit(source: string): Promise<boolean> {
		const address = this.addresses.resolve(source);
		if (address === null || !this.isAllowed(address)) {
			return false;
		}
		if (!this.failures.shouldEnforce(address.isInternal)) {
			return true;
		}
		const admitted = await this.sessions.checkLoginAdmission(address.ip);
		return this.isAllowed(address) && (!this.failures.shouldEnforce(address.isInternal) || admitted);
	}

	async admitAuthenticationSource(source: string): Promise<boolean> {
		const address = this.addresses.resolve(source);
		return address !== null && this.isAllowed(address);
	}

	private isAllowed(address: SourceAddress): boolean {
		return address.isInternal || this.networks.length === 0 || this.addresses.matches(address.ip, this.networks);
	}
}
