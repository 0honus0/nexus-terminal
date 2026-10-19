export interface IpNetwork {
	address: string;
	prefix: number;
}

/** Generic address facts; allowlist and authentication policies belong to Access. */
export interface SourceAddresses {
	normalize(value: string): string | null;
	range(value: string): string;
	parseNetwork(value: string): IpNetwork;
	matches(value: string, network: IpNetwork): boolean;
}
