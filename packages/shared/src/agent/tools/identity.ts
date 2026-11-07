/** Persisted Host projection; a plugin cannot supply or override this execution provenance. */
export type AgentToolIdentity =
	| { kind: 'plugin'; packageId: string; packageVersion: string; packageSha256: string; name: string }
	| { kind: 'host'; operation: string };
