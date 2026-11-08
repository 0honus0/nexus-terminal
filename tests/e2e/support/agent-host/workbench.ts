import type {
	AgentWorkspaceRequest,
	AgentWorkspaceResult,
} from '../../../../packages/shared/src/agent/scope/workspace-http';
import {
	readAgentPluginFrontendRpc,
	readAgentPluginRpcResponse,
} from '../../../../packages/shared/src/agent/plugins/frontend-rpc-codec';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../../packages/shared/src/agent/scope/workspace-http-codec';
import type { FrameLocator, Locator, Page } from '@playwright/test';

/** Host controls and trusted confirmation dialogs remain in the parent document. */
export function agentHost(page: Page): Locator {
	return page.getByRole('dialog', { name: 'Agent', exact: true });
}

/** Every chat assertion crosses the same real signed iframe used in production. */
export function agentChatFrame(page: Page, appId?: string): FrameLocator {
	const selector = appId
		? `.agent-hub-window iframe[data-agent-app-id="${appId}"]`
		: '.agent-hub-window iframe[data-agent-app-id]:visible';
	return page.locator(selector).contentFrame();
}

export function agentChatSurface(page: Page, appId?: string): Locator {
	return agentChatFrame(page, appId).locator('body');
}

/** Inspect the one captured frontend RPC receipt without replaying a mutation. */
export function readAgentChatReceipt(
	app: { id: string; version: number },
	requestBody: unknown,
	responseBody: unknown,
): { command: AgentWorkspaceRequest; result: AgentWorkspaceResult } {
	const rpc = readAgentPluginFrontendRpc(requestBody);
	const command = readAgentWorkspaceRequest({ appVersion: app.version, request: rpc.envelope.request });
	const response = readAgentPluginRpcResponse(responseBody, rpc.envelope);
	if (!response.ok) throw new Error('Expected successful original Agent RPC receipt');
	const workspace = readAgentWorkspaceResponse(
		{ appId: app.id, appVersion: app.version, result: response.result },
		app.id,
		command,
	);
	return { command, result: workspace.result };
}
