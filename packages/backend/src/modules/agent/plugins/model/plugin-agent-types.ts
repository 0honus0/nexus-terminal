import type { PluginRpcInput, PluginRpcResult } from './plugin-types.js';
import type { WorkspaceInput, WorkspaceResult } from '../../scope/model/workspace-types.js';

export type PluginFrontendInput = PluginRpcInput | WorkspaceInput;

export type PluginFrontendResult = PluginRpcResult | WorkspaceResult;

export function isPluginAgentInput(input: PluginFrontendInput): input is WorkspaceInput {
	return input.method.startsWith('agent.');
}

export function isPluginAgentResult(value: PluginFrontendResult): value is WorkspaceResult {
	return value.method.startsWith('agent.');
}
