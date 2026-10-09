import { createHash, randomUUID } from 'node:crypto';
import type { RunModel, AgentRun, CreateRunResult, CancelRunResult, RunEventPage } from '../model/run-model.js';
import { AgentOperationError, validateAgentId, validateOperationKey, validateUserId } from '../../agent-errors.js';

function validateScope(userId: number, appId: string): void {
	validateUserId(userId);
	validateAgentId(appId);
}

function validatePrompt(prompt: string): void {
	if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > 16384) {
		throw new AgentOperationError('invalid_input');
	}
}

function validateCursor(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new AgentOperationError('invalid_input');
}

function hashCommand(name: 'create_run' | 'cancel_run', value: readonly (string | number)[]): string {
	// Every field has a fixed position and schema version, including expectedVersion.
	// JSON.stringify is unambiguous for these validated scalar inputs.
	return createHash('sha256')
		.update(JSON.stringify([1, name, ...value]), 'utf8')
		.digest('hex');
}

export interface CreateRunRequest {
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
}

export interface CancelRunRequest {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
}

export class RunService {
	constructor(private readonly model: RunModel) {}

	create(request: CreateRunRequest): Promise<CreateRunResult> {
		validateScope(request.userId, request.appId);
		validateAgentId(request.threadId);
		validateOperationKey(request.operationKey);
		validatePrompt(request.prompt);
		const requestHash = hashCommand('create_run', [request.appId, request.threadId, request.prompt]);
		return this.model.create({
			userId: request.userId,
			appId: request.appId,
			threadId: request.threadId,
			id: randomUUID(),
			inputText: request.prompt,
			operationKey: request.operationKey.toLowerCase(),
			requestHash,
			createdAt: Date.now(),
		});
	}

	cancel(request: CancelRunRequest): Promise<CancelRunResult> {
		validateScope(request.userId, request.appId);
		validateAgentId(request.runId);
		validateOperationKey(request.operationKey);
		if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1) {
			throw new AgentOperationError('invalid_input');
		}
		const requestHash = hashCommand('cancel_run', [request.appId, request.runId, request.expectedVersion]);
		return this.model.cancel({
			userId: request.userId,
			appId: request.appId,
			runId: request.runId,
			expectedVersion: request.expectedVersion,
			operationKey: request.operationKey.toLowerCase(),
			requestHash,
			now: Date.now(),
		});
	}

	get(userId: number, appId: string, runId: string): Promise<AgentRun | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.model.get(userId, appId, runId);
	}

	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPage | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		validateCursor(after);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AgentOperationError('invalid_input');
		return this.model.listEvents(userId, appId, runId, after, limit);
	}
}
