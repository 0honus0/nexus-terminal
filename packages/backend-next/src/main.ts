import { createApp, type AccessHttpOptions } from './bootstrap/create-app.js';

function requireSetting(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(name + ' is required for the independent backend-next entry');
	}
	return value;
}

function parsePort(value: string, setting = 'NEXUS_NEXT_PORT'): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('Invalid ' + setting);
	}
	return port;
}

function parseBooleanSetting(name: string, fallback: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined) {
		return fallback;
	}
	if (raw === 'true') {
		return true;
	}
	if (raw === 'false') {
		return false;
	}
	throw new Error('Invalid ' + name + ': expected true or false');
}

function parseBoundedSetting(name: string, fallback: number, min: number, max: number): number {
	const raw = process.env[name];
	if (raw === undefined) {
		return fallback;
	}
	if (!/^[1-9][0-9]*$/u.test(raw)) {
		throw new Error('Invalid ' + name);
	}
	const number = Number(raw);
	if (!Number.isSafeInteger(number) || number < min || number > max) {
		throw new Error('Invalid ' + name);
	}
	return number;
}

function requireCaptchaProvider(raw: string): 'none' | 'hcaptcha' | 'recaptcha' {
	if (raw === 'none' || raw === 'hcaptcha' || raw === 'recaptcha') {
		return raw;
	}
	throw new Error('Invalid NEXUS_NEXT_CAPTCHA_PROVIDER');
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
	const app = await createApp(dbPath, {
		encryptionKey: key,
		ipWhitelist: process.env.NEXUS_NEXT_IP_WHITELIST ?? '',
		loginFailurePolicy: {
			enabled: parseBooleanSetting('NEXUS_NEXT_IP_BLACKLIST_ENABLED', true),
			maxAttempts: parseBoundedSetting('NEXUS_NEXT_MAX_LOGIN_ATTEMPTS', 5, 1, 1000),
			banSeconds: parseBoundedSetting('NEXUS_NEXT_LOGIN_BAN_SECONDS', 300, 1, 30 * 86400),
		},
		captcha: {
			enabled: parseBooleanSetting('NEXUS_NEXT_CAPTCHA_ENABLED', false),
			provider: requireCaptchaProvider(process.env.NEXUS_NEXT_CAPTCHA_PROVIDER ?? 'none'),
			siteKey: process.env.NEXUS_NEXT_CAPTCHA_SITE_KEY ?? '',
			secretKey: process.env.NEXUS_NEXT_CAPTCHA_SECRET_KEY ?? '',
			expectedHostname: new URL(http.publicOrigin).hostname,
		},
		passkeys: {
			origin: new URL(http.publicOrigin).origin,
			rpId: process.env.NEXUS_NEXT_PASSKEY_RP_ID?.trim() || new URL(http.publicOrigin).hostname,
		},
		guacd: {
			host: process.env.GUACD_HOST?.trim() || 'localhost',
			port: parsePort(process.env.GUACD_PORT ?? '4822', 'GUACD_PORT'),
		},
	});
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
