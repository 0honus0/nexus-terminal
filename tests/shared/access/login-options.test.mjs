import { test, expect } from 'vitest';
import { readAccessLoginOptions, InvalidAccessPayload } from '../../../packages/shared/src/access/http.ts';

const captcha = { enabled: false, provider: 'none', hcaptchaSiteKey: '', recaptchaSiteKey: '' };

test('public login options accept configured and unbound providers with independent safe CAPTCHA metadata', () => {
	expect(readAccessLoginOptions({ hasPasskeys: false, captcha, oidc: null })).toEqual({
		hasPasskeys: false,
		captcha,
		oidc: null,
	});
	expect(readAccessLoginOptions({ hasPasskeys: false, captcha, oidc: { label: 'Pocket ID' } })).toEqual({
		hasPasskeys: false,
		captcha,
		oidc: { label: 'Pocket ID' },
	});
});

test.each([
	{ captcha, oidc: null },
	{ hasPasskeys: 'true', captcha, oidc: null },
	{ hasPasskeys: false, captcha, oidc: { label: 'Pocket ID', secret: 'private' } },
	{ hasPasskeys: false, captcha: { ...captcha, secret: 'private' }, oidc: null },
	{ hasPasskeys: false, captcha: { ...captcha, enabled: 'false' }, oidc: null },
	{ hasPasskeys: false, captcha, oidc: { label: '' } },
	{ hasPasskeys: false, captcha, oidc: { label: '   ' } },
	{ hasPasskeys: false, captcha, oidc: { label: '\ud800' } },
	{ hasPasskeys: false, captcha, oidc: 'Pocket ID' },
	{ ...captcha, provider: null },
])('public login options reject missing, secret, malformed and retired fields: %j', (value) => {
	expect(() => readAccessLoginOptions(value)).toThrow(InvalidAccessPayload);
});

test('combined public options retain valid provider names and escaped CAPTCHA keys beyond the old separate response budget', () => {
	const options = {
		hasPasskeys: true,
		oidc: { label: 'x'.repeat(15000) },
		captcha: { enabled: true, provider: 'hcaptcha', hcaptchaSiteKey: '\u0001'.repeat(1024), recaptchaSiteKey: '' },
	};
	expect(new TextEncoder().encode(JSON.stringify(options)).byteLength).toBeGreaterThan(16 * 1024);
	expect(readAccessLoginOptions(options)).toEqual(options);
});
