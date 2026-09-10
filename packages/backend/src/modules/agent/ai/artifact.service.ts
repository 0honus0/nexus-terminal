import type {
  ArtifactAttachInput,
  ArtifactAttachResult,
  ArtifactCleanupPreview,
  ArtifactCleanupResult,
  ArtifactLibraryPage,
  ArtifactLibraryQuery,
  ArtifactPort,
  ArtifactReadRange,
  ArtifactRef,
  ArtifactStorageSummary,
  Scope,
  UploadReservation,
} from './artifact.port';
import { isAgentUuid } from '../uuid';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateBegin = (raw: unknown): { name: string; mediaType: string; declaredBytes: number } => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set(['name', 'mediaType', 'declaredBytes']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (typeof raw.name !== 'string' || raw.name.trim().length < 1 || Buffer.byteLength(raw.name, 'utf8') > 512) {
    throw new Error('VALIDATION_FAILED');
  }
  if (
    typeof raw.mediaType !== 'string' ||
    raw.mediaType.length < 1 ||
    raw.mediaType.length > 128 ||
    /[\r\n\0]/.test(raw.mediaType)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  if (!Number.isSafeInteger(raw.declaredBytes) || (raw.declaredBytes as number) < 0) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    name: raw.name.trim(),
    mediaType: raw.mediaType.toLowerCase(),
    declaredBytes: raw.declaredBytes as number,
  };
};

export class ArtifactService {
  constructor(private readonly store: ArtifactPort) {}

  begin(scope: Scope, raw: unknown): Promise<UploadReservation> {
    return this.store.begin(scope, validateBegin(raw));
  }

  get(scope: Scope, artifactId: string): Promise<ArtifactRef | null> {
    return this.store.get(scope, artifactId);
  }

  write(
    scope: Scope,
    artifactId: string,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<ArtifactRef> {
    return this.store.write(scope, artifactId, source, signal);
  }

  read(scope: Scope, artifactId: string, range: ArtifactReadRange): AsyncIterable<Uint8Array> {
    return this.store.read(scope, artifactId, range);
  }

  retain(scope: Scope, artifactId: string, retained: boolean, expectedVersion: number): Promise<ArtifactRef> {
    return this.store.retain(scope, artifactId, retained, expectedVersion);
  }

  delete(scope: Scope, artifactId: string, expectedVersion: number): Promise<void> {
    return this.store.delete(scope, artifactId, expectedVersion);
  }

  listLibrary(userId: number, query: ArtifactLibraryQuery): Promise<ArtifactLibraryPage> {
    return this.store.listLibrary(userId, query);
  }

  storageSummary(userId: number): Promise<ArtifactStorageSummary> {
    return this.store.storageSummary(userId);
  }

  cleanupPreview(userId: number): Promise<ArtifactCleanupPreview> {
    return this.store.cleanupPreview(userId);
  }

  cleanupConfirm(userId: number, confirmationId: string): Promise<ArtifactCleanupResult> {
    if (!isAgentUuid(confirmationId)) throw new Error('VALIDATION_FAILED');
    return this.store.cleanupConfirm(userId, confirmationId);
  }

  attach(userId: number, artifactId: string, raw: unknown): Promise<ArtifactAttachResult> {
    if (!isAgentUuid(artifactId) || !isRecord(raw)) throw new Error('VALIDATION_FAILED');
    const allowed = new Set(['targetAppId', 'threadId', 'runId', 'role', 'expectedVersion']);
    if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
    if (
      typeof raw.targetAppId !== 'string' ||
      raw.targetAppId.length < 3 ||
      raw.targetAppId.length > 128 ||
      !isAgentUuid(String(raw.threadId)) ||
      (raw.runId !== undefined && !isAgentUuid(String(raw.runId))) ||
      (raw.expectedVersion !== undefined &&
        (!Number.isSafeInteger(raw.expectedVersion) || (raw.expectedVersion as number) < 1)) ||
      raw.role !== 'input'
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const input: ArtifactAttachInput = {
      targetAppId: raw.targetAppId,
      threadId: String(raw.threadId),
      ...(raw.runId === undefined ? {} : { runId: String(raw.runId) }),
      role: 'input',
      ...(raw.expectedVersion === undefined ? {} : { expectedVersion: raw.expectedVersion as number }),
    };
    return this.store.attach(userId, artifactId, input);
  }
}
