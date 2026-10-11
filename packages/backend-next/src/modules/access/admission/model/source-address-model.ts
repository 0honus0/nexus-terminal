import type { SourceAddresses } from '../../../../platform/security/source-address.js';
import type { AllowedNetwork, SourceAddress } from './admission-types.js';
import { AccessFailure } from '../../authentication/model/access-failure.js';
import { isInternalRange } from '../source-ip-rules.js';

export class SourceAddressModel {
	constructor(private readonly addresses: SourceAddresses) {}

	resolve(value: string): SourceAddress | null {
		const ip = this.addresses.normalize(value);
		return ip === null ? null : { ip, isInternal: isInternalRange(this.addresses.range(ip)) };
	}

	parseNetwork(value: string): AllowedNetwork {
		try {
			const network = this.addresses.parseNetwork(value);
			return { address: network.address, prefix: network.prefix };
		} catch (error) {
			throw new AccessFailure('invalid_input', { cause: error });
		}
	}

	matches(source: string, networks: readonly AllowedNetwork[]): boolean {
		return networks.some((network) =>
			this.addresses.matches(source, {
				address: network.address,
				prefix: network.prefix,
			}),
		);
	}
}
