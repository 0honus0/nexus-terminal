// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function indexExecutionBudgetRoot(tx: SqlExecutor): Promise<void> {
	await tx.exec('CREATE INDEX agent_budget_reservation_root ON agent_run_budget_reservations(root_id)');
}
