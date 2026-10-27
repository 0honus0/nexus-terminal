import {
	readRemoteToolCheck,
	readRemoteToolCheckRequest,
	readRemoteToolInstallRequest,
	readRemoteToolInstallResponse,
	readRemoteToolError,
} from '@nexus-terminal/shared/remote/tools/http-codec';
import { TOOL_BODY_MAX_BYTES, TOOL_RESPONSE_MAX_BYTES } from '@nexus-terminal/shared/remote/tools/values';
import { requestJson } from '@/client/http/json-client';
import { ToolInstallFailure, type ToolRequirement, type ToolOffer } from '../model/tool-types';

async function request<T>(
	action: 'check' | 'install',
	body: unknown,
	signal: AbortSignal,
	decode: (value: unknown) => T,
): Promise<T> {
	let response;
	try {
		response = await requestJson({
			method: 'POST',
			url: '/api/v1/remote/tools/' + action,
			body,
			signal,
			maxRequestBytes: TOOL_BODY_MAX_BYTES,
			maxResponseBytes: TOOL_RESPONSE_MAX_BYTES,
		});
	} catch (cause) {
		throw new ToolInstallFailure(action === 'install' ? 'operation_unknown' : 'unavailable', { cause });
	}
	if (response.status >= 400) {
		let code;
		try {
			code = readRemoteToolError(response.body).code;
			if (code === 'connection_unavailable' && response.status !== 503) {
				throw new Error('Unexpected tool connection failure status');
			}
		} catch (cause) {
			throw new ToolInstallFailure(action === 'install' ? 'operation_unknown' : 'protocol_failure', { cause });
		}
		throw new ToolInstallFailure(code);
	}
	try {
		if (response.status !== 200) {
			throw new Error('Unexpected tool response');
		}
		return decode(response.body);
	} catch (cause) {
		throw new ToolInstallFailure(action === 'install' ? 'operation_unknown' : 'protocol_failure', { cause });
	}
}

export const remoteToolApi = {
	async check(input: ToolRequirement, signal: AbortSignal): Promise<ToolOffer> {
		const command =
			input.kind === 'tools'
				? { kind: input.kind, targetId: input.targetId, tools: input.tools.map((tool) => tool) }
				: {
						kind: input.kind,
						targetId: input.targetId,
						peerId: input.peerId,
						side: input.side,
						method: input.method,
					};
		const value = await request('check', readRemoteToolCheckRequest(command), signal, readRemoteToolCheck);
		const transferTool = input.kind === 'transfer' && input.method === 'scp' ? 'scp' : 'rsync';
		const expected =
			input.kind === 'tools' ? input.tools : [transferTool, ...(input.side === 'source' ? ['ssh'] : [])];
		if (
			value.targetId !== input.targetId ||
			expected.some((tool) => !value.tools.some((item) => item === tool)) ||
			value.tools.some(
				(tool) =>
					!expected.some((item) => item === tool) &&
					!(input.kind === 'transfer' && input.side === 'source' && tool === 'sshpass'),
			)
		) {
			throw new ToolInstallFailure('protocol_failure');
		}
		return {
			targetId: value.targetId,
			tools: value.tools.map((tool) => tool),
			missing: value.missing.map((tool) => tool),
			manager: value.manager,
			privilege: value.privilege,
			planId: value.planId,
			expiresAt: value.expiresAt,
		};
	},

	async install(offer: ToolOffer, password: string | undefined, signal: AbortSignal): Promise<void> {
		const result = await request(
			'install',
			readRemoteToolInstallRequest({ planId: offer.planId, ...(password === undefined ? {} : { password }) }),
			signal,
			readRemoteToolInstallResponse,
		);
		if (result.targetId !== offer.targetId) {
			throw new ToolInstallFailure('operation_unknown');
		}
	},
};
