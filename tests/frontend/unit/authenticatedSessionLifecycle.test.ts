import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedSessionLifecycle } from '../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle';

describe('authenticated session lifecycle', () => {
  it('emits attach, user change, logout, and dispose transitions in order', () => {
    const lifecycle = createAuthenticatedSessionLifecycle();
    const owner = vi.fn();
    lifecycle.register('example', owner);

    expect(lifecycle.attach(11)?.event).toEqual({ type: 'attach', userId: 11 });
    expect(lifecycle.attach(11)).toBeNull();
    expect(lifecycle.attach(12)?.event).toEqual({ type: 'user-changed', previousUserId: 11, userId: 12 });
    expect(lifecycle.logout()?.event).toEqual({ type: 'logout', previousUserId: 12 });
    expect(lifecycle.dispose().event).toEqual({ type: 'dispose', previousUserId: null });

    expect(owner.mock.calls.map(([event]) => event.type)).toEqual(['attach', 'user-changed', 'logout', 'dispose']);
  });

  it('attaches a late owner and isolates owner cleanup failures', () => {
    const lifecycle = createAuthenticatedSessionLifecycle();
    lifecycle.attach(21);
    const lateOwner = vi.fn();
    lifecycle.register('late-owner', lateOwner);
    lifecycle.register('broken-owner', (event) => {
      if (event.type === 'logout') throw new Error('broken cleanup');
    });

    expect(lateOwner).toHaveBeenCalledWith({ type: 'attach', userId: 21 });
    const result = lifecycle.logout();
    expect(result?.failures).toHaveLength(1);
    expect(result?.failures[0]?.ownerId).toBe('broken-owner');
    expect(lateOwner).toHaveBeenLastCalledWith({ type: 'logout', previousUserId: 21 });
  });

  it('allows a replaced owner to unregister without removing its replacement', () => {
    const lifecycle = createAuthenticatedSessionLifecycle();
    const original = vi.fn();
    const replacement = vi.fn();
    const unregisterOriginal = lifecycle.register('owner', original);
    lifecycle.register('owner', replacement);

    unregisterOriginal();
    lifecycle.attach(31);

    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledWith({ type: 'attach', userId: 31 });
  });
});
