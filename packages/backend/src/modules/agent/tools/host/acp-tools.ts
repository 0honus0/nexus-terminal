import type { JsonValue } from '../../agent.types';
import type { IntegrationRepositoryPort } from '../../ai/integration.repository.port';
import type { AcpIntegrationConfiguration, AcpRuntimePort, IntegrationView } from '../../ai/integrations.types';
import type { AgentTool, ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AcpPermissionRequestPort } from '../../runtime/approvals/acp-permission-broker';
import { isAgentUuid } from '../../uuid';
import { resolveSshTarget } from '../../capabilities/ssh-target-binding';
import type { SshTargetResolverPort } from '../../capabilities/ssh-target-resolver.port';
import type { AcpByteTransport } from '../../ai/integrations.types';

const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_CWD_BYTES = 4096;

const object = (value: JsonValue): Record<string, JsonValue> => {
	if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
	return value as Record<string, JsonValue>;
};

const string = (value: JsonValue | undefined, maxBytes: number): string => {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.includes('\0') ||
		Buffer.byteLength(value, 'utf8') > maxBytes
	) {
		throw new Error('TOOL_ARGUMENTS_INVALID');
	}
	return value.trim();
};

const currentIntegration = async (
	repository: IntegrationRepositoryPort,
	context: ToolContext,
	integrationId: string,
): Promise<IntegrationView & { kind: 'acp'; configuration: AcpIntegrationConfiguration }> => {
	if (!isAgentUuid(integrationId)) throw new Error('TOOL_ARGUMENTS_INVALID');
	const integration = await repository.get(context, integrationId);
	if (!integration || integration.kind !== 'acp') throw new Error('INTEGRATION_NOT_FOUND');
	if (!integration.enabled) throw new Error('INTEGRATION_DISABLED');
	if (integration.configuration.transport !== 'ssh') throw new Error('INTEGRATION_KIND_MISMATCH');
	return integration as IntegrationView & { kind: 'acp'; configuration: AcpIntegrationConfiguration };
};

export const createAcpExecuteTool = (
	integrations: IntegrationRepositoryPort,
	runtime: AcpRuntimePort,
	cryptoHash: CryptoHashPort,
	permissionRequests: AcpPermissionRequestPort,
	ssh: {
		targets: SshTargetResolverPort;
		open(
			context: ToolContext,
			connectionId: number,
			configurationHash: string,
			argv: string[],
			cwd: string,
		): Promise<AcpByteTransport>;
	},
): AgentTool => ({
	descriptor: {
		name: 'acp_execute',
		version: '1.0.0',
		description:
			'Run one approved ACP prompt on a selected SSH target/id using a configured SSH integration. Starts argv in an independent non-PTY remote SSH channel; optional absolute cwd. The remote process is not an OS sandbox. Inner sensitive-operation requests require separate Nexus approval. SSH disconnects are not replayed.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				integrationId: { type: 'string', minLength: 36, maxLength: 36 },
				target: { type: 'string', enum: ['ssh'] },
				id: { type: 'string', minLength: 1, maxLength: 128 },
				prompt: { type: 'string', minLength: 1, maxLength: MAX_PROMPT_BYTES },
				cwd: { type: 'string', minLength: 1, maxLength: MAX_CWD_BYTES },
			},
			required: ['integrationId', 'target', 'id', 'prompt'],
		},
		riskClass: 'mutate',
		capability: 'integration.acp.invoke',
	},

	isAvailable: ({ connectionIds }) => (connectionIds?.length ?? 0) > 0,

	inspect: async (input, context, policyRevision): Promise<ToolInspection> => {
		const args = object(input);
		if (
			Object.keys(args).some(
				(key) => !['integrationId', 'target', 'id', 'prompt', 'cwd', 'integrationVersion'].includes(key),
			)
		)
			throw new Error('ACP_ARGUMENT_FIELD_UNSUPPORTED');
		if (args.target !== 'ssh') throw new Error('ACP_TARGET_REQUIRED');
		const id = string(args.id, 128);
		const integrationId = string(args.integrationId, 64);
		const configured = await currentIntegration(integrations, context, integrationId);
		const binding = await resolveSshTarget(ssh.targets, context, { target: 'ssh', id });
		const cwd = args.cwd === undefined ? configured.configuration.cwd! : string(args.cwd, MAX_CWD_BYTES);
		if (!cwd.startsWith('/')) throw new Error('ACP_SSH_CWD_INVALID');
		const normalizedArguments: JsonValue = {
			integrationId,
			integrationVersion: configured.version,
			target: 'ssh',
			id,
			cwd,
			prompt: string(args.prompt, MAX_PROMPT_BYTES),
		};
		const configurationHash = hashOperation(
			{
				integration: configured.configuration as unknown as JsonValue,
				version: configured.version,
				connectionHash: binding.fingerprint.configurationHash,
			},
			cryptoHash,
		);
		const target: ToolInspection['target'] = { ...binding.fingerprint, integrationId };
		return {
			toolName: 'acp_execute',
			toolVersion: '1.0.0',
			normalizedArguments,
			target,
			resourceKeys: [...binding.resourceKeys, `integration:acp:${integrationId}`],
			risk: 'mutate',
			mutation: true,
			operationHash: hashOperation(
				{
					arguments: normalizedArguments,
					configurationHash,
					runId: context.runId,
					runtimeId: context.agentRuntimeId,
					policyRevision,
					inputRevision: context.inputRevision,
				},
				cryptoHash,
			),
			operationHashVersion: 1,
			preconditions: [
				...binding.preconditions,
				{ kind: 'metadata', key: `integration:${integrationId}:version`, observedValue: configured.version },
			],
			policyRevision,
			inputRevision: context.inputRevision,
		};
	},

	execute: async (inspection, context): Promise<ToolResult> => {
		const args = object(inspection.normalizedArguments);
		const integrationId = string(args.integrationId, 64);
		if (args.target !== 'ssh') throw new Error('ACP_TARGET_REQUIRED');
		const integration = await currentIntegration(integrations, context, integrationId);
		if (integration.version !== Number(args.integrationVersion)) throw new Error('RESOURCE_CHANGED');
		const binding = await resolveSshTarget(ssh.targets, context, { target: 'ssh', id: string(args.id, 128) });
		if (
			binding.fingerprint.configurationHash !== inspection.target.configurationHash ||
			binding.fingerprint.targetIdentity !== inspection.target.targetIdentity
		)
			throw new Error('RESOURCE_CHANGED');
		const cwd = string(args.cwd, MAX_CWD_BYTES);
		const result = await runtime.execute(
			integration,
			{
				cwd,
				prompt: string(args.prompt, MAX_PROMPT_BYTES),
				maxOutputBytes: context.maxOutputBytes,
			},
			{
				signal: context.signal,

				openTransport: () =>
					ssh.open(
						context,
						binding.connectionId!,
						binding.fingerprint.configurationHash,
						integration.configuration.argv!,
						cwd,
					),

				requestPermission: (request) => permissionRequests.request(context, inspection, request),
			},
		);
		return {
			ok: true,
			summary: `ACP execution completed (${result.stopReason}).`,
			data: { text: result.text, stopReason: result.stopReason },
			artifactRefs: [],
			truncated: false,
			outcome: 'confirmed',
			verification: {
				status: 'unverified',
				summary: 'ACP protocol completed; output is not independent verification of external facts.',
				evidenceRefs: [],
			},
		};
	},
});
