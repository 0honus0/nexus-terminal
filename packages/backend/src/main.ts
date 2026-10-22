import { createApp, type AccessHttpOptions } from './bootstrap/create-app.js';

function requireSetting(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(name + ' is required for the backend entry');
	}
	return value;
}

function parsePort(value: string, setting = 'NEXUS_PORT'): number {
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
	throw new Error('Invalid NEXUS_CAPTCHA_PROVIDER');
}

function parsePasskeySites(primaryOrigin: string): Array<{ origin: string; rpId: string }> {
	const raw = process.env.NEXUS_PASSKEY_SITES;
	if (raw === undefined) {
		const url = new URL(primaryOrigin);
		return [{ origin: url.origin, rpId: process.env.NEXUS_PASSKEY_RP_ID?.trim() || url.hostname }];
	}
	const sites: unknown = JSON.parse(raw);
	if (!Array.isArray(sites)) {
		throw new Error('Invalid NEXUS_PASSKEY_SITES');
	}
	return sites.map((site: unknown) => {
		if (
			site === null ||
			typeof site !== 'object' ||
			Array.isArray(site) ||
			Object.keys(site).length !== 2 ||
			!('origin' in site) ||
			!('rpId' in site) ||
			typeof site.origin !== 'string' ||
			typeof site.rpId !== 'string'
		) {
			throw new Error('Invalid NEXUS_PASSKEY_SITES');
		}
		return { origin: site.origin, rpId: site.rpId };
	});
}

async function main(): Promise<void> {
	const dbPath = requireSetting('NEXUS_DB_PATH');
	const rawKey = requireSetting('NEXUS_ENCRYPTION_KEY');
	const key = Buffer.from(rawKey, 'base64');
	if (key.length !== 32 || key.toString('base64') !== rawKey) {
		throw new Error('NEXUS_ENCRYPTION_KEY must be exactly 32 bytes, standard base64');
	}
	const http: AccessHttpOptions = {
		bindHost: process.env.NEXUS_HOST ?? '127.0.0.1',
		port: parsePort(process.env.NEXUS_PORT ?? '3001'),
		publicOrigin: requireSetting('NEXUS_PUBLIC_ORIGIN'),
		trustedProxies: (process.env.NEXUS_TRUSTED_PROXIES ?? 'loopback').split(',').map((value) => value.trim()),
	};
	const app = await createApp(dbPath, {
		encryptionKey: key,

		configuration: () => ({
			ipWhitelist: process.env.NEXUS_IP_WHITELIST ?? '',
			ipBlacklistEnabled: parseBooleanSetting('NEXUS_IP_BLACKLIST_ENABLED', true),
			maxLoginAttempts: parseBoundedSetting('NEXUS_MAX_LOGIN_ATTEMPTS', 5, 1, 1000),
			loginBanDuration: parseBoundedSetting('NEXUS_LOGIN_BAN_SECONDS', 300, 1, 30 * 86400),
			statusMonitorIntervalSeconds: parseBoundedSetting('NEXUS_STATUS_INTERVAL_SECONDS', 3, 1, 86400),
			remoteHostRefreshIntervalSeconds: parseBoundedSetting('NEXUS_RESOURCE_REFRESH_SECONDS', 30, 1, 86400),
			captcha: {
				enabled: parseBooleanSetting('NEXUS_CAPTCHA_ENABLED', false),
				provider: requireCaptchaProvider(process.env.NEXUS_CAPTCHA_PROVIDER ?? 'none'),
				siteKey: process.env.NEXUS_CAPTCHA_SITE_KEY ?? '',
				secretKey: process.env.NEXUS_CAPTCHA_SECRET_KEY ?? '',
				expectedHostname: new URL(http.publicOrigin).hostname,
			},
			passkeys: parsePasskeySites(http.publicOrigin),
		}),
	});
	try {
		const address = await app.listenHttp(http);
		process.stdout.write('backend Access listening on ' + address + '\n');
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
					'backend shutdown failed: ' + (error instanceof Error ? error.name : 'unknown') + '\n',
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
		'backend startup failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\n',
	);
});
