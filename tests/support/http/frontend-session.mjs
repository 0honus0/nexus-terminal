import { createPinia, setActivePinia } from 'pinia';
import { onTestFinished, vi } from 'vitest';
import { openFrontendApplication } from './frontend-application.mjs';
import { createAccessApi } from '../../../packages/frontend/src/features/auth/api/access-api.ts';
import { useAuthStore } from '../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { authenticatedSessionLifecycle } from '../../../packages/frontend/src/shared/session/public.ts';

/** An isolated real account, cookie jar and authenticated frontend lifecycle. */
export async function openAuthenticatedFrontendApplication(options = {}) {
	const application = await openFrontendApplication(options);
	vi.stubGlobal('fetch', application.fetch);
	onTestFinished(() => vi.unstubAllGlobals());
	const pinia = createPinia();
	setActivePinia(pinia);
	const password = 'Personal-session-fixture-2026!';
	await createAccessApi().setup({ username: 'admin', password, confirmPassword: password });
	const auth = useAuthStore(pinia);
	await auth.login({ username: 'admin', password });
	const identity = await createAccessApi().status();
	if (!identity) throw new Error('Real frontend fixture identity missing');
	onTestFinished(() => {
		const revoked = authenticatedSessionLifecycle.dispose();
		if (revoked.failures.length)
			throw new AggregateError(
				revoked.failures.map((failure) => failure.cause),
				'Frontend lifecycle dispose failed',
			);
	});
	const attached = authenticatedSessionLifecycle.attach(identity.user.id);
	if (attached?.failures.length)
		throw new AggregateError(
			attached.failures.map((failure) => failure.cause),
			'Frontend lifecycle attach failed',
		);
	return { application, pinia, auth };
}
