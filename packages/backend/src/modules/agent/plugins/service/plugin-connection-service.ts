import type { PluginActor } from '../model/plugin-types.js';
import type { PluginConnectionModel } from '../model/plugin-connection-model.js';
import type {
	PluginConnection,
	PluginConnectionSource,
	PluginConnectionWrite,
} from '../model/plugin-connection-types.js';
import { validateAgentId } from '../../agent-validation.js';

/** Connection bindings and secrets never live in arbitrary plugin configuration JSON. */
export class PluginConnectionService {
	private readonly listeners = new Set<(scope: { userId: number; appId: string; instanceId: string }) => void>();

	constructor(
		private readonly model: PluginConnectionModel,
		private readonly observerFailure: (error: unknown) => void,
	) {}

	subscribe(listener: (scope: { userId: number; appId: string; instanceId: string }) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	read(actor: PluginActor, appId: string, instanceId: string): Promise<PluginConnection> {
		validateAgentId(appId);
		validateAgentId(instanceId);
		return this.model.read(actor, appId, instanceId);
	}

	source(userId: number, appId: string, instanceId: string): Promise<PluginConnectionSource> {
		validateAgentId(appId);
		validateAgentId(instanceId);
		return this.model.source(userId, appId, instanceId);
	}

	async write(
		actor: PluginActor,
		appId: string,
		instanceId: string,
		input: PluginConnectionWrite,
	): Promise<PluginConnection> {
		validateAgentId(appId);
		validateAgentId(instanceId);
		try {
			return await this.model.write(actor, appId, instanceId, input);
		} finally {
			for (const listener of this.listeners) {
				try {
					listener({ userId: actor.userId, appId, instanceId });
				} catch (error) {
					this.observerFailure(error);
				}
			}
		}
	}
}
