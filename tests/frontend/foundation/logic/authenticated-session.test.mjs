import { test, expect } from 'vitest';
import {
	authenticatedSessionLifecycle,
	registerAuthenticatedSessionOwner,
} from '../../../../packages/frontend/src/shared/session/public.ts';

test('same-user reauthentication revokes the old scope and delivers attach/logout/attach to the original owner', () => {
	const events = [];
	const initial = authenticatedSessionLifecycle.attach(1);
	expect(initial.failures).toEqual([]);
	const unregister = registerAuthenticatedSessionOwner('authentication-replacement-test', (event) =>
		events.push(event.type),
	);
	try {
		expect(events).toEqual(['attach']);
		expect(authenticatedSessionLifecycle.attach(1)).toBeNull();
		expect(events).toEqual(['attach']);
		expect(authenticatedSessionLifecycle.logout().failures).toEqual([]);
		expect(authenticatedSessionLifecycle.attach(1).failures).toEqual([]);
		expect(events).toEqual(['attach', 'logout', 'attach']);
	} finally {
		unregister();
		expect(authenticatedSessionLifecycle.dispose().failures).toEqual([]);
	}
});
