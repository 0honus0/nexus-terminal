import type {
  AgentMemoryImportConfirmationDto,
  AgentMemoryViewDto,
} from '@nexus-terminal/protocol/agent-memories';
import type { AgentMemoryFacade } from '../../../modules/agent/public';

type Memory = Awaited<ReturnType<AgentMemoryFacade['confirmImport']>>;
type ImportConfirmation = Awaited<ReturnType<AgentMemoryFacade['previewImport']>>;

export const memoryDto = (memory: Memory): AgentMemoryViewDto => ({
  id: memory.id,
  userId: memory.userId,
  appId: memory.appId,
  content: memory.content,
  sourceRefs: memory.sourceRefs,
  confidence: memory.confidence,
  status: memory.status,
  expiresAt: memory.expiresAt,
  proposedByRuntimeId: memory.proposedByRuntimeId,
  reviewAction: memory.reviewAction,
  reviewedAt: memory.reviewedAt,
  version: memory.version,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
});

export const memoryImportConfirmationDto = (
  confirmation: ImportConfirmation,
): AgentMemoryImportConfirmationDto => ({
  id: confirmation.id,
  userId: confirmation.userId,
  appId: confirmation.appId,
  sourceAppId: confirmation.sourceAppId,
  sourceMemoryId: confirmation.sourceMemoryId,
  sourceVersion: confirmation.sourceVersion,
  snapshot: confirmation.snapshot,
  createdAt: confirmation.createdAt,
  expiresAt: confirmation.expiresAt,
});
