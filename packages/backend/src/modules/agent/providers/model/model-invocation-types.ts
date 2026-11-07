import type { AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import type { FrozenModelInput } from './provider-types.js';
import type { OperationContentReference } from '../../operations/model/operation-content-types.js';
import type {
	OperationExecution,
	OperationExecutionResult,
	OperationScope,
} from '../../operations/model/operation-types.js';
import type { OperationDispatchAuthority } from '../../operations/model/operation-types.js';

export interface ModelInvocationSelection {
	providerId: string;
	modelId: string;
	configurationVersion: number;
	reasoningEffort: AgentReasoningEffort | null;
}

export interface ModelInvocationDescriptor {
	protocol: 'responses' | 'chat-completions' | 'images';
	contextWindow: number | null;
	maxOutputTokens: number | null;
	supportsTools: boolean;
	supportsImageInput: boolean;
	reasoningEfforts: AgentReasoningEffort[];
	chosenReasoningEffort: AgentReasoningEffort | null;
}

export interface ModelInvocationTool {
	name: string;
	bindingId: string;
	description: string;
	inputSchemaJson: string;
}

export interface ModelInvocationReasoning {
	id: string;
	encryptedContent: string;
	summary: string[];
}

export interface ModelInvocationCall {
	id: string;
	name: string;
	argumentsJson: string;
}

export type ModelInvocationMessage =
	| { role: 'user'; content: string | ModelInvocationUserPart[] }
	| { role: 'assistant'; content: string; toolCalls: ModelInvocationCall[]; reasoning: ModelInvocationReasoning[] }
	| { role: 'tool'; callId: string; content: string };

export type ModelInvocationUserPart =
	{ type: 'text'; text: string } | { type: 'image'; artifactId: string; version: number; sha256: string };

/** Materialized only inside the trusted model owner; plugins supply artifact references, never URLs. */
export type ModelInvocationPreparedMessage =
	| {
			role: 'user';
			content:
				| string
				| (
						| { type: 'text'; text: string }
						| {
								type: 'image';
								mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
								bytes: Uint8Array;
						  }
				  )[];
	  }
	| { role: 'assistant'; content: string; toolCalls: ModelInvocationCall[]; reasoning: ModelInvocationReasoning[] }
	| { role: 'tool'; callId: string; content: string };

export interface ModelInvocationInput {
	operationKey: string;
	model: ModelInvocationSelection;
	systemPrompt: string;
	messages: OperationContentReference;
	tools: { name: string; bindingId: string }[];
	maxOutputTokens: number;
	visible: boolean;
}

export interface ModelInvocationBody {
	text: string;
	finishReason: 'stop' | 'tool_calls';
	toolCalls: (ModelInvocationCall & { bindingId: string })[];
	reasoning: ModelInvocationReasoning[];
}

export interface ModelInvocationOutput {
	body: ModelInvocationBody;
	inputTokens: number | null;
	outputTokens: number | null;
}

export interface ModelInvocationResult {
	operationId: string;
	body: OperationContentReference;
	inputTokens: number | null;
	outputTokens: number | null;
}

export interface ModelInvocationContext {
	/** Keep trusted diagnostics before the invocation crosses the safe plugin boundary. */
	reportFailure(error: unknown): void;
	scope: OperationScope;
	callerId: string;
	parentId: string | null;
	signal: AbortSignal;
	assertCurrent(): Promise<void>;
	authorize(): Promise<OperationDispatchAuthority>;
	operation(input: OperationExecution): Promise<OperationExecutionResult>;
	resolveTools(tools: readonly { name: string; bindingId: string }[]): Promise<ModelInvocationTool[]>;
	/** The trusted owner persists provenance; the App cannot manufacture a model result. */
	onText(operationId: string, text: string): Promise<void>;
	assertArtifactAccess(): Promise<void>;
}

export interface ModelInvocationCommand {
	frozen: FrozenModelInput;
	systemPrompt: string;
	messages: ModelInvocationPreparedMessage[];
	tools: ModelInvocationTool[];
	maxOutputTokens: number;
}
