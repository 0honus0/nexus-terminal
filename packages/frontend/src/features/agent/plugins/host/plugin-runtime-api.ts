import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentPluginDescriptor } from '@nexus-terminal/shared/agent/plugins/http-codec';
import {
	readAgentPluginFrontendRpc,
	readAgentPluginRpcResponse,
} from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import type {
	AgentPluginRpcEnvelope,
	AgentPluginRpcResponse,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import type { PluginFrontendDescriptor } from './plugin-runtime-types';
import { AgentManagementFailure } from '../../model/management-failure';
import {
	requestAgentManagement,
	rejectAgentManagementResponse,
	agentManagementErrorStatus,
} from '../../api/management-request';

function installationPath(appId: string): string {
	try {
		return '/plugins/installations/' + encodeURIComponent(readAgentId(appId));
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

async function readDescriptor(
	path: string,
	appId: string,
	purpose: 'app' | 'settings',
	instanceId: string,
	signal?: AbortSignal,
): Promise<PluginFrontendDescriptor> {
	const value = await requestAgentManagement({
		method: 'GET',
		path,
		maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_BODY_BYTES,
		signal,

		decode(value) {
			const item = readAgentPluginDescriptor(value);
			if (
				item.appId !== appId ||
				item.purpose !== purpose ||
				item.instanceId !== instanceId ||
				item.expiresAt <= Date.now()
			) {
				throw new Error('Plugin descriptor scope or expiry mismatch');
			}
			return item;
		},
	});
	return {
		purpose: value.purpose,
		instanceId: value.instanceId,
		appId: value.appId,
		package: {
			packageId: value.package.packageId,
			version: value.package.version,
			packageHash: value.package.packageHash,
			publisherKeyId: value.package.publisherKeyId,
		},
		uiRevision: value.uiRevision,
		version: value.version,
		url: value.url,
		grant: readAgentId(value.url.split('/')[4]),
		sdkVersion: value.sdkVersion,
		protocolVersion: value.protocolVersion,
		sandbox: value.sandbox,
		maxMessageBytes: value.maxMessageBytes,
		requestTimeoutMs: value.requestTimeoutMs,
		expiresAt: value.expiresAt,
	};
}

export function getPluginFrontendDescriptor(appId: string, signal?: AbortSignal): Promise<PluginFrontendDescriptor> {
	return readDescriptor(installationPath(appId) + '/descriptor', appId, 'app', appId, signal);
}

export function getPluginSettingsDescriptor(
	appId: string,
	instanceId: string,
	signal?: AbortSignal,
): Promise<PluginFrontendDescriptor> {
	const path =
		'/plugins/apps/' +
		encodeURIComponent(readAgentId(appId)) +
		'/instances/' +
		encodeURIComponent(readAgentId(instanceId)) +
		'/settings/descriptor';
	return readDescriptor(path, appId, 'settings', instanceId, signal);
}

/** This transport forwards the Shared RPC protocol; it never converts it to the retired SDK. */
export async function requestPluginFrontendRpc(
	descriptor: PluginFrontendDescriptor,
	envelope: AgentPluginRpcEnvelope,
	signal?: AbortSignal,
): Promise<AgentPluginRpcResponse> {
	let body;
	try {
		body = readAgentPluginFrontendRpc({ grant: descriptor.grant, envelope });
		if (descriptor.expiresAt <= Date.now()) {
			throw new Error('Expired plugin grant');
		}
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	let response;
	try {
		response = await requestJson({
			method: 'POST',
			url: '/api/v1/agent' + installationPath(descriptor.appId) + '/frontend/rpc',
			body,
			maxRequestBytes: AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			maxResponseBytes: AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(descriptor.requestTimeoutMs)])
				: AbortSignal.timeout(descriptor.requestTimeoutMs),
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new AgentManagementFailure(cause.code, cause.outcome, { cause });
		}
		throw new AgentManagementFailure('request_failed', 'unknown', { cause });
	}
	if (
		response.status >= 400 &&
		response.body !== null &&
		typeof response.body === 'object' &&
		!('type' in response.body)
	) {
		rejectAgentManagementResponse(response.status, response.body);
	}
	try {
		const result = readAgentPluginRpcResponse(response.body, body.envelope);
		if (result.ok && 'appId' in result.result && result.result.appId !== descriptor.appId)
			throw new Error('Mismatched plugin response App');
		if (response.status !== (result.ok ? 200 : agentManagementErrorStatus(result.error.code))) {
			throw new Error('Inconsistent plugin RPC status');
		}
		return result;
	} catch (cause) {
		throw new AgentManagementFailure('protocol_failure', 'unknown', { cause });
	}
}
