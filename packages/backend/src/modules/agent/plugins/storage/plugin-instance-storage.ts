import type { StoredPluginManifest } from './plugin-storage.js';
import type { StoredPluginPackageReference } from './plugin-composition-storage.js';
import type { StoredPluginDataRecord, StoredPluginDataPage } from './plugin-data-storage.js';

export interface StoredPluginInstance {
	id: string;
	appId: string;
	packageId: string;
	name: string;
	selected: boolean;
	enabled: boolean;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredPluginConfiguration {
	instanceId: string;
	packageId: string;
	revision: number;
	schemaRevision: number;
	documentJson: string;
}

export interface StoredPluginInstanceSource {
	instance: StoredPluginInstance;
	configuration: StoredPluginConfiguration;
	package: StoredPluginPackageReference;
	packageRevision: number;
	manifest: StoredPluginManifest;
}

export type StoredPluginConfigurationPrincipal =
	| { kind: 'manual'; userId: number; digest: string }
	| {
			kind: 'run';
			userId: number;
			appId: string;
			runId: string;
			executionGeneration: string;
			operationId: string | null;
			policyRevision: number;
			callerInstanceId: string;
			callerGeneration: string;
			participants: readonly {
				instanceId: string;
				packageId: string;
				generation: string;
				configurationRevision: number;
				packageRevision: number;
			}[];
	  };

export interface StoredPluginConfigurationWrite {
	operationKey: string;
	expectedRevision: number;
	schemaRevision: number;
	documentJson: string;
	requestHash: string;
	now: number;
}

export interface PluginInstanceStorage {
	dataRead(
		principal: StoredPluginConfigurationPrincipal,
		namespace: string,
		key: string,
	): Promise<StoredPluginDataRecord | null>;
	dataList(
		principal: StoredPluginConfigurationPrincipal,
		namespace: string,
		after: string | null,
		byteBudget: number,
	): Promise<StoredPluginDataPage>;
	dataWrite(
		principal: StoredPluginConfigurationPrincipal,
		namespace: string,
		key: string,
		expectedRevision: number,
		documentJson: string | null,
		now: number,
	): Promise<StoredPluginDataRecord>;
	list(userId: number, appId: string): Promise<StoredPluginInstance[]>;
	listAuthorized(principal: StoredPluginConfigurationPrincipal, appId: string): Promise<StoredPluginInstance[]>;
	read(
		principal: StoredPluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
	): Promise<StoredPluginInstanceSource>;
	source(userId: number, appId: string, instanceId: string): Promise<StoredPluginInstanceSource>;
	create(
		userId: number,
		digest: string,
		appId: string,
		packageId: string,
		id: string,
		name: string,
		now: number,
	): Promise<StoredPluginInstance>;
	update(
		userId: number,
		digest: string,
		appId: string,
		instanceId: string,
		expectedRevision: number,
		input: { name: string; selected: boolean; enabled: boolean },
		now: number,
	): Promise<StoredPluginInstance>;
	write(
		principal: StoredPluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
		command: StoredPluginConfigurationWrite,
		validate: (source: StoredPluginInstanceSource) => { changed: boolean },
	): Promise<{ configuration: StoredPluginConfiguration; changed: boolean }>;
}

export class PluginInstanceRefusal extends Error {
	constructor(
		readonly code:
			| 'not_found'
			| 'version_conflict'
			| 'forbidden'
			| 'unauthenticated'
			| 'idempotency_conflict'
			| 'limit_exceeded',
	) {
		super('Plugin instance: ' + code);
		this.name = 'PluginInstanceRefusal';
	}
}
