import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { on } from 'node:events';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';

// A separate Node realm keeps jsdom globals and frontend fetch fault injection
// out of the real backend, including SDK environment and credential checks.
const database = join(workerData.directory, 'application.db');
const encryptionKey = workerData.encryptionKey ?? randomBytes(32);
let application;

async function open() {
	application = await createApp(database, {
		encryptionKey,
		...(workerData.configuration ? { configuration: () => workerData.configuration } : {}),
	});
	const address = await application.listenHttp({
		publicOrigin: workerData.origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: workerData.trustedProxies ?? [],
	});
	parentPort.postMessage(address);
}

try {
	// Register before opening so a test timeout during startup still owns shutdown.
	const messages = on(parentPort, 'message');
	if (workerData.prepareDatabaseModule) {
		const { prepareDatabase } = await import(workerData.prepareDatabaseModule);
		await prepareDatabase(database, encryptionKey);
	}
	await open();
	for await (const [command] of messages) {
		if (command !== 'restart' && command !== 'close') throw new Error('Invalid application fixture command');
		await application.close();
		application = undefined;
		if (command === 'close') break;
		// Keep the actual SQLite file and encryption key; no database copying or reseeding.
		await open();
	}
} catch (cause) {
	try {
		await application?.close();
	} catch (cleanup) {
		throw new AggregateError([cause, cleanup], 'Frontend application startup and cleanup failed');
	}
	throw cause;
} finally {
	parentPort.close();
}
