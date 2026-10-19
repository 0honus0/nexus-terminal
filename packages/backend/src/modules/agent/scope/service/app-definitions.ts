import { AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
import {
	AGENT_APP_MAX_LIST_ITEMS,
	AGENT_APP_DEFINITION_ID_PATTERN,
	AGENT_APP_MAX_DEFINITION_ID_BYTES,
	AGENT_APP_MAX_DEFINITION_VERSION_BYTES,
	AGENT_SCOPE_MAX_NAME_BYTES,
} from '@nexus-terminal/shared/agent/scope/values';
import { validGrant } from '../../governance/governance-rules.js';
import { AgentFailure } from '../../agent-failure.js';
import type { AppDefinition } from '../model/scope-types.js';

export const DEFAULT_APP_DEFINITION_ID = 'nexus.terminal';

/** Trusted server source. Plugin sources enter through Scope after B8 verification. */
export function builtinAppDefinitions(): AppDefinition[] {
	return [
		{
			id: DEFAULT_APP_DEFINITION_ID,
			version: '1.8.0',
			displayName: 'Nexus Terminal',
			capabilities: [
				'file.read',
				'file.write',
				'file.delete',
				'machine.inspect',
				'host.inspect',
				'shell.execute',
				'machine.docker.manage',
				'integration.acp.invoke',
				'browser.read',
				'browser.interact',
				'integration.mcp.read',
				'integration.mcp.invoke',
				'app.intents.exchange',
				'context.read',
				'context.compact',
				'memory.read',
				'memory.propose',
				'artifacts.read',
				'artifacts.write',
			],
			defaultEnabled: true,
			defaultGrants: [],
		},
	];
}

export function validateAppDefinitions(definitions: readonly AppDefinition[]): void {
	if (
		definitions.length > AGENT_APP_MAX_LIST_ITEMS ||
		new Set(definitions.map((definition) => definition.id)).size !== definitions.length
	) {
		throw new AgentFailure('invalid_input');
	}
	for (const definition of definitions) {
		if (
			!AGENT_APP_DEFINITION_ID_PATTERN.test(definition.id) ||
			Buffer.byteLength(definition.id, 'utf8') > AGENT_APP_MAX_DEFINITION_ID_BYTES ||
			!definition.version.trim() ||
			Buffer.byteLength(definition.version, 'utf8') > AGENT_APP_MAX_DEFINITION_VERSION_BYTES ||
			!definition.displayName.trim() ||
			Buffer.byteLength(definition.displayName, 'utf8') > AGENT_SCOPE_MAX_NAME_BYTES ||
			typeof definition.defaultEnabled !== 'boolean' ||
			new Set(definition.capabilities).size !== definition.capabilities.length ||
			definition.capabilities.some((capability) => !AGENT_CAPABILITIES.includes(capability)) ||
			new Set(definition.defaultGrants.map((grant) => grant.capability)).size !==
				definition.defaultGrants.length ||
			definition.defaultGrants.some(
				(grant) =>
					!definition.capabilities.includes(grant.capability) || !validGrant(grant.capability, grant.scope),
			)
		) {
			throw new AgentFailure('invalid_input');
		}
	}
}
