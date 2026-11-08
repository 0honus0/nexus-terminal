import { createPinia, setActivePinia } from 'pinia';
import { vi, onTestFinished } from 'vitest';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { useBackupStore } from '../../../../packages/frontend/src/features/backup/store/backup.store.ts';

export async function openBackup() {
	const app = await openFrontendApplication();
	vi.stubGlobal('fetch', app.fetch);
	onTestFinished(() => vi.unstubAllGlobals());
	const password = 'System-fixture-2026!';
	const access = createAccessApi();
	await access.setup({ username: 'admin', password, confirmPassword: password });
	const pinia = createPinia();
	setActivePinia(pinia);
	const identity = await useAuthStore(pinia).login({ username: 'admin', password, rememberMe: false });
	const store = useBackupStore(pinia);
	onTestFinished(() => store.reset());
	return { app, store, pinia, identity, password };
}
