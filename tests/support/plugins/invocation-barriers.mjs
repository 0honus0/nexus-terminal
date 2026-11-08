import assert from 'node:assert/strict';
import { PluginRuntimeService } from '../../../packages/backend/dist/modules/agent/plugins/service/plugin-runtime-service.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { OperationEffectFailure } from '../../../packages/backend/dist/modules/agent/operations/model/operation-failure.js';

/** Gate only delivery, after the real handler and its governed I/O have run. */
export function pauseToolResults(appId, selectors, { interruptIndex = null } = {}) {
	const gates = selectors.map(() => Promise.withResolvers());
	const started = [];
	const original = PluginRuntimeService.prototype.invokeCallable;

	async function invoke(resolved, scope, signal, bridge) {
		if (resolved.provider.appId !== appId || scope.kind !== 'run') {
			return original.call(this, resolved, scope, signal, bridge);
		}
		const args = JSON.parse(resolved.argumentsJson);
		const path = args?.paths?.[0] ?? args?.items?.[0]?.path;
		const index = selectors.findIndex((selector) =>
			typeof selector === 'string' ? selector === path : selector.key === resolved.definition.key,
		);
		if (index < 0) return original.call(this, resolved, scope, signal, bridge);
		started.push(index);
		const result = await original.call(this, resolved, scope, signal, bridge);
		await gates[index].promise;
		if (signal.aborted) throw new AgentFailure('forbidden');
		if (index === interruptIndex) throw new OperationEffectFailure('operation_unknown', 'unknown', 'closed');
		return result;
	}

	PluginRuntimeService.prototype.invokeCallable = invoke;
	let closed = false;
	return {
		started,

		release: (index) => gates[index].resolve(),

		close() {
			if (closed) return;
			closed = true;
			for (const gate of gates) gate.resolve();
			assert.equal(PluginRuntimeService.prototype.invokeCallable, invoke, 'Overlapping delivery barriers');
			PluginRuntimeService.prototype.invokeCallable = original;
		},
	};
}
