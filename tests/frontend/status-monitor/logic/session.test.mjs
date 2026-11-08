import { test, expect, vi, afterEach } from 'vitest';
import { createStatusMonitorSession } from '../../../../packages/frontend/src/features/status-monitor/composables/useStatusMonitor.ts';
import { StatusFailure } from '../../../../packages/frontend/src/features/status-monitor/model/status-types.ts';

const controllers = [];
afterEach(async () => {
	for (const controller of controllers.splice(0)) controller.dispose();
	await vi.runAllTimersAsync();
	vi.useRealTimers();
});

function fixture(overrides = {}) {
	vi.useFakeTimers();
	let deliver;
	const channel = {
		subscribe(handler) {
			deliver = handler;
			return vi.fn();
		},

		start: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
		...overrides,
	};
	const controller = createStatusMonitorSession(channel);
	controllers.push(controller);
	return {
		channel,
		controller,

		sample: (value) => deliver(value),
	};
}

test('short deactivation retains sampling, expiry stops it and later delivery is ignored', async () => {
	const { channel, controller, sample } = fixture();
	controller.activate();
	await Promise.resolve();
	await controller.workspaceConnected();
	sample({ timestamp: 1, cpuPercent: 0 });
	expect(controller.history.value.cpu).toHaveLength(1);
	expect(controller.history.value.memory).toHaveLength(0);
	controller.deactivate();
	await vi.advanceTimersByTimeAsync(29_999);
	expect(channel.stop).not.toHaveBeenCalled();
	sample({ timestamp: 2, cpuPercent: 1 });
	expect(controller.history.value.cpu).toHaveLength(2);
	await vi.advanceTimersByTimeAsync(1);
	expect(channel.stop).toHaveBeenCalledTimes(1);
	sample({ timestamp: 3, cpuPercent: 7 });
	expect(controller.history.value.cpu).toHaveLength(2);
	controller.activate();
	await Promise.resolve();
	await controller.workspaceConnected();
	expect(channel.start).toHaveBeenCalledTimes(2);
	sample({ timestamp: 4, cpuPercent: 2 });
	expect(controller.history.value.cpu.at(-1).sequence).toBe(4);
});

test('reactivation inside the grace period keeps the original subscription without duplicate work', async () => {
	const { channel, controller } = fixture();
	controller.activate();
	await Promise.resolve();
	await controller.workspaceConnected();
	controller.deactivate();
	await vi.advanceTimersByTimeAsync(10_000);
	controller.activate();
	await vi.advanceTimersByTimeAsync(30_000);
	expect(channel.start).toHaveBeenCalledTimes(1);
	expect(channel.stop).not.toHaveBeenCalled();
});

test('a late start after deactivation expiry drains once and cannot publish later samples', async () => {
	const started = Promise.withResolvers();
	const { channel, controller, sample } = fixture({ start: vi.fn(() => started.promise) });
	controller.activate();
	const connecting = controller.workspaceConnected();
	await Promise.resolve();
	controller.deactivate();
	await vi.advanceTimersByTimeAsync(30_000);
	expect(channel.stop).not.toHaveBeenCalled();
	started.resolve();
	await connecting;
	await vi.runAllTimersAsync();
	expect(channel.stop).toHaveBeenCalledTimes(1);
	sample({ timestamp: 9, cpuPercent: 7 });
	expect(controller.current.value).toBeNull();
});

test('failed start is reconciled before an explicit retry instead of staying falsely active', async () => {
	const calls = [];
	const failure = new StatusFailure('remote_unavailable');
	const { channel, controller } = fixture({
		start: vi
			.fn()
			.mockImplementationOnce(async () => {
				calls.push('failed-start');
				throw failure;
			})
			.mockImplementation(async () => {
				calls.push('start');
			}),
		stop: vi.fn(async () => {
			calls.push('stop');
		}),
	});
	controller.activate();
	await Promise.resolve();
	await controller.workspaceConnected();
	expect(controller.error.value).toBe('remote_unavailable');
	await controller.workspaceConnected();
	expect(channel.start).toHaveBeenCalledTimes(2);
	expect(calls).toEqual(['failed-start', 'stop', 'start']);
});

test('failed cleanup prevents replacement, while explicit later retry first drains the original subscription', async () => {
	const calls = [];
	const { channel, controller } = fixture({
		start: vi.fn().mockRejectedValueOnce(new StatusFailure('remote_unavailable')).mockResolvedValue(undefined),
		stop: vi
			.fn()
			.mockImplementationOnce(async () => {
				calls.push('failed-stop');
				throw new StatusFailure('remote_unavailable');
			})
			.mockImplementation(async () => {
				calls.push('stop');
			}),
	});
	controller.activate();
	await Promise.resolve();
	await controller.workspaceConnected();
	await controller.workspaceConnected();
	expect(channel.start).toHaveBeenCalledTimes(1);
	await controller.workspaceConnected();
	expect(channel.start).toHaveBeenCalledTimes(2);
	expect(calls).toEqual(['failed-stop', 'stop']);
});
