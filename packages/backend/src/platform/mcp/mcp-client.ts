/** Technical MCP facts. Application identity, configuration and permission remain with the caller. */
export interface McpEndpoint {
	client: { name: string; version: string };
	key: string;
	generation: number;
	url: string;
	privateAuthorities: readonly string[];
	credential: string | null;
	protocolVersion: string;
}

export interface McpCatalog {
	serverName: string;
	serverVersion: string;
	protocolVersion: string;
	tools: { name: string; description: string; inputSchemaJson: string }[];
	resources: { uri: string; name: string }[];
	prompts: { name: string; description: string }[];
}

export interface McpRequest {
	kind: 'tool' | 'resource' | 'prompt';
	name: string;
	argumentsJson: string;
	resume: { requestState: string | null; inputResponsesJson: string } | null;
}

export type McpReply =
	| { kind: 'complete'; resultJson: string }
	| { kind: 'input_required'; requestState: string | null; inputRequestsJson: string };

export interface McpClient {
	close(key: string): Promise<void>;
	closeAll(): Promise<void>;
	discover(endpoint: McpEndpoint, signal: AbortSignal): Promise<McpCatalog>;
	invoke(endpoint: McpEndpoint, request: McpRequest, signal: AbortSignal): Promise<McpReply>;
}

export class McpFailure extends Error {
	constructor(
		readonly kind: 'invalid_response' | 'unavailable' | 'limit_exceeded' | 'cleanup_failed' | 'execution_unknown',
		options?: ErrorOptions,
	) {
		super(kind, options);
		this.name = 'McpFailure';
	}
}
