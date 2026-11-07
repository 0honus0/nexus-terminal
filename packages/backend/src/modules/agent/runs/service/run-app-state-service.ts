import { AGENT_PLUGIN_CONTENT_CHUNK_BYTES } from '@nexus-terminal/shared/agent/plugins/content';
import { AGENT_SCOPE_MAX_NAME_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { AgentFailure } from '../../agent-failure.js';
import type { OperationScope } from '../../operations/model/operation-types.js';
import type { RunAppStateModel } from '../model/run-app-state-model.js';
import type { AppCheckpoint, AppMessageAppend, AppRunHistory, AppRunInfo } from '../model/run-app-state-types.js';

/** App-owned state and presentation; no model selection, chat policy or resume-by-loop-replay. */
export class RunAppStateService {
	constructor(private readonly model: RunAppStateModel) {}

	describe(scope: OperationScope): Promise<AppRunInfo> {
		return this.model.describe(scope);
	}

	read(scope: OperationScope): Promise<AppCheckpoint | null> {
		return this.model.read(scope);
	}

	checkpoint(
		scope: OperationScope,
		expectedVersion: number,
		input: Omit<AppCheckpoint, 'version'>,
	): Promise<AppCheckpoint> {
		if (
			!Number.isSafeInteger(expectedVersion) ||
			expectedVersion < 0 ||
			expectedVersion >= Number.MAX_SAFE_INTEGER
		) {
			throw new AgentFailure('version_conflict');
		}
		return this.model.write(scope, {
			version: expectedVersion + 1,
			state: {
				id: input.state.id,
				sha256: input.state.sha256,
				sizeBytes: input.state.sizeBytes,
				mediaType: input.state.mediaType,
			},
			consumedOperationIds: input.consumedOperationIds.map((id) => id),
			pendingIntents: input.pendingIntents.map((intent) => ({
				operationKey: intent.operationKey,
				requestSha256: intent.requestSha256,
			})),
		});
	}

	history(scope: OperationScope, before: number | null, maxBytes: number): Promise<AppRunHistory> {
		return this.model.history(scope, before, maxBytes);
	}

	append(scope: OperationScope, input: AppMessageAppend): Promise<void> {
		if (
			!Number.isSafeInteger(input.index) ||
			input.index < 0 ||
			!input.text ||
			!input.text.isWellFormed() ||
			Buffer.byteLength(input.text) > AGENT_PLUGIN_CONTENT_CHUNK_BYTES
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.append(scope, input);
	}

	setTitle(
		scope: OperationScope,
		operationId: string,
		operationHash: string,
		expectedThreadVersion: number,
		title: string,
	): Promise<boolean> {
		if (
			!Number.isSafeInteger(expectedThreadVersion) ||
			expectedThreadVersion < 1 ||
			expectedThreadVersion >= Number.MAX_SAFE_INTEGER ||
			!title.trim() ||
			title !== title.trim() ||
			!title.isWellFormed() ||
			/[\u0000-\u001f\u007f]/u.test(title) ||
			Buffer.byteLength(title) > AGENT_SCOPE_MAX_NAME_BYTES
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.setTitle(scope, operationId, operationHash, expectedThreadVersion, title);
	}
}
