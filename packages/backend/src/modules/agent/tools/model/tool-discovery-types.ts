/** Search metadata is a projection of the current exact authorized model catalog. */
export interface ToolDiscoveryDefinition {
	name: string;
	semanticName: string;
	description: string;
	parameters: string[];
	keywords: string[];
	loader: boolean;
}

export interface ToolDiscoveryPage {
	definitions: ToolDiscoveryDefinition[];
	sha256: string;
	nextCursor: number | null;
}
