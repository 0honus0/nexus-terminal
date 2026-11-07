import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { AgentHostState } from './agent-host-state';
import type { HostDirectory } from '../model/host-types';
import type { AgentTaskActivity } from '../model/task-activity-types';

const NOTICE_DURATION_MS = 8000;

function changeKey(activity: AgentTaskActivity): string {
	return JSON.stringify([
		activity.runId,
		activity.status,
		activity.approvals
			.slice()
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((approval) => [approval.id, approval.version]),
		activity.failureKey,
	]);
}

/** Transient presentation of changes from existing runtimes; never reads or writes tasks itself. */
export function useAgentTaskNotices(host: AgentHostState, directory: () => HostDirectory | null) {
	const queue = ref<symbol[]>([]);
	const hovered = ref(false);
	const focused = ref(false);
	const now = ref(Date.now());
	let timer: ReturnType<typeof setTimeout> | null = null;
	let expiryTimer: ReturnType<typeof setTimeout> | null = null;
	const availableActivities = computed(() => {
		const apps = new Map(
			directory()
				?.apps.filter((app) => app.enabled)
				.map((app) => [app.id, app]),
		);
		return new Map(
			[...host.taskActivities].filter(([, activity]) => {
				const app = activity ? apps.get(activity.appId) : undefined;
				return activity !== null && app?.version === activity.appVersion && app.surface === 'plugin';
			}),
		);
	});
	const notice = computed(() => {
		if (host.windowManager.state.status !== 'minimized') {
			return null;
		}
		const owner = queue.value[0];
		return owner ? (availableActivities.value.get(owner) ?? null) : null;
	});
	const pendingApprovalCount = computed(() => {
		if (host.windowManager.state.status !== 'minimized') {
			return 0;
		}
		let count = 0;
		for (const activity of availableActivities.value.values()) {
			count += activity?.approvals.filter((approval) => approval.expiresAt * 1000 > now.value).length ?? 0;
		}
		return count;
	});

	function refreshApprovalClock(): void {
		if (expiryTimer !== null) {
			clearTimeout(expiryTimer);
		}
		expiryTimer = null;
		now.value = Date.now();
		if (host.windowManager.state.status !== 'minimized') {
			return;
		}
		let nextExpiry = Infinity;
		for (const activity of availableActivities.value.values()) {
			for (const approval of activity?.approvals ?? []) {
				const expiry = approval.expiresAt * 1000;
				if (expiry > now.value) {
					nextExpiry = Math.min(nextExpiry, expiry);
				}
			}
		}
		if (Number.isFinite(nextExpiry)) {
			expiryTimer = setTimeout(refreshApprovalClock, nextExpiry - now.value);
		}
	}

	function stopTimer(): void {
		if (timer !== null) {
			clearTimeout(timer);
		}
		timer = null;
	}

	function dismiss(): void {
		stopTimer();
		queue.value = queue.value.slice(1);
	}

	function restartTimer(): void {
		stopTimer();
		if (notice.value && !hovered.value && !focused.value && !document.hidden) {
			timer = setTimeout(dismiss, NOTICE_DURATION_MS);
		}
	}

	// Initial snapshots establish a baseline. Only later meaningful changes can open a notice.
	watch(
		() =>
			new Map(
				[...host.taskActivities].map(([owner, activity]) => [
					owner,
					activity ? { runId: activity.runId, key: changeKey(activity) } : null,
				]),
			),
		(next, previous) => {
			if (host.windowManager.state.status !== 'minimized') {
				return;
			}
			for (const [owner, state] of next) {
				if (!state || previous?.get(owner)?.key === state.key || !availableActivities.value.has(owner)) {
					continue;
				}
				const activity = availableActivities.value.get(owner);
				if (previous?.get(owner)?.runId !== state.runId && activity && !activity.locallyStarted) {
					continue;
				}
				const promoteApproval =
					activity &&
					activity.approvals.length > 0 &&
					!notice.value?.approvals.length &&
					!hovered.value &&
					!focused.value;
				if (promoteApproval) {
					queue.value = [owner, ...queue.value.filter((queued) => queued !== owner)];
				} else if (!queue.value.includes(owner)) {
					queue.value = [...queue.value, owner];
				}
				if (queue.value[0] === owner) {
					restartTimer();
				}
			}
		},
		{ flush: 'post' },
	);
	watch(
		() => [host.windowManager.state.status, availableActivities.value] as const,
		([status, activities]) => {
			queue.value = status === 'minimized' ? queue.value.filter((owner) => activities.has(owner)) : [];
			refreshApprovalClock();
		},
		{ flush: 'sync' },
	);
	watch([() => queue.value[0], hovered, focused], restartTimer, { flush: 'post' });
	watch(notice, (value) => {
		if (!value) {
			hovered.value = false;
			focused.value = false;
		}
	});

	function onVisibility(): void {
		refreshApprovalClock();
		restartTimer();
	}

	document.addEventListener('visibilitychange', onVisibility);
	onBeforeUnmount(() => {
		stopTimer();
		if (expiryTimer !== null) {
			clearTimeout(expiryTimer);
		}
		document.removeEventListener('visibilitychange', onVisibility);
	});
	return {
		notice,
		now,
		pendingApprovalCount,
		queuedCount: computed(() => queue.value.length),
		hovered,
		focused,
		dismiss,
	};
}
