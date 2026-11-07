import { createHash } from 'node:crypto';
import { AGENT_PLUGIN_CONTENT_CHUNK_BYTES } from '@nexus-terminal/shared/agent/plugins/content';
import { AgentFailure } from '../../agent-failure.js';
import type { OperationContentModel } from '../model/operation-content-model.js';
import type {
	OperationContentDraft,
	OperationContentReference,
	OperationContentScope,
	OperationContentWriteScope,
} from '../model/operation-content-types.js';

function reference(value: OperationContentDraft): OperationContentReference {
	if (!value.sealed || value.sha256 === null) {
		throw new AgentFailure('version_conflict');
	}
	return { id: value.id, mediaType: value.mediaType, sizeBytes: value.sizeBytes, sha256: value.sha256 };
}

/** Chunked immutable content keeps full model/tool output out of finite control replies. */
export class OperationContentService {
	constructor(private readonly model: OperationContentModel) {}

	async outputs(scope: OperationContentScope): Promise<OperationContentReference[] | null> {
		const value = await this.model.exports(scope);
		return value?.kind === 'complete' ? value.references : null;
	}

	async readExport(
		scope: OperationContentScope,
		expected: OperationContentReference,
		index: number,
	): Promise<import('../model/operation-content-types.js').OperationContentPage> {
		const exported = await this.model.exports(scope);
		if (
			!exported?.references.some(
				(ref) =>
					ref.id === expected.id &&
					ref.sha256 === expected.sha256 &&
					ref.mediaType === expected.mediaType &&
					ref.sizeBytes === expected.sizeBytes,
			)
		) {
			throw new AgentFailure('not_found');
		}
		return this.read(scope, expected, index);
	}

	async open(scope: OperationContentWriteScope, ownerId: string, key: string, mediaType: string) {
		const row = await this.model.open(scope, ownerId, key, mediaType);
		return { id: row.id, chunks: row.chunks, sealed: row.sealed };
	}

	async append(scope: OperationContentWriteScope, ownerId: string, id: string, index: number, text: string) {
		const sizeBytes = Buffer.byteLength(text);
		if (
			!Number.isSafeInteger(index) ||
			index < 0 ||
			sizeBytes > AGENT_PLUGIN_CONTENT_CHUNK_BYTES ||
			!text.isWellFormed()
		) {
			throw new AgentFailure('invalid_input');
		}
		const row = await this.model.append(scope, ownerId, id, {
			index,
			text,
			sizeBytes,
			sha256: createHash('sha256').update(text).digest('hex'),
		});
		return { id: row.id, chunks: row.chunks, sealed: row.sealed };
	}

	async seal(
		scope: OperationContentWriteScope,
		ownerId: string,
		id: string,
		chunks: number,
		sha256: string,
		signal: AbortSignal,
	): Promise<OperationContentReference> {
		const row = await this.model.get(scope, id);
		if (!row || row.ownerId !== ownerId) {
			throw new AgentFailure('not_found');
		}
		if (row.chunks !== chunks) {
			throw new AgentFailure('version_conflict');
		}
		const hash = createHash('sha256');
		for (let index = 0; index < chunks; index++) {
			signal.throwIfAborted();
			const chunk = await this.model.chunk(scope, id, index);
			if (!chunk) {
				throw new AgentFailure('internal_failure');
			}
			hash.update(chunk.text);
		}
		if (hash.digest('hex') !== sha256) {
			throw new AgentFailure('idempotency_conflict');
		}
		signal.throwIfAborted();
		return reference(await this.model.seal(scope, ownerId, id, chunks, sha256));
	}

	async read(
		scope: OperationContentScope,
		expected: OperationContentReference,
		index: number,
		includeThread = false,
	) {
		const row = await this.model.readable(scope, expected.id, includeThread);
		if (!row) {
			throw new AgentFailure('not_found');
		}
		const current = reference(row);
		if (
			current.sha256 !== expected.sha256 ||
			current.sizeBytes !== expected.sizeBytes ||
			current.mediaType !== expected.mediaType
		) {
			throw new AgentFailure('version_conflict');
		}
		if (row.chunks === 0 && index === 0) {
			return { reference: current, index, text: '', nextIndex: null };
		}
		const chunk = await this.model.chunk(
			{ userId: scope.userId, appId: scope.appId, runId: row.runId },
			row.id,
			index,
		);
		if (!chunk) {
			throw new AgentFailure('not_found');
		}
		if (
			chunk.index !== index ||
			Buffer.byteLength(chunk.text) !== chunk.sizeBytes ||
			createHash('sha256').update(chunk.text).digest('hex') !== chunk.sha256
		) {
			throw new AgentFailure('internal_failure');
		}
		return { reference: current, index, text: chunk.text, nextIndex: index + 1 < row.chunks ? index + 1 : null };
	}

	async put(
		scope: OperationContentWriteScope,
		ownerId: string,
		key: string,
		mediaType: string,
		text: string,
		signal: AbortSignal,
	): Promise<OperationContentReference> {
		const row = await this.open(scope, ownerId, key, mediaType);
		let index = 0;
		for (let start = 0; start < text.length;) {
			signal.throwIfAborted();
			let end = Math.min(text.length, start + 16384);
			const last = text.charCodeAt(end - 1);
			if (end < text.length && last >= 0xd800 && last <= 0xdbff) {
				end--;
			}
			await this.append(scope, ownerId, row.id, index++, text.slice(start, end));
			start = end;
		}
		return this.seal(scope, ownerId, row.id, index, createHash('sha256').update(text).digest('hex'), signal);
	}

	async text(scope: OperationContentScope, content: OperationContentReference, signal: AbortSignal): Promise<string> {
		const texts: string[] = [];
		let index: number | null = 0;
		do {
			signal.throwIfAborted();
			const page = await this.read(scope, content, index);
			texts.push(page.text);
			index = page.nextIndex;
		} while (index !== null);
		const text = texts.join('');
		if (
			Buffer.byteLength(text) !== content.sizeBytes ||
			createHash('sha256').update(text).digest('hex') !== content.sha256
		) {
			throw new AgentFailure('internal_failure');
		}
		return text;
	}
}
