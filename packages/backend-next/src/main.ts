import { createApp, type AccessHttpOptions } from './bootstrap/create-app.js';

function requireSetting(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(name + ' is required for the independent backend-next entry');
	}
	return value;
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('Invalid NEXUS_NEXT_PORT');
	}
	return port;
}

async function main(): Promise<void> {
	const dbPath = requireSetting('NEXUS_NEXT_DB_PATH');
	const rawKey = requireSetting('NEXUS_NEXT_ENCRYPTION_KEY');
	const key = Buffer.from(rawKey, 'base64');
	if (key.length !== 32 || key.toString('base64') !== rawKey) {
		throw new Error('NEXUS_NEXT_ENCRYPTION_KEY must be exactly 32 bytes, standard base64');
	}
	const http: AccessHttpOptions = {
		bindHost: process.env.NEXUS_NEXT_HOST ?? '127.0.0.1',
		port: parsePort(process.env.NEXUS_NEXT_PORT ?? '3101'),
		publicOrigin: requireSetting('NEXUS_NEXT_PUBLIC_ORIGIN'),
		trustedProxies: (process.env.NEXUS_NEXT_TRUSTED_PROXIES ?? 'loopback').split(',').map((value) => value.trim()),
	};
	const app = await createApp(dbPath, { encryptionKey: key });
	try {
		const address = await app.listenHttp(http);
		process.stdout.write('backend-next Access listening on ' + address + '\n');
		let closing: Promise<void> | null = null;

		const shutdown = (): Promise<void> => {
			if (closing) {
				return closing;
			}
			closing = app.close();
			return closing;
		};

		const handleSignal = (): void => {
			void shutdown().catch((error: unknown) => {
				process.exitCode = 1;
				process.stderr.write(
					'backend-next shutdown failed: ' + (error instanceof Error ? error.name : 'unknown') + '\n',
				);
			});
		};

		process.once('SIGTERM', handleSignal);
		process.once('SIGINT', handleSignal);
	} catch (error) {
		try {
			await app.close();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Backend HTTP startup and cleanup both failed');
		}
		throw error;
	}
}

void main().catch((error: unknown) => {
	process.exitCode = 1;
	process.stderr.write(
		'backend-next startup failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\n',
	);
});
