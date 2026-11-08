import { createHmac } from 'node:crypto';
import { vi, onTestFinished } from 'vitest';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';

export async function openAccess({ password } = {}) {
	const app = await openFrontendApplication({
		trustedProxies: ['loopback'],
		configuration: {
			ipWhitelist: '',
			ipBlacklistEnabled: true,
			maxLoginAttempts: 5,
			loginBanDuration: 300,
			statusMonitorIntervalSeconds: 3,
			remoteHostRefreshIntervalSeconds: 60,
			passkeys: [{ origin: window.location.origin, rpId: window.location.hostname }],
			captcha: { enabled: false, provider: 'none', siteKey: '', secretKey: '', expectedHostname: null },
		},
	});
	vi.stubGlobal('fetch', app.fetch);
	onTestFinished(() => vi.unstubAllGlobals());
	await setLocale('en-US');
	const api = createAccessApi();
	if (password) await api.setup({ username: 'admin', password, confirmPassword: password });
	return { app, api, password };
}

export function totp(secret) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const key = Buffer.from(bits.match(/.{8}/gu).map((byte) => Number.parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const hmac = createHmac('sha1', key).update(counter).digest();
	return String((hmac.readUInt32BE(hmac.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
