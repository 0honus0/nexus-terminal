import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EventEmitter } from 'node:events';
import { deliverAccessResult } from '../../../../../packages/backend/src/modules/access/interfaces/http/access-delivery.ts';

for (const stage of ['send', 'close', 'late_issue']) {
	test('Access ' + stage + ' failure retains revocation cause and releases every transport listener', async () => {
		const request = Object.assign(new EventEmitter(), { aborted: false });
		const socket = Object.assign(new EventEmitter(), { destroyed: false });
		const response = Object.assign(new EventEmitter(), { destroyed: false, socket });
		const cleanupFailure = new Error('Controlled credential revocation failure');
		const sendFailure = new Error('Controlled delivery failure');
		let revocations = 0;
		let issuedSignal;
		const result = deliverAccessResult(
			{ raw: request },
			{ raw: response },
			async (signal) => {
				issuedSignal = signal;
				if (stage === 'late_issue') {
					request.aborted = true;
					request.emit('aborted');
				}
				return 'issued-token';
			},
			() => {
				if (stage === 'send') throw sendFailure;
				response.destroyed = true;
				response.emit('close');
			},
			async (value) => {
				assert.equal(value, 'issued-token');
				revocations++;
				throw cleanupFailure;
			},
		);
		await assert.rejects(result, (error) => {
			if (stage === 'send') {
				assert.ok(error instanceof AggregateError);
				assert.strictEqual(error.errors[0], sendFailure);
				assert.strictEqual(error.errors[1].cause, cleanupFailure);
			} else {
				assert.strictEqual(error.cause, cleanupFailure);
				assert.equal(issuedSignal.aborted, true);
			}
			return true;
		});
		assert.equal(revocations, 1);
		for (const emitter of [request, response, socket]) assert.deepEqual(emitter.eventNames(), []);
	});
}
