export interface AllowedNetwork {
	address: string;
	prefix: number;
}

export interface SourceAddress {
	ip: string;
	isInternal: boolean;
}
