export type AuthenticatedSessionEvent =
  | { type: 'attach'; userId: number }
  | { type: 'user-changed'; previousUserId: number; userId: number }
  | { type: 'logout'; previousUserId: number }
  | { type: 'dispose'; previousUserId: number | null };

export type AuthenticatedSessionOwner = (event: AuthenticatedSessionEvent) => void;

export interface AuthenticatedSessionDispatch {
  event: AuthenticatedSessionEvent;
  failures: ReadonlyArray<{ ownerId: string; cause: unknown }>;
}

export interface AuthenticatedSessionLifecycle {
  readonly userId: number | null;
  register(ownerId: string, owner: AuthenticatedSessionOwner): () => void;
  attach(userId: number): AuthenticatedSessionDispatch | null;
  logout(): AuthenticatedSessionDispatch | null;
  dispose(): AuthenticatedSessionDispatch;
}

export const createAuthenticatedSessionLifecycle = (): AuthenticatedSessionLifecycle => {
  const owners = new Map<string, AuthenticatedSessionOwner>();
  let activeUserId: number | null = null;

  const dispatch = (event: AuthenticatedSessionEvent): AuthenticatedSessionDispatch => {
    const failures: Array<{ ownerId: string; cause: unknown }> = [];
    for (const [ownerId, owner] of owners) {
      try {
        owner(event);
      } catch (cause) {
        failures.push({ ownerId, cause });
      }
    }
    return { event, failures };
  };

  return {
    get userId() {
      return activeUserId;
    },
    register(ownerId, owner) {
      if (!ownerId.trim()) throw new Error('Authenticated session owner id is required.');
      owners.set(ownerId, owner);
      if (activeUserId !== null) owner({ type: 'attach', userId: activeUserId });
      return () => {
        if (owners.get(ownerId) === owner) owners.delete(ownerId);
      };
    },
    attach(userId) {
      if (!Number.isSafeInteger(userId) || userId <= 0)
        throw new Error('Authenticated session user id must be positive.');
      if (activeUserId === userId) return null;
      const previousUserId = activeUserId;
      activeUserId = userId;
      return dispatch(
        previousUserId === null ? { type: 'attach', userId } : { type: 'user-changed', previousUserId, userId },
      );
    },
    logout() {
      if (activeUserId === null) return null;
      const previousUserId = activeUserId;
      activeUserId = null;
      return dispatch({ type: 'logout', previousUserId });
    },
    dispose() {
      const previousUserId = activeUserId;
      activeUserId = null;
      return dispatch({ type: 'dispose', previousUserId });
    },
  };
};

export const authenticatedSessionLifecycle = createAuthenticatedSessionLifecycle();

export const registerAuthenticatedSessionOwner = (ownerId: string, owner: AuthenticatedSessionOwner): (() => void) =>
  authenticatedSessionLifecycle.register(ownerId, owner);

export const registerAuthenticatedSessionReset = (ownerId: string, reset: () => void): (() => void) =>
  registerAuthenticatedSessionOwner(ownerId, (event) => {
    if (event.type !== 'attach') reset();
  });
