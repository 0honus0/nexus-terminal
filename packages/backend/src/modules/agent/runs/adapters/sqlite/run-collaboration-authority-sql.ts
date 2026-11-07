import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { CollaborationStorageRefusal } from '../../storage/run-collaboration-storage.js';
import type { StoredCollaborationAuthority, StoredParticipant } from '../../storage/run-collaboration-storage.js';
import { currentOperation } from '../../../operations/adapters/sqlite/current-operation-sql.js';
import { participant } from './run-participant-sql.js';

export async function collaborationAuthority(
	tx: SqlExecutor,
	input: StoredCollaborationAuthority,
): Promise<StoredParticipant> {
	const current = await currentOperation(
		tx,
		{
			userId: input.scope.userId,
			appId: input.scope.appId,
			runId: input.scope.runId,
			operationId: input.operationId,
			operationHash: input.operationHash,
		},
		{
			labels: [
				'collaboration.delegate',
				'collaboration.list',
				'collaboration.readOutput',
				'collaboration.join',
				'collaboration.cancel',
				'collaboration.sendMessage',
				'collaboration.readMessages',
				'collaboration.consumeMessages',
				'collaboration.readFact',
				'collaboration.writeFact',
			],
		},
	);
	if (!current) {
		throw new CollaborationStorageRefusal('version_conflict');
	}
	const owner = await participant(tx, input.scope);
	if (!owner) {
		throw new Error('Collaboration participant missing');
	}
	return owner;
}
