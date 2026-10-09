import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentProjectDirectories } from '../../../packages/backend/src/infrastructure/agent/capabilities/agent-project-directories';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { SshFileTargetPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-file-target.port';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { contextService } from './scenario-context-helpers';
import {
	benchmarkProvider,
	benchmarkSnapshot,
	ScenarioModelCallLimiter,
	ScriptedLanguageModel,
	StaticProviderRepository,
} from './scenario-benchmark-helpers';
import { clock, scope } from './scenario-fixtures';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const projectInstructionsContextScenario = async () => {
	const context = contextService([]);
	const input = {
		scope,
		threadId: 'scenario-thread',
		runId: 'scenario-run',
		currentInput: 'Edit /repo/src/parser.ts and honor the repository instructions.',
		modelContextWindow: 8192,
		maxContextTokens: 8000,
		reservedOutputTokens: 256,
		maxRecallItems: 5,
		maxRecallBytes: 8192,
		tools: [],
	} as const;
	const plain = await context.compose(input);
	const withInstructions = await context.compose({
		...input,
		projectInstructions: [
			{
				path: '/repo/AGENTS.md',
				scopePath: '/repo',
				projectRoot: '/repo',
				hash: sha256('ROOT_RULE'),
				content: 'ROOT_RULE: run tests.',
				sourceBytes: 21,
				contentBytes: 21,
				truncated: false,
				provenance: 'ssh' as const,
				connectionId: 1,
			},
			{
				path: '/repo/src/AGENTS.md',
				scopePath: '/repo/src',
				projectRoot: '/repo',
				hash: sha256('NESTED_RULE'),
				content: 'NESTED_RULE: preserve parser.',
				sourceBytes: 28,
				contentBytes: 28,
				truncated: false,
				provenance: 'ssh' as const,
				connectionId: 1,
			},
		],
	});
	assert.notEqual(withInstructions.stablePrefixHash, plain.stablePrefixHash);
	assert.match(withInstructions.instructions.join('\n'), /ROOT_RULE/);
	assert.match(withInstructions.instructions.join('\n'), /NESTED_RULE/);
	assert.equal(withInstructions.sourceRanges.filter((entry) => entry.kind === 'project_instruction').length, 2);

	const dbDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ssh-instructions-'));
	const db = new DatabaseAdapter({ dataDirectory: dbDirectory, filename: 'instructions.sqlite', nodeEnv: 'test' });
	const remoteFiles = new Map([
		['/repo/AGENTS.md', 'SSH_ROOT_RULE'],
		['/repo/src/AGENTS.md', 'SSH_NESTED_RULE'],
		['/repo/unrelated/AGENTS.md', 'UNRELATED_RULE'],
	]);
	const directories = new Set(['/repo', '/repo/src', '/repo/unrelated']);
	let authorized = true;
	let currentHash = 'known-hash';

	const checkHash = (hash: string): void => {
		if (hash !== currentHash) throw new Error('RESOURCE_CHANGED');
	};

	const remoteFilesPort = {
		stat: async (_ctx: ToolContext, _id: number, filename: string, hash: string) => {
			checkHash(hash);
			const content = remoteFiles.get(filename);
			return {
				path: filename,
				resolvedPath: filename,
				exists: directories.has(filename) || content !== undefined,
				type: directories.has(filename) ? 'directory' : content === undefined ? null : 'file',
				sizeBytes: content === undefined ? null : Buffer.byteLength(content),
				modifiedAt: 1,
				mode: null,
				sha256: content === undefined ? null : sha256(content),
			};
		},

		list: async (_ctx: ToolContext, _id: number, directory: string, _limit: number, hash: string) => {
			checkHash(hash);
			return {
				path: directory,
				truncated: false,
				entries: [...remoteFiles]
					.filter(([filename]) => path.posix.dirname(filename) === directory)
					.map(([filename, content]) => ({
						name: path.posix.basename(filename),
						path: filename,
						type: 'file',
						sizeBytes: Buffer.byteLength(content),
						modifiedAt: 1,
					})),
			};
		},

		read: async (
			_ctx: ToolContext,
			_id: number,
			filename: string,
			_offset: number,
			_limit: number,
			hash: string,
		) => {
			checkHash(hash);
			return { content: remoteFiles.get(filename)!, truncated: false };
		},
	} as unknown as SshFileTargetPort;
	const toolContext: ToolContext = {
		...scope,
		threadId: 'scenario-thread',
		runId: 'scenario-run',
		agentRuntimeId: 'root',
		actor: { kind: 'user', userId: scope.userId },
		connectionIds: [1],
		stepId: 'project',
		signal: new AbortController().signal,
		deadlineAt: Math.floor(Date.now() / 1000) + 60,
		maxOutputBytes: 65536,
		inputRevision: 1,
	};

	try {
		await db.initialize();
		const projectDirectories = new AgentProjectDirectories(db, remoteFilesPort, async () => authorized);
		await projectDirectories.bind(toolContext, {
			connectionId: 1,
			directory: '/repo',
			configurationHash: currentHash,
		});
		const instructions = await projectDirectories.instructions(toolContext, [
			'ssh:1:/repo/src/parser.ts',
			'ssh:2:/repo/unrelated',
		]);
		assert.deepEqual(
			instructions.map((item) => item.content),
			['SSH_ROOT_RULE', 'SSH_NESTED_RULE'],
		);
		assert.ok(instructions.every((item) => item.provenance === 'ssh' && item.connectionId === 1));
		assert.equal(await projectDirectories.read({ ...toolContext, threadId: 'other-thread' }, 1), null);
		remoteFiles.set('/repo/AGENTS.md', 'UPDATED_ROOT_RULE');
		assert.equal((await projectDirectories.instructions(toolContext, []))[0]?.content, 'UPDATED_ROOT_RULE');
		authorized = false;
		await assert.rejects(() => projectDirectories.instructions(toolContext, []), /RESOURCE_FORBIDDEN/);
		authorized = true;
		currentHash = 'changed-hash';
		await assert.rejects(() => projectDirectories.instructions(toolContext, []), /RESOURCE_CHANGED/);
		currentHash = 'known-hash';

		const benchmark = {
			id: 'coding' as const,
			prompt: 'Inspect the SSH project.',
			toolName: 'scenario_noop',
			toolArgumentsJson: '{}',
			toolDescription: 'No-op tool.',
			toolInputSchema: { type: 'object', additionalProperties: false },
			toolSummary: 'noop',
			finalText: 'done',
			usage: [
				{ inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
				{ inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
			] as const,
		};
		const snapshot = benchmarkSnapshot(benchmark, scope);
		snapshot.definition.connectionIds = [1];
		snapshot.recentEntries.push({
			id: 'observed-ssh-calls',
			sequence: 2,
			kind: 'assistant_message',
			payload: {
				text: '',
				toolCalls: [
					{
						id: 'read',
						name: 'file_read',
						argumentsJson: JSON.stringify({ target: 'ssh', id: '1', path: '/repo/src/parser.ts' }),
					},
					{
						id: 'list',
						name: 'file_list',
						argumentsJson: JSON.stringify({ target: 'ssh', id: '1', path: '/repo/src' }),
					},
					{
						id: 'wrong',
						name: 'file_read',
						argumentsJson: JSON.stringify({ target: 'workspace', id: 'old', path: '/repo/ignored' }),
					},
				],
			},
			createdAt: snapshot.createdAt + 1,
		});
		const model = new ScriptedLanguageModel([]);
		const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), model, clock);
		let capturedDirectories: string[] = [];
		const runner = new ModelStepRunner(
			providers,
			contextService([]),
			model,
			new ScenarioModelCallLimiter(),
			clock,
			{
				load: async (_scope, _runId, _runtimeId, targets, _signal, requestedContext) => {
					capturedDirectories = [...targets];
					assert.deepEqual(requestedContext?.connectionIds, [1]);
					return {
						targetDirectories: [...targets],
						omitted: [],
						instructions: await projectDirectories.instructions(toolContext, targets),
					};
				},
			},
		);
		const prepared = await runner.prepare(snapshot, scope, [], {}, undefined, undefined, 'scenario-runtime-id');
		assert.deepEqual(capturedDirectories, ['ssh:1:/repo/src']);
		assert.match(prepared.contextPlan.instructions.join('\n'), /UPDATED_ROOT_RULE/);
		assert.match(prepared.contextPlan.instructions.join('\n'), /SSH_NESTED_RULE/);
		assert.doesNotMatch(prepared.contextPlan.instructions.join('\n'), /UNRELATED_RULE/);
		await projectDirectories.clearScope(scope, toolContext.threadId);
		assert.deepEqual(await projectDirectories.instructions(toolContext, []), []);
		return [
			{ name: 'ssh_project_instruction_layers', value: instructions.length, unit: 'rules' },
			{ name: 'ssh_project_target_directories', value: capturedDirectories.length, unit: 'directories' },
		];
	} finally {
		await db.close().catch(() => undefined);
		fs.rmSync(dbDirectory, { recursive: true, force: true });
	}
};
