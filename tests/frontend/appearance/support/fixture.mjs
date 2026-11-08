import { createPinia, setActivePinia } from 'pinia';
import { onTestFinished, vi } from 'vitest';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { useAppearanceStore } from '../../../../packages/frontend/src/features/appearance/store/appearance.store.ts';

export async function openAppearance() {
	const app = await openFrontendApplication();
	vi.stubGlobal('fetch', app.fetch);
	onTestFinished(() => vi.unstubAllGlobals());
	const api = createAccessApi();
	const password = 'Appearance-fixture-2026!';
	await api.setup({ username: 'admin', password, confirmPassword: password });
	await api.login({ username: 'admin', password, rememberMe: false });
	const identity = await api.status();
	const pinia = createPinia();
	setActivePinia(pinia);
	const store = useAppearanceStore();
	onTestFinished(() => store.reset());
	await store.load(true);
	return { app, store, pinia, identity };
}
