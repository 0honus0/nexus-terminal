import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { BlobStore } from '../../../../platform/blobs/blob-store.js';
import { BlobFailure } from '../../../../platform/blobs/blob-store.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import type { BackgroundKind } from '@nexus-terminal/shared/preferences/appearance/values';
import { AppearanceFailure, AppearanceResourceFailure } from '../../appearance-failure.js';
import type { BackgroundStorage, StoredBackgroundFacts } from '../storage/background-storage.js';
import type { AppearanceActor, AppearanceRecord } from './appearance-types.js';
import type {
	BackgroundRecord,
	BackgroundWriteFacts,
	BackgroundContent,
	BackgroundInspection,
} from './background-types.js';
import { fromStoredAppearance } from './appearance-model.js';
import type { ImageInspector, ImageFormat } from '../../../../platform/images/image-inspector.js';
import type { BackgroundMediaType } from '@nexus-terminal/shared/preferences/appearance/values';
const MEDIA_TYPES: Record<ImageFormat, BackgroundMediaType> = {
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
};

function fromFacts(value: StoredBackgroundFacts): BackgroundWriteFacts {
	return {
		appearance: value.appearance === null ? null : fromStoredAppearance(value.appearance),
		totalCount: value.totalCount,
	};
}

async function boundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof AppearanceFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			throw new AppearanceFailure(
				cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed'
					? 'operation_unknown'
					: 'storage_unavailable',
				{ cause },
			);
		}
		if (cause instanceof BlobFailure) {
			if (cause.kind === 'aborted') {
				throw new AppearanceFailure('unavailable', { cause });
			}
			if (cause.kind === 'cleanup_failed') {
				throw new AppearanceResourceFailure({ cause });
			}
			throw new AppearanceFailure(
				cause.kind === 'io_unknown'
					? 'operation_unknown'
					: cause.kind === 'limit_exceeded'
						? 'limit_exceeded'
						: 'storage_unavailable',
				{ cause },
			);
		}
		throw new AppearanceFailure('internal_failure', { cause });
	}
}

export class BackgroundModel {
	constructor(
		private readonly storage: BackgroundStorage,
		private readonly blobs: BlobStore,
		private readonly tokens: SessionTokens,
		private readonly images: ImageInspector,
	) {}

	inspect(bytes: Uint8Array): BackgroundInspection {
		try {
			const facts = this.images.inspect(bytes);
			return {
				mediaType: facts.format === null ? null : MEDIA_TYPES[facts.format],
				sizeBytes: facts.sizeBytes,
				sha256: facts.sha256,
			};
		} catch (cause) {
			throw new AppearanceFailure('internal_failure', { cause });
		}
	}

	stage(
		actor: AppearanceActor,
		record: BackgroundRecord,
		admitIdentity: (userId: number | null) => void,
		admit: (facts: BackgroundWriteFacts) => void,
	): Promise<void> {
		return boundary(() =>
			this.storage.stage(
				{
					id: record.id,
					userId: record.userId,
					kind: record.kind,
					mediaType: record.mediaType,
					sizeBytes: record.sizeBytes,
					sha256: record.sha256,
				},
				{ sessionDigest: this.tokens.digest(actor.token), admit: admitIdentity },
				(facts) => admit(fromFacts(facts)),
			),
		);
	}

	publish(record: BackgroundRecord, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
		return boundary(async () => {
			const facts = await this.blobs.write(
				record.id,
				(async function* () {
					yield Uint8Array.from(bytes);
				})(),
				record.sizeBytes,
				signal,
			);
			if (facts.bytes !== record.sizeBytes || facts.sha256 !== record.sha256) {
				throw new AppearanceFailure('operation_unknown');
			}
		});
	}

	async activate(
		actor: AppearanceActor,
		id: string,
		expectedVersion: number,
		admitIdentity: (userId: number | null) => void,
		admit: (facts: BackgroundWriteFacts) => void,
	): Promise<AppearanceRecord> {
		const row = await boundary(() =>
			this.storage.activate(
				id,
				actor.userId,
				expectedVersion,
				{ sessionDigest: this.tokens.digest(actor.token), admit: admitIdentity },
				(facts) => admit(fromFacts(facts)),
			),
		);
		try {
			return fromStoredAppearance(row);
		} catch (cause) {
			throw new AppearanceFailure('operation_unknown', { cause });
		}
	}

	async clear(
		actor: AppearanceActor,
		kind: BackgroundKind,
		admitIdentity: (userId: number | null) => void,
		admit: (facts: BackgroundWriteFacts) => void,
	): Promise<AppearanceRecord> {
		const row = await boundary(() =>
			this.storage.clear(
				kind,
				actor.userId,
				{ sessionDigest: this.tokens.digest(actor.token), admit: admitIdentity },
				(facts) => admit(fromFacts(facts)),
			),
		);
		try {
			return fromStoredAppearance(row);
		} catch (cause) {
			throw new AppearanceFailure('operation_unknown', { cause });
		}
	}

	content(actor: AppearanceActor, id: string, signal: AbortSignal): Promise<BackgroundContent> {
		return boundary(async () => {
			const row = await this.storage.get(actor.userId, id);
			if (row === null) {
				throw new AppearanceFailure('not_found');
			}
			return {
				mediaType: row.mediaType,
				sizeBytes: row.sizeBytes,

				transfer: (deliver) =>
					boundary(async () => {
						try {
							for await (const chunk of this.blobs.read(
								row.id,
								{ start: 0, endInclusive: row.sizeBytes - 1 },
								signal,
							)) {
								await deliver(Uint8Array.from(chunk));
							}
						} catch (cause) {
							if (cause instanceof BlobFailure && cause.kind === 'aborted') {
								throw new AppearanceFailure('unavailable', { cause });
							}
							throw cause;
						}
					}),
			};
		});
	}

	cleanupCandidates(limit: number): Promise<string[]> {
		return boundary(async () => {
			const ids = await this.storage.cleanupCandidates(limit);
			return ids.map((id) => id);
		});
	}

	cleanup(id: string): Promise<void> {
		return boundary(async () => {
			try {
				await this.blobs.remove(id);
			} catch (cause) {
				if (cause instanceof BlobFailure && cause.kind === 'cleanup_failed') {
					throw new AppearanceResourceFailure({ cause });
				}
				throw new AppearanceFailure('cleanup_failed', { cause });
			}
			await this.storage.finishCleanup(id);
		});
	}
}
