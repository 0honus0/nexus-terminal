import { agentRecord, encodeAgentJson, readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginUiEnvironment,
	readAgentPluginUiHostInput,
} from '@nexus-terminal/shared/agent/plugins/ui-events-codec';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import type { AgentPluginUiEnvironment } from '@nexus-terminal/shared/agent/plugins/ui-events';
import type { PluginFrontendUiBridge } from './ui-bridge-types';

/** Settings share the Surface transport and theme, without inheriting App actions or subscriptions. */
export class PluginSettingsUiBridge implements PluginFrontendUiBridge {
	private port: MessagePort | null = null;
	private closed = false;
	private onFailure: ((error: unknown) => void) | null = null;

	constructor(private readonly environment: () => AgentPluginUiEnvironment) {}

	setFailureHandler(listener: (error: unknown) => void): void {
		this.onFailure = listener;
	}

	connect(port: MessagePort): void {
		if (this.closed) {
			return;
		}
		this.port = port;
		this.updateEnvironment();
	}

	updateEnvironment(): void {
		if (this.closed || !this.port) {
			return;
		}
		try {
			const message = {
				type: 'nexus.ui.environment',
				environment: readAgentPluginUiEnvironment(this.environment()),
			};
			encodeAgentJson(message, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
			this.port.postMessage(message);
		} catch (error) {
			this.onFailure?.(error);
		}
	}

	handle(input: unknown, port: MessagePort): boolean {
		if (
			input === null ||
			typeof input !== 'object' ||
			!('type' in input) ||
			typeof input.type !== 'string' ||
			!input.type.startsWith('nexus.ui.')
		) {
			return false;
		}
		if (this.closed || this.port !== port) {
			throw new Error('Settings Surface is closed');
		}
		if (input.type === 'nexus.ui.cancel') {
			readAgentId(agentRecord(input, ['type', 'id']).id);
			return true;
		}
		const row = agentRecord(input, ['type', 'id', 'input'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		if (row.type !== 'nexus.ui.request') {
			throw new Error('Unsupported Settings message');
		}
		readAgentPluginUiHostInput(row.input);
		port.postMessage({
			type: 'nexus.ui.failure',
			id: readAgentId(row.id),
			error: { code: 'forbidden', outcome: 'not_dispatched' },
		});
		return true;
	}

	close(): Promise<void> {
		this.closed = true;
		this.port = null;
		return Promise.resolve();
	}
}
