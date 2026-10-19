import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import type { AgentPluginRuntimeObservation } from './runtime-model.js';
import type { AgentPluginRuntimeAcknowledgement } from './runtime-http.js';

export function readAgentPluginRuntimeAcknowledgement(value: unknown): AgentPluginRuntimeAcknowledgement {
	const input = agentRecord(value, ['expectedRevision', 'instanceRevision', 'instanceId', 'confirmed']);
	if (input.confirmed !== true) {
		throw new InvalidAgentPayload();
	}
	const instanceId = readAgentId(input.instanceId);
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(instanceId)) {
		throw new InvalidAgentPayload();
	}
	return {
		expectedRevision: agentInteger(input.expectedRevision, 1),
		instanceRevision: agentInteger(input.instanceRevision, 1),
		instanceId,
		confirmed: true,
	};
}

export function readAgentPluginRuntimeObservation(value: unknown, appId: string): AgentPluginRuntimeObservation | null {
	if (value === null) {
		return null;
	}
	const input = agentRecord(value, [
		'appId',
		'instanceId',
		'revision',
		'state',
		'updatedAt',
		'unknownAt',
		'acknowledgedAt',
	]);
	if (
		input.appId !== appId ||
		(input.state !== 'opening' &&
			input.state !== 'active' &&
			input.state !== 'closed' &&
			input.state !== 'unknown') ||
		typeof input.updatedAt !== 'number' ||
		!Number.isSafeInteger(input.updatedAt) ||
		input.updatedAt < 0
	) {
		throw new InvalidAgentPayload();
	}
	if (
		(input.unknownAt !== null &&
			(typeof input.unknownAt !== 'number' || !Number.isSafeInteger(input.unknownAt) || input.unknownAt < 0)) ||
		(input.acknowledgedAt !== null &&
			(typeof input.acknowledgedAt !== 'number' ||
				!Number.isSafeInteger(input.acknowledgedAt) ||
				input.acknowledgedAt < 0)) ||
		(input.state === 'unknown' && (input.unknownAt === null || input.acknowledgedAt !== null)) ||
		(input.acknowledgedAt !== null && (input.state !== 'closed' || input.unknownAt === null))
	) {
		throw new InvalidAgentPayload();
	}
	const identity = readAgentPluginRuntimeAcknowledgement({
		expectedRevision: input.revision,
		instanceRevision: input.revision,
		instanceId: input.instanceId,
		confirmed: true,
	});
	return {
		appId: readAgentId(input.appId),
		instanceId: identity.instanceId,
		revision: identity.expectedRevision,
		state: input.state,
		updatedAt: input.updatedAt,
		unknownAt: input.unknownAt === null ? null : agentInteger(input.unknownAt),
		acknowledgedAt: input.acknowledgedAt === null ? null : agentInteger(input.acknowledgedAt),
	};
}

export function readAgentPluginRuntimeAcknowledged(
	value: unknown,
	appId: string,
	request: AgentPluginRuntimeAcknowledgement,
): AgentPluginRuntimeObservation {
	const result = readAgentPluginRuntimeObservation(value, appId);
	if (
		result === null ||
		result.instanceId !== request.instanceId ||
		result.revision !== request.instanceRevision ||
		result.state !== 'closed'
	) {
		throw new InvalidAgentPayload();
	}
	return result;
}
