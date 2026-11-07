import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function appsWithIntegrationSettings(tx: SqlExecutor, userId: number): Promise<string[]> {
	const rows = await tx.all('SELECT DISTINCT app_id FROM agent_integrations WHERE user_id=?', [userId]);
	return rows.map((row) => {
		if (typeof row.app_id !== 'string') {
			throw new Error('Invalid integration App owner');
		}
		return row.app_id;
	});
}

export async function clearAppIntegrationSettings(tx: SqlExecutor, userId: number, appId: string): Promise<void> {
	// Success receipts and rejected creation keys remain terminal historical facts, without live credentials.
	await tx.run('DELETE FROM agent_integrations WHERE user_id=? AND app_id=?', [userId, appId]);
}
