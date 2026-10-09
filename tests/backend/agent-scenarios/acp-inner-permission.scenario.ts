import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import type { IntegrationRepositoryPort } from '../../../packages/backend/src/modules/agent/ai/integration.repository.port';
import type {
	AcpRuntimePort,
	IntegrationView,
} from '../../../packages/backend/src/modules/agent/ai/integrations.types';
import { createAcpExecuteTool } from '../../../packages/backend/src/modules/agent/tools/host/acp-tools';
import type { SshTargetResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';
import { SshAcpTransport } from '../../../packages/backend/src/infrastructure/agent/integrations/ssh-acp-transport';
import { AcpAdapter } from '../../../packages/backend/src/infrastructure/agent/integrations/acp.adapter';
import type { ExecutionSessionManager } from '../../../packages/backend/src/platform/execution/execution-session-manager';
import type { AgentConnectionResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';

export const acpInnerPermissionScenario = async () => {
	const scope: Scope = { userId: 1, appId: 'acp-inner-permission-app' };
	const runId = 'acp-inner-permission-run';
	const runtimeId = 'acp-inner-permission-runtime';
	const integrationId = '00000000-0000-4000-8000-000000000108';
	const workspaceId = 'retired-acp-workspace';
	const integration: IntegrationView = {
		...scope,
		id: integrationId,
		kind: 'acp',
		configuration: {
			displayName: 'SSH ACP',
			transport: 'ssh',
			protocolVersion: '1',
			argv: ['agent', '--acp'],
			cwd: '/srv/project',
		},
		hasCredential: false,
		credentialRevision: 1,
		schemaHash: null,
		enabled: true,
		version: 1,
		createdAt: 1_801_100_000,
		updatedAt: 1_801_100_000,
	};
	const sshIntegration = integration;
	const integrations = { get: async () => integration } as unknown as IntegrationRepositoryPort;
	const decisions: Array<'allow_once' | 'reject_once'> = [];
	let permissionRequests = 0;
	let expectedOperationHash = '';
	const runtime: AcpRuntimePort = {
		execute: async (_integration, _request, execution) => {
			decisions.push(
				await execution.requestPermission({
					sessionId: 'session-108',
					toolCallId: 'inner-tool-108',
					title: 'Write generated source',
					kind: 'edit',
					rawInput: { path: '/srv/project/generated.ts', bytes: 128 },
				}),
			);
			return { text: 'permission scenario complete', stopReason: 'end_turn' };
		},
	};
	const targetResolver: SshTargetResolverPort = {
		target: async (_context, connectionId) => {
			assert.equal(connectionId, 1);
			return {
				kind: 'ssh',
				target: 'ssh',
				id: '1',
				connectionId: 1,
				targetIdentity: 'ssh:1',
				endpoint: 'fixture',
				loginUser: 'fixture',
				configurationHash: 'ssh-config',
				hostKeyTrust: 'unavailable',
			};
		},
	};
	const sshTransport = {
		targets: targetResolver,

		open: async () => {
			throw new Error('Transport fixture not invoked by mocked runtime');
		},
	};
	const tool = createAcpExecuteTool(
		integrations,
		runtime,
		{ sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
		{
			request: async (toolContext, parentInspection, request) => {
				permissionRequests++;
				assert.equal(toolContext.toolCallId, 'outer-tool-108');
				assert.equal(parentInspection.operationHash, expectedOperationHash);
				assert.equal(request.sessionId, 'session-108');
				assert.equal(request.toolCallId, 'inner-tool-108');
				return 'allow_once';
			},
		},
		sshTransport,
	);
	const abort = new AbortController();
	const context: ToolContext = {
		...scope,
		actor: { kind: 'agent', userId: 1, appId: scope.appId, runId, agentRuntimeId: runtimeId },
		runId,
		agentRuntimeId: runtimeId,
		toolCallId: 'outer-tool-108',
		connectionIds: [1],
		stepId: 'acp-inner-permission-step',
		signal: abort.signal,
		deadlineAt: 1_801_100_600,
		maxOutputBytes: 64 * 1024,
		inputRevision: 1,
	};
	const canonical = await tool.inspect({ integrationId, target: 'ssh', id: '1', prompt: 'inspect' }, context, 1);
	assert.equal((canonical.normalizedArguments as Record<string, unknown>).target, 'ssh');
	assert.equal((canonical.normalizedArguments as Record<string, unknown>).id, '1');
	expectedOperationHash = canonical.operationHash;
	const reinspected = await tool.inspect(canonical.normalizedArguments, context, 1);
	assert.equal(reinspected.operationHash, canonical.operationHash);
	await assert.rejects(
		() => tool.inspect({ integrationId, target: 'workspace', id: workspaceId, prompt: 'legacy' }, context, 1),
		/ACP_TARGET_REQUIRED/,
	);
	await assert.rejects(
		() => tool.inspect({ integrationId, workspaceId, prompt: 'legacy' }, context, 1),
		/ACP_ARGUMENT_FIELD_UNSUPPORTED/,
	);
	assert.equal(permissionRequests, 0);
	await tool.execute(canonical, context);
	assert.deepEqual(
		decisions,
		['allow_once'],
		'An approved ACP inner action resumes the original SSH ACP permission request.',
	);
	let stdout: ((bytes: Uint8Array) => void) | undefined;
	let disconnected: (() => void) | undefined;
	let startedCommand = '';
	let terminated = 0;
	let closed = 0;
	const transportFixture = new SshAcpTransport(
		{
			resolve: async () => ({}),

			get: async () => ({ configurationHash: 'ssh-config' }),
		} as unknown as AgentConnectionResolverPort,
		{
			connect: async () => ({
				id: 'ssh-acp-fixture',

				onTransportClose: (listener: () => void) => {
					disconnected = listener;
					return () => {};
				},

				startCommand: async (request: { command: string; pty: boolean }) => {
					assert.equal(request.pty, false);
					startedCommand = request.command;
					return {
						write: () => true,

						onStdout: (listener: (bytes: Uint8Array) => void) => {
							stdout = listener;
							return () => {};
						},

						onError: () => () => {},

						onClose: () => () => {},

						terminate: async () => {
							terminated++;
						},
					};
				},
			}),

			close: async () => {
				closed++;
			},
		} as unknown as ExecutionSessionManager,
	);
	const byteTransport = await transportFixture.open(
		{ ...context, deadlineAt: Math.floor(Date.now() / 1000) + 60 },
		1,
		'ssh-config',
		['agent', "argument'quote", '$(not-run)'],
		'/srv/project',
	);
	assert.match(startedCommand, /exec 'agent'/);
	assert.ok(startedCommand.includes("'$(not-run)'"));
	const reader = byteTransport.readable.getReader();
	stdout!(new TextEncoder().encode('{"jsonrpc":"2.0"}\n'));
	assert.equal(new TextDecoder().decode((await reader.read()).value), '{"jsonrpc":"2.0"}\n');
	disconnected!();
	await assert.rejects(() => reader.read(), /ACP_SSH_DISCONNECTED/);
	await Promise.all([byteTransport.close(), byteTransport.close()]);
	assert.equal(terminated, 1);
	assert.equal(closed, 1);
	const cancelController = new AbortController();
	const cancelledTransport = await transportFixture.open(
		{ ...context, signal: cancelController.signal, deadlineAt: Math.floor(Date.now() / 1000) + 60 },
		1,
		'ssh-config',
		['agent'],
		'/srv/project',
	);
	const cancelledReader = cancelledTransport.readable.getReader();
	const pendingRead = cancelledReader.read();
	cancelController.abort();
	await assert.rejects(() => pendingRead, /ABORTED/);
	await cancelledTransport.close();
	assert.equal(terminated, 2);
	assert.equal(closed, 2);
	const overflowTransport = await transportFixture.open(
		{ ...context, deadlineAt: Math.floor(Date.now() / 1000) + 60 },
		1,
		'ssh-config',
		['agent'],
		'/srv/project',
	);
	stdout!(new Uint8Array(256 * 1024 + 1));
	await assert.rejects(() => overflowTransport.readable.getReader().read(), /ACP_SSH_STREAM_OVERFLOW/);
	await overflowTransport.close();
	let sshPermissionRequests = 0;
	let protocolController: ReadableStreamDefaultController<Uint8Array>;
	let protocolClosed = 0;
	const protocolMethods: string[] = [];
	const protocolReadable = new ReadableStream<Uint8Array>({
		start(controller) {
			protocolController = controller;
		},
	});

	const send = (value: unknown) => protocolController.enqueue(new TextEncoder().encode(JSON.stringify(value) + '\n'));

	const adapter = new AcpAdapter();
	const protocolResult = await adapter.execute(
		sshIntegration,
		{ workspaceId: '', generation: 0, cwd: '/srv/project', prompt: 'fixture prompt', maxOutputBytes: 4096 },
		{
			signal: context.signal,

			requestPermission: async () => 'reject_once',

			openTransport: async () => ({
				readable: protocolReadable,
				writable: new WritableStream<Uint8Array>({
					write(bytes) {
						for (const line of new TextDecoder().decode(bytes).trim().split('\n')) {
							const request = JSON.parse(line);
							protocolMethods.push(request.method);
							if (request.method === 'initialize')
								send({
									jsonrpc: '2.0',
									id: request.id,
									result: {
										protocolVersion: 1,
										agentCapabilities: {},
										agentInfo: { name: 'fixture', version: '1' },
									},
								});
							else if (request.method === 'session/new')
								send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'fixture-session' } });
							else if (request.method === 'session/prompt') {
								send({
									jsonrpc: '2.0',
									method: 'session/update',
									params: {
										sessionId: 'fixture-session',
										update: {
											sessionUpdate: 'agent_message_chunk',
											content: { type: 'text', text: 'protocol fixture complete' },
										},
									},
								});
								send({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } });
							}
						}
					},
				}),

				close: async () => {
					protocolClosed++;
					protocolController.close();
				},
			}),
		},
	);
	assert.equal(protocolResult.text, 'protocol fixture complete');
	assert.equal(protocolResult.stopReason, 'end_turn');
	assert.equal(protocolClosed, 1);
	assert.ok(
		protocolMethods.includes('initialize') &&
			protocolMethods.includes('session/new') &&
			protocolMethods.includes('session/prompt'),
		JSON.stringify(protocolMethods),
	);
	for (const candidate of [sshIntegration]) {
		const controller = new AbortController();
		const reason = new Error('cancelled while opening ACP transport');
		let closeCount = 0;
		let writeCount = 0;
		let opened!: () => void;
		let release!: () => void;
		const opening = new Promise<void>((resolve) => {
			opened = resolve;
		});
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});

		const open = async () => {
			opened();
			await barrier;
			return {
				readable: new ReadableStream<Uint8Array>(),
				writable: new WritableStream<Uint8Array>({
					write() {
						writeCount++;
					},
				}),

				close: async () => {
					closeCount++;
				},
			};
		};

		const pending = new AcpAdapter().execute(
			candidate,
			{ workspaceId, generation: 1, cwd: '/workspace/work', prompt: 'must not send', maxOutputBytes: 4096 },
			{
				signal: controller.signal,

				requestPermission: async () => 'reject_once',

				openTransport: open,
			},
		);
		const rejected = assert.rejects(pending, (error) => error === reason);
		await opening;
		controller.abort(reason);
		release();
		await rejected;
		assert.equal(closeCount, 1, `${candidate.configuration.transport}: transport closed exactly once`);
		assert.equal(writeCount, 0, `${candidate.configuration.transport}: no protocol writes after cancellation`);
	}
	const sshTool = createAcpExecuteTool(
		{ get: async () => sshIntegration } as unknown as IntegrationRepositoryPort,
		{
			execute: async (_integration, request, execution) => {
				assert.equal(request.cwd, '/srv/project');
				assert.ok(execution.openTransport);
				assert.equal(
					await execution.requestPermission({
						sessionId: 'ssh-session',
						toolCallId: 'ssh-inner',
						title: 'edit',
						kind: 'edit',
						rawInput: null,
					}),
					'reject_once',
				);
				return { text: 'SSH complete', stopReason: 'end_turn' };
			},
		},
		{ sha256Utf8: (value) => createHash('sha256').update(value).digest('hex') },
		{
			request: async () => {
				sshPermissionRequests++;
				return 'reject_once';
			},
		},
		{
			targets: {
				target: async (_context: ToolContext, connectionId: number) => {
					assert.equal(connectionId, 1);
					return {
						kind: 'ssh' as const,
						target: 'ssh' as const,
						id: '1',
						connectionId: 1,
						targetIdentity: 'ssh:1',
						endpoint: 'fixture',
						loginUser: 'fixture',
						configurationHash: 'ssh-config',
						hostKeyTrust: 'unavailable' as const,
					};
				},
			} satisfies SshTargetResolverPort,

			open: async () => {
				throw new Error('Transport fixture not invoked by mocked runtime');
			},
		},
	);
	const sshInspection = await sshTool.inspect(
		{ integrationId, target: 'ssh', id: '1', prompt: 'inspect' },
		{ ...context, connectionIds: [1] },
		1,
	);
	assert.ok(sshInspection.resourceKeys.includes('connection:1'));
	const sshReinspected = await sshTool.inspect(
		sshInspection.normalizedArguments,
		{ ...context, connectionIds: [1] },
		1,
	);
	assert.equal(sshReinspected.operationHash, sshInspection.operationHash);
	const sshResult = await sshTool.execute(sshInspection, { ...context, connectionIds: [1] });
	assert.equal(sshResult.ok, true);
	assert.equal(sshPermissionRequests, 1);
	sshIntegration.version++;
	await assert.rejects(() => sshTool.execute(sshInspection, context), /RESOURCE_CHANGED/);
	await assert.rejects(
		() => sshTool.inspect({ integrationId, target: 'workspace', id: workspaceId, prompt: 'inspect' }, context, 1),
		/ACP_TARGET_REQUIRED/,
	);

	return [
		{ name: 'acp_inner_permission_requests', value: decisions.length, unit: 'requests' },
		{ name: 'acp_inner_permission_broker_requests', value: permissionRequests, unit: 'requests' },
		{
			name: 'acp_inner_permission_allow_once',
			value: decisions.filter((decision) => decision === 'allow_once').length,
			unit: 'decisions',
		},
	];
};
