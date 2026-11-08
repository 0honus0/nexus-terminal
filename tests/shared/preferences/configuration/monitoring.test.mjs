import assert from 'node:assert/strict';
import { test } from 'vitest';
import baseline from '../../../fixtures/data/preferences/monitoring-settings.json' with { type: 'json' };
import { readSettingsResponse } from '@nexus-terminal/shared/preferences/configuration/http-codec';
test('monitoring settings strictly correlate effective policy and preserve all original boundary vectors', () => {
	const checks = [];

	const check = (value, name) => {
		assert.ok(value, name);
		checks.push(name);
	};

	const wire = () => structuredClone(baseline);

	const invalid = (value, name) => {
		assert.throws(() => readSettingsResponse(value), name);
		checks.push(name);
	};

	let value = wire();
	delete value.effectiveMonitoring;
	invalid(value, 'missing effective object rejected');
	value = wire();
	value.effectiveMonitoring.secret = 'private';
	invalid(value, 'nested private field rejected');
	value = wire();
	value.effectiveMonitoring.statusMonitorIntervalSeconds++;
	invalid(value, 'equal versions require equal effective policy');
	for (const limit of [0, 86401, 1.5, '3']) {
		value = wire();
		value.effectiveMonitoring.statusMonitorIntervalSeconds = limit;
		invalid(value, 'invalid effective interval rejected');
	}
	for (const limit of [1, 86400]) {
		value = wire();
		value.policy.statusMonitorIntervalSeconds = limit;
		value.effectiveMonitoring.statusMonitorIntervalSeconds = limit;
		check(
			readSettingsResponse(value).policy.statusMonitorIntervalSeconds === limit,
			'Shared interval boundary accepted',
		);
	}

	assert.equal(checks.length, 9);
});
