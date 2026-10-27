import { PinoLogger } from './platform/logging/pino-logger.js';
import { logDiagnostic } from './platform/logging/diagnostic-log.js';

import { createApp, type AccessHttpOptions } from './bootstrap/create-app.js';

const logger = new PinoLogger();

// Monitoring preserves Node's normal fatal-exception behavior.
process.on('uncaughtExceptionMonitor', (error, origin) => {
	logDiagnostic(logger, 'error', 'UNCAUGHT_PROCESS_FAILURE', { origin }, error);
});

class StartupConfigurationFailure extends Error {
	constructor(readonly setting: string) {
		super('Invalid backend entry configuration');
	}
}

function requireSetting(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new StartupConfigurationFailure(name);
	}
	return value;
}

function parsePort(value: string, setting = 'NEXUS_PORT'): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new StartupConfigurationFailure(setting);
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
	throw new StartupConfigurationFailure(name);
}

function parseBoundedSetting(name: string, fallback: number, min: number, max: number): number {
	const raw = process.env[name];
	if (raw === undefined) {
		return fallback;
	}
	if (!/^[1-9][0-9]*$/u.test(raw)) {
		throw new StartupConfigurationFailure(name);
	}
	const number = Number(raw);
	if (!Number.isSafeInteger(number) || number < min || number > max) {
		throw new StartupConfigurationFailure(name);
	}
	return number;
}

function requireCaptchaProvider(raw: string): 'none' | 'hcaptcha' | 'recaptcha' {
	if (raw === 'none' || raw === 'hcaptcha' || raw === 'recaptcha') {
		return raw;
	}
	throw new StartupConfigurationFailure('NEXUS_CAPTCHA_PROVIDER');
}

function parsePasskeySites(primaryOrigin: string): Array<{ origin: string; rpId: string }> {
	const raw = process.env.NEXUS_PASSKEY_SITES;
	if (raw === undefined) {
		const url = new URL(primaryOrigin);
		return [{ origin: url.origin, rpId: process.env.NEXUS_PASSKEY_RP_ID?.trim() || url.hostname }];
	}
	const sites: unknown = JSON.parse(raw);
	if (!Array.isArray(sites)) {
		throw new StartupConfigurationFailure('NEXUS_PASSKEY_SITES');
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
			throw new StartupConfigurationFailure('NEXUS_PASSKEY_SITES');
		}
		return { origin: site.origin, rpId: site.rpId };
	});
}

async function main(): Promise<void> {
	logDiagnostic(logger, 'info', 'PROCESS_STARTING', { pid: process.pid, node: process.version });
	const dbPath = requireSetting('NEXUS_DB_PATH');
	const rawKey = requireSetting('NEXUS_ENCRYPTION_KEY');
	const key = Buffer.from(rawKey, 'base64');
	if (key.length !== 32 || key.toString('base64') !== rawKey) {
		throw new StartupConfigurationFailure('NEXUS_ENCRYPTION_KEY');
	}
	const http: AccessHttpOptions = {
		bindHost: process.env.NEXUS_HOST ?? '127.0.0.1',
		port: parsePort(process.env.NEXUS_PORT ?? '3001'),
		publicOrigin: requireSetting('NEXUS_PUBLIC_ORIGIN'),
		trustedProxies: (process.env.NEXUS_TRUSTED_PROXIES ?? 'loopback').split(',').map((value) => value.trim()),
	};
	const app = await createApp(dbPath, {
		encryptionKey: key,
		logger,

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
		await app.listenHttp(http);
		let closing: Promise<void> | null = null;

		const shutdown = (): Promise<void> => {
			if (closing) {
				return closing;
			}
			logDiagnostic(logger, 'info', 'PROCESS_SHUTDOWN_REQUESTED');
			closing = app.close();
			return closing;
		};

		const handleSignal = (): void => {
			void shutdown().catch((error: unknown) => {
				process.exitCode = 1;
				logDiagnostic(logger, 'error', 'PROCESS_SHUTDOWN_FAILED', {}, error);
			});
		};

		process.once('SIGTERM', () => {
			logDiagnostic(logger, 'info', 'PROCESS_SIGNAL_RECEIVED', { signal: 'SIGTERM' });
			handleSignal();
		});
		process.once('SIGINT', () => {
			logDiagnostic(logger, 'info', 'PROCESS_SIGNAL_RECEIVED', { signal: 'SIGINT' });
			handleSignal();
		});
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
	logDiagnostic(
		logger,
		'error',
		'PROCESS_STARTUP_FAILED',
		{ setting: error instanceof StartupConfigurationFailure ? error.setting : null },
		error,
	);
});
