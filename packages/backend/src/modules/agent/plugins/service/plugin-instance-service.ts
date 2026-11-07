import { AgentFailure } from '../../agent-failure.js';
import { validateAgentId, validateOperationKey, validateUserId } from '../../agent-validation.js';
import type { PluginInstanceModel } from '../model/plugin-instance-model.js';
import type {
	PluginConfigurationMutation,
	PluginConfigurationPrincipal,
	PluginConfigurationWrite,
	PluginInstance,
	PluginInstanceSource,
} from '../model/plugin-instance-types.js';
import type { PluginActor } from '../model/plugin-types.js';
import type { PluginDataRecord, PluginDataPage } from '../model/plugin-data-types.js';

/** Logical instance/configuration ownership is independent of process and registration generations. */
export class PluginInstanceService {
	private readonly listeners = new Set<(scope: { userId: number; appId: string; instanceId: string }) => void>();

	constructor(
		private readonly model: PluginInstanceModel,
		private readonly observerFailure: (error: unknown) => void,
	) {}

	private dataPrincipal(principal: PluginConfigurationPrincipal, namespace: string, key?: string): void {
		if (
			principal.kind !== 'run' ||
			!namespace.trim() ||
			namespace.includes('\0') ||
			(key !== undefined && (!key.trim() || key.includes('\0')))
		) {
			throw new AgentFailure('invalid_input');
		}
	}

	dataRead(
		principal: PluginConfigurationPrincipal,
		namespace: string,
		key: string,
	): Promise<PluginDataRecord | null> {
		this.dataPrincipal(principal, namespace, key);
		return this.model.dataRead(principal, namespace, key);
	}

	dataList(
		principal: PluginConfigurationPrincipal,
		namespace: string,
		after: string | null,
		byteBudget: number,
	): Promise<PluginDataPage> {
		this.dataPrincipal(principal, namespace, after ?? undefined);
		if (!Number.isSafeInteger(byteBudget) || byteBudget < 1) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.dataList(principal, namespace, after, byteBudget);
	}

	dataWrite(
		principal: PluginConfigurationPrincipal,
		namespace: string,
		key: string,
		expectedRevision: number,
		documentJson: string | null,
	): Promise<PluginDataRecord> {
		this.dataPrincipal(principal, namespace, key);
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
			throw new AgentFailure('invalid_input');
		}
		if (documentJson !== null) {
			try {
				JSON.parse(documentJson);
			} catch {
				throw new AgentFailure('invalid_input');
			}
		}
		return this.model.dataWrite(principal, namespace, key, expectedRevision, documentJson);
	}

	subscribe(listener: (scope: { userId: number; appId: string; instanceId: string }) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	changed(userId: number, appId: string, instanceId: string): void {
		for (const listener of this.listeners) {
			try {
				listener({ userId, appId, instanceId });
			} catch (error) {
				this.observerFailure(error);
			}
		}
	}

	list(userId: number, appId: string): Promise<PluginInstance[]> {
		validateUserId(userId);
		validateAgentId(appId);
		return this.model.list(userId, appId);
	}

	listAuthorized(principal: PluginConfigurationPrincipal, appId: string): Promise<PluginInstance[]> {
		validateAgentId(appId);
		if (
			principal.kind === 'run' &&
			(principal.appId !== appId || !principal.capabilities.includes('plugin.configure'))
		) {
			throw new AgentFailure('forbidden');
		}
		return this.model.listAuthorized(principal, appId);
	}

	source(userId: number, appId: string, instanceId: string): Promise<PluginInstanceSource> {
		validateUserId(userId);
		validateAgentId(appId);
		validateAgentId(instanceId);
		return this.model.source(userId, appId, instanceId);
	}

	private assertPrincipal(
		principal: PluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
		write: boolean,
	): void {
		validateAgentId(appId);
		validateAgentId(instanceId);
		if (
			principal.kind === 'run' &&
			(principal.appId !== appId ||
				((write || instanceId !== principal.callerInstanceId) &&
					!principal.capabilities.includes('plugin.configure')))
		) {
			throw new AgentFailure('forbidden');
		}
	}

	read(principal: PluginConfigurationPrincipal, appId: string, instanceId: string): Promise<PluginInstanceSource> {
		this.assertPrincipal(principal, appId, instanceId, false);
		return this.model.read(principal, appId, instanceId);
	}

	async create(actor: PluginActor, appId: string, packageId: string, name: string): Promise<PluginInstance> {
		validateAgentId(appId);
		if (!name.trim() || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(packageId)) {
			throw new AgentFailure('invalid_input');
		}
		const instance = await this.model.create(actor, appId, packageId, name);
		this.changed(actor.userId, appId, instance.id);
		return instance;
	}

	async update(
		actor: PluginActor,
		appId: string,
		instanceId: string,
		expectedRevision: number,
		input: { name: string; selected: boolean; enabled: boolean },
	): Promise<PluginInstance> {
		validateAgentId(appId);
		validateAgentId(instanceId);
		if (!input.name.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
			throw new AgentFailure('invalid_input');
		}
		const instance = await this.model.update(actor, appId, instanceId, expectedRevision, input);
		this.changed(actor.userId, appId, instance.id);
		return instance;
	}

	async write(
		principal: PluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
		command: PluginConfigurationWrite,
	): Promise<PluginConfigurationMutation> {
		this.assertPrincipal(principal, appId, instanceId, true);
		validateOperationKey(command.operationKey);
		if (
			!Number.isSafeInteger(command.expectedPackageRevision) ||
			command.expectedPackageRevision < 1 ||
			!Number.isSafeInteger(command.expectedRevision) ||
			command.expectedRevision < 0 ||
			!Number.isSafeInteger(command.schemaRevision) ||
			command.schemaRevision < 1
		) {
			throw new AgentFailure('invalid_input');
		}
		try {
			return await this.model.write(principal, appId, instanceId, command);
		} finally {
			// An uncertain commit also requires consumers to compare authoritative revisions.
			// Run callers publish only after the native Operation owner has settled.
			if (principal.kind === 'manual') {
				this.changed(principal.actor.userId, appId, instanceId);
			}
		}
	}

	inspect(
		principal: PluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
		command: PluginConfigurationWrite,
	): Promise<PluginInstanceSource> {
		this.assertPrincipal(principal, appId, instanceId, true);
		return this.model.inspect(principal, appId, instanceId, command);
	}
}
