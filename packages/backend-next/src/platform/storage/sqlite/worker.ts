import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
type Param = string | number | null;
parentPort!.on('message', (message: { id: number; kind: string; sql?: string; params?: Param[] }) => {
	try {
		let value: unknown = null;
		if (message.kind === 'close') {
			db.close();
			parentPort!.postMessage({ id: message.id, value: null });
			parentPort!.close();
			return;
		}
		if (message.kind === 'exec') db.exec(message.sql!);
		else {
			const stmt = db.prepare(message.sql!);
			if (message.kind === 'all') value = stmt.all(...(message.params ?? []));
			else if (message.kind === 'one') value = stmt.get(...(message.params ?? [])) ?? null;
			else if (message.kind === 'run') {
				const result = stmt.run(...(message.params ?? []));
				value = { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
			} else throw new Error('Unsupported SQLite worker operation');
		}
		parentPort!.postMessage({ id: message.id, value });
	} catch (error) {
		const err = error as Error & { errcode?: unknown };
		parentPort!.postMessage({
			id: message.id,
			error: {
				message: err instanceof Error ? err.message : 'Unknown SQLite failure',
				code: typeof err?.errcode === 'number' && Number.isSafeInteger(err.errcode) ? err.errcode : null,
			},
		});
	}
});
