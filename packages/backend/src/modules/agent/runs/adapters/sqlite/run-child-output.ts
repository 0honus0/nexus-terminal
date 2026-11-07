import { createHash } from 'node:crypto';
import { readAgentPluginAppOutcome } from '@nexus-terminal/shared/agent/plugins/app-outcome';
import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredParticipantScope, StoredChildOutputPage } from '../../storage/run-collaboration-storage.js';

/** Read immutable exported content incrementally; the output envelope itself is never presented as child text. */
export async function readChildOutputPage(
	tx: SqlReader,
	scope: StoredParticipantScope,
	outputJson: string,
	offset: number,
	maxBytes: number,
): Promise<StoredChildOutputPage> {
	const outcome = readAgentPluginAppOutcome(JSON.parse(outputJson));
	if (outcome.kind !== 'complete') {
		throw new Error('Invalid completed child output');
	}
	const digest = createHash('sha256');
	const parts: string[] = [];
	let originalBytes = 0;
	let codepoints = 0;
	let pageBytes = 2;
	let nextOffset: number | null = null;

	const consume = (text: string) => {
		digest.update(text);
		originalBytes += Buffer.byteLength(text, 'utf8');
		for (const character of text) {
			if (codepoints >= offset && nextOffset === null) {
				const bytes = Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
				if (pageBytes + bytes > maxBytes) {
					nextOffset = codepoints;
				} else {
					parts.push(character);
					pageBytes += bytes;
				}
			}
			codepoints++;
		}
	};

	for await (const text of exportedText(tx, scope, outcome.outputs)) {
		consume(text);
	}
	if (offset > codepoints) {
		return { status: 'invalid_offset' };
	}
	return { status: 'ok', sha256: digest.digest('hex'), originalBytes, offset, nextOffset, text: parts.join('') };
}

async function* exportedText(
	tx: SqlReader,
	scope: StoredParticipantScope,
	references: import('@nexus-terminal/shared/agent/plugins/content').AgentPluginContentReference[],
): AsyncGenerator<string> {
	for (const [index, ref] of references.entries()) {
		const content = await tx.one(
			`SELECT chunks FROM agent_operation_contents WHERE id=? AND user_id=? AND app_id=?
		 AND run_id=? AND sealed=1 AND sha256=? AND size_bytes=? AND media_type=?`,
			[ref.id, scope.userId, scope.appId, scope.runId, ref.sha256, ref.sizeBytes, ref.mediaType],
		);
		if (
			!content ||
			typeof content.chunks !== 'number' ||
			!Number.isSafeInteger(content.chunks) ||
			content.chunks < 0
		) {
			throw new Error('Missing exported child content');
		}
		if (index > 0) {
			yield '\n';
		}
		for (let chunk = 0; chunk < content.chunks; chunk++) {
			const row = await tx.one(
				'SELECT text FROM agent_operation_content_chunks WHERE content_id=? AND chunk_index=?',
				[ref.id, chunk],
			);
			if (!row || typeof row.text !== 'string') {
				throw new Error('Missing exported child content chunk');
			}
			yield row.text;
		}
	}
}

export async function readChildOutputPreview(
	tx: SqlReader,
	scope: StoredParticipantScope,
	outputJson: string,
): Promise<{ text: string; originalBytes: number }> {
	const outcome = readAgentPluginAppOutcome(JSON.parse(outputJson));
	if (outcome.kind !== 'complete') {
		throw new Error('Invalid completed child output');
	}
	const parts: string[] = [];
	let count = 0;
	preview: for await (const text of exportedText(tx, scope, outcome.outputs)) {
		for (const character of text) {
			if (count++ >= 1024) {
				break preview;
			}
			parts.push(character);
		}
	}
	return {
		text: parts.join(''),
		originalBytes:
			outcome.outputs.reduce((bytes, ref) => bytes + ref.sizeBytes, 0) + Math.max(0, outcome.outputs.length - 1),
	};
}
