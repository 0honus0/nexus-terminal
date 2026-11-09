import { test, expect, vi } from 'vitest';
import { LoginOptionsModel } from '../../../../../packages/backend/dist/modules/access/login-options/model/login-options-model.js';

test('login methods share a resident snapshot, isolate caller mutations and reload on invalidation', async () => {
	const oidc = { provider: vi.fn().mockResolvedValue(null) };
	const factors = { hasPasskeys: vi.fn().mockResolvedValue(false) };
	const model = new LoginOptionsModel(oidc, factors);
	try {
		const results = await Promise.all(Array.from({ length: 10 }, () => model.read()));
		expect(results).toEqual(Array(10).fill({ oidcLabel: null, hasPasskeys: false }));
		results[0].hasPasskeys = true;
		expect(await model.read()).toEqual({ oidcLabel: null, hasPasskeys: false });
		expect(oidc.provider).toHaveBeenCalledTimes(1);
		expect(factors.hasPasskeys).toHaveBeenCalledTimes(1);
		oidc.provider.mockResolvedValue('Pocket ID');
		factors.hasPasskeys.mockResolvedValue(true);
		model.invalidate();
		expect(await model.read()).toEqual({ oidcLabel: 'Pocket ID', hasPasskeys: true });
		expect(oidc.provider).toHaveBeenCalledTimes(2);
		expect(factors.hasPasskeys).toHaveBeenCalledTimes(2);
		model.quiesce();
		await expect(model.read()).rejects.toMatchObject({ code: 'factor_unavailable' });
	} finally {
		await model.close();
	}
});
