import type { IpNetwork, SourceAddresses } from '../source-address.js';
import ipaddr from 'ipaddr.js';

/** Technical IP parsing; no allowlist or authentication policy. */
export class NativeSourceAddresses implements SourceAddresses {
	normalize(value: string): string | null {
		try {
			return ipaddr.process(value).toString();
		} catch {
			return null;
		}
	}

	range(value: string): string {
		return ipaddr.process(value).range();
	}

	parseNetwork(value: string): IpNetwork {
		const [address, prefix] = value.includes('/') ? ipaddr.parseCIDR(value) : [ipaddr.parse(value), undefined];
		if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
			if (prefix !== undefined && prefix < 96) {
				throw new Error('Invalid mapped IPv4 prefix');
			}
			return { address: address.toIPv4Address().toString(), prefix: prefix === undefined ? 32 : prefix - 96 };
		}
		return { address: address.toString(), prefix: prefix ?? (address.kind() === 'ipv4' ? 32 : 128) };
	}

	matches(value: string, network: IpNetwork): boolean {
		const source = ipaddr.process(value);
		const address = ipaddr.parse(network.address);
		return source.kind() === address.kind() && source.match(address, network.prefix);
	}
}
