// Frozen published database migration dependency. Not an application API.
import type { AgentCapability } from '../../../contracts/governance/values.js';

export type StoredScope =
	| {
			kind: 'global';
	  }
	| {
			kind: 'targets';
			sshMode?: undefined;
	  }
	| {
			kind: 'targets';
			sshMode: 'all';
	  }
	| {
			kind: 'targets';
			sshMode: 'ids';
			sshIds: string[];
	  };

export interface StoredGrant {
	capability: AgentCapability;
	schemaVersion: 2;
	scope: StoredScope;
	grantedAt: number;
}
