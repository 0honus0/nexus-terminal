// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test } from 'vitest';
import baseline from '../../../fixtures/data/preferences/monitoring-settings.json' with { type: 'json' };
import { createMonitoringConfiguration } from '../../../../packages/frontend/src/features/preferences/composables/use-monitoring-configuration.ts';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';
test('monitoring controller preserves CAS/unknown fences, body loss, late activation and identity revocation', async () => {
	const checks = [],
		owners = [];
	const nativeFetch = window.fetch;

	const check = (value, name) => {
		if (!value) throw Error(name);
		checks.push(name);
	};

	const wire = () => structuredClone(baseline);

	const json = (value, status = 200) =>
		new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

	async function until(predicate) {
		for (let i = 0; i < 200; i++) {
			if (predicate()) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw Error('monitoring UI did not converge');
	}

	function controller() {
		const owner = createMonitoringConfiguration();
		owners.push(owner);
		return owner;
	}

	try {
		let reads = 0,
			writes = 0,
			mode = 'normal',
			release;
		window.fetch = async (_url, options) => {
			if (options?.method === 'PUT') {
				writes++;
				if (mode === 'lost') throw new TypeError('controlled network loss');
				if (mode === 'stream')
					return new Response(
						new ReadableStream({
							start(c) {
								c.enqueue(new TextEncoder().encode('{'));
								c.error(new Error('controlled body loss'));
							},
						}),
						{ headers: { 'Content-Type': 'application/json' } },
					);
				if (mode === 'conflict') return json({ code: 'version_conflict' }, 409);
				if (mode === 'wrong-status') return json({ code: 'version_conflict' }, 400);
				if (mode === 'invalid') return json({ code: 'invalid_input' }, 400);
				const command = JSON.parse(options.body),
					result = wire();
				if (
					command.captcha.secret.action !== 'keep' ||
					'effectiveMonitoring' in command ||
					JSON.stringify(command.policy.passkeys) !== JSON.stringify(baseline.policy.passkeys)
				)
					throw Error('incorrect configuration write projection');
				result.version = command.expectedVersion + 1;
				result.effectiveVersion = result.version;
				result.requiresRestart = false;
				result.policy = command.policy;
				result.effectiveMonitoring = {
					statusMonitorIntervalSeconds: command.policy.statusMonitorIntervalSeconds,
					remoteHostRefreshIntervalSeconds: command.policy.remoteHostRefreshIntervalSeconds,
				};
				if (mode === 'wrong-value') result.policy.statusMonitorIntervalSeconds++;
				return json(result);
			}
			reads++;
			if (mode === 'late')
				return new Promise((resolve) => {
					release = () => resolve(json(wire()));
				});
			return json(wire());
		};
		const owner = controller();
		check(owner.snapshot.value === null && !owner.canSave.value, 'no invented initial interval');
		await owner.refresh();
		for (const fault of ['lost', 'stream', 'conflict', 'wrong-status', 'wrong-value']) {
			mode = fault;
			owner.draft.value.statusIntervalSeconds = 11;
			const count = writes;
			await owner.save();
			check(
				writes === count + 1 &&
					owner.needsRefresh.value &&
					!owner.canSave.value &&
					owner.feedback.value === (fault === 'conflict' ? 'conflict' : 'unknown'),
				fault + ' preserves read-only recovery fence',
			);
			await owner.save();
			check(writes === count + 1, fault + ' never replays a write');
			mode = 'normal';
			await owner.refresh();
			check(
				!owner.needsRefresh.value && owner.draft.value.statusIntervalSeconds === 7,
				fault + ' refresh restores authority',
			);
		}
		mode = 'invalid';
		owner.draft.value.statusIntervalSeconds = 12;
		await owner.save();
		check(
			!owner.needsRefresh.value && owner.canSave.value && owner.feedback.value === 'invalid_input',
			'confirmed input refusal remains editable',
		);
		mode = 'normal';
		await owner.save();
		check(
			owner.feedback.value === 'saved' && owner.snapshot.value.effectiveMonitoring.statusIntervalSeconds === 12,
			'save activates monitoring interval without restart',
		);
		mode = 'late';
		const late = owner.refresh();
		await until(() => release);
		const finish = release;
		owner.deactivate();
		mode = 'normal';
		owner.activate();
		await until(() => owner.snapshot.value !== null);
		const current = owner.snapshot.value;
		finish();
		await late;
		check(
			owner.snapshot.value === current && !owner.loading.value,
			'old result and finally cannot overwrite reactivated owner',
		);
		mode = 'late';
		release = null;
		const obsolete = owner.refresh();
		await until(() => release);
		const finishSession = release;
		authenticatedSessionLifecycle.attach(1);
		mode = 'normal';
		// Attach starts a new read; release both retained controlled requests independently.
		if (release !== finishSession) release();
		finishSession();
		await obsolete;
		await until(() => !owner.loading.value);
		check(owner.snapshot.value !== null, 'first login invalidates old read and refreshes current authority');
		authenticatedSessionLifecycle.logout();
		check(
			owner.snapshot.value === null && owner.draft.value === null,
			'logout clears configuration and editable draft',
		);
		owner.dispose();
		const count = reads;
		owner.activate();
		await owner.refresh();
		check(reads === count, 'disposed owner cannot restart');

		assert.equal(checks.length, 22);
	} finally {
		owners.forEach((owner) => owner.dispose());
		authenticatedSessionLifecycle.dispose();
		window.fetch = nativeFetch;
	}
});
