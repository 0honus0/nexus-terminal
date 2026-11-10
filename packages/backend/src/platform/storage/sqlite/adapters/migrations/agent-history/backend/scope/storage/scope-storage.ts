// Frozen published database migration dependency. Not an application API.
import type { AgentCapability } from '../../../contracts/governance/values.js';

export interface StoredDefinition {
	userId: number;
	sourcePackageId: string;
	/** Immutable internal execution composition identity. */
	id: string;
	version: string;
	contentHash: string;
	displayName: string;
	capabilities: AgentCapability[];
}
