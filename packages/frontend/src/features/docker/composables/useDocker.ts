import type { DockerSessionController } from '../model/docker-types';
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowReadonly, watch } from 'vue';
import type { DockerChannel } from '../ports/docker-channel';
import { DockerFailure, type DockerFailureCode, type DockerAction, type DockerContainer } from '../model/docker-types';

export function createDockerSession(channel: DockerChannel): DockerSessionController {
	const available = ref(false);
	const containers = ref<DockerContainer[]>([]);
	const loading = ref(false);
	const readError = ref<DockerFailureCode | null>(null);
	const commandError = ref<DockerFailureCode | null>(null);
	const commandPending = ref(false);
	const commandBlocked = ref(false);
	let commandRevision = 0;
	const expanded = ref(new Set<string>());

	let workspaceAvailable = false;
	let consumerCount = 0;
	let intervalSeconds = 5;
	let defaultExpand = false;
	let initialLoadDone = false;
	let disposed = false;
	let generation = 0;
	let timer: number | undefined;
	let refreshPromise: Promise<boolean> | null = null;
	let refreshGeneration = 0;

	const desiredPolling = () => !disposed && workspaceAvailable && consumerCount > 0;

	const stopTimer = () => {
		if (timer === undefined) {
			return;
		}
		window.clearInterval(timer);
		timer = undefined;
	};

	const startTimer = () => {
		stopTimer();
		if (!desiredPolling()) {
			return;
		}
		timer = window.setInterval(() => void refresh(), Math.max(1, intervalSeconds) * 1000);
	};

	const pruneExpansion = (nextContainers: DockerContainer[]) => {
		const current = new Set(nextContainers.map((container) => container.id));
		expanded.value = new Set([...expanded.value].filter((id) => current.has(id)));
	};

	const applyStatus = (nextContainers: DockerContainer[], nextAvailable: boolean) => {
		available.value = nextAvailable;
		containers.value = nextAvailable ? nextContainers : [];
		pruneExpansion(containers.value);
		if (nextAvailable && !initialLoadDone) {
			initialLoadDone = true;
			if (defaultExpand) {
				expanded.value = new Set(containers.value.map((container) => container.id));
			}
		}
		readError.value = null;
	};

	const resetForDisconnect = () => {
		generation += 1;
		stopTimer();
		loading.value = false;
		available.value = false;
		containers.value = [];
		readError.value = null;
		expanded.value = new Set();
		initialLoadDone = false;
	};

	const performRefresh = async (requestGeneration: number): Promise<boolean> => {
		const revision = commandRevision;
		loading.value = true;
		try {
			const status = await channel.getStatus();
			if (disposed || requestGeneration !== generation || revision !== commandRevision || !workspaceAvailable) {
				return false;
			}
			applyStatus(status.containers, status.available);
			return true;
		} catch (cause) {
			if (disposed || requestGeneration !== generation || revision !== commandRevision || !workspaceAvailable) {
				return false;
			}
			readError.value = cause instanceof DockerFailure ? cause.code : 'remote_unavailable';
			return false;
		} finally {
			if (!disposed && requestGeneration === generation) {
				loading.value = false;
			}
		}
	};

	const loadStatus = async (force = false): Promise<boolean> => {
		const owner = generation;
		while (refreshPromise) {
			if (!force && refreshGeneration === owner) {
				return refreshPromise;
			}
			await refreshPromise;
			if (owner !== generation || !desiredPolling()) {
				return false;
			}
		}
		if (!desiredPolling()) {
			return false;
		}
		refreshGeneration = owner;
		const request = performRefresh(owner);
		const tracked = request.finally(() => {
			if (refreshPromise === tracked) {
				refreshPromise = null;
			}
		});
		refreshPromise = tracked;
		return tracked;
	};

	const refresh = async (force = false): Promise<void> => {
		await loadStatus(force);
	};

	const startPolling = () => {
		if (!desiredPolling()) {
			return;
		}
		void refresh();
		startTimer();
	};

	const activate = () => {
		if (disposed) {
			return;
		}
		consumerCount += 1;
		if (consumerCount === 1) {
			startPolling();
		}
	};

	const deactivate = () => {
		if (consumerCount === 0) {
			return;
		}
		consumerCount -= 1;
		if (consumerCount !== 0) {
			return;
		}
		generation += 1;
		stopTimer();
		loading.value = false;
	};

	const setIntervalSeconds = (seconds: number) => {
		const next = Math.min(86_400, Math.max(1, Math.round(Number(seconds) || 5)));
		if (next === intervalSeconds) {
			return;
		}
		intervalSeconds = next;
		if (desiredPolling()) {
			startTimer();
		}
	};

	const setDefaultExpand = (next: boolean) => {
		defaultExpand = Boolean(next);
	};

	const workspaceConnected = () => {
		if (disposed) {
			return;
		}
		workspaceAvailable = true;
		generation += 1;
		if (consumerCount > 0) {
			startPolling();
		}
	};

	const workspaceDisconnected = () => {
		workspaceAvailable = false;
		resetForDisconnect();
	};

	const command = async (containerId: string, action: DockerAction): Promise<void> => {
		if (!desiredPolling()) {
			throw new DockerFailure('remote_unavailable', 'not_dispatched');
		}
		if (commandPending.value || commandBlocked.value) {
			throw new DockerFailure('conflict', 'not_dispatched');
		}
		const owner = generation;
		commandPending.value = true;
		commandError.value = null;
		commandRevision += 1;
		try {
			await channel.command(containerId, action);
		} catch (cause) {
			const failure =
				cause instanceof DockerFailure ? cause : new DockerFailure('operation_unknown', 'unknown', { cause });
			if (failure.outcome === 'unknown') {
				commandBlocked.value = true;
				commandError.value = failure.code;
			} else if (owner === generation && !disposed) {
				commandError.value = failure.code;
			}
			throw failure;
		} finally {
			commandPending.value = false;
		}
		if (owner === generation && desiredPolling()) {
			await refresh(true);
		}
	};

	const reconcile = async (): Promise<void> => {
		if (!desiredPolling() || commandPending.value) {
			return;
		}
		const owner = generation,
			revision = commandRevision;
		const confirmed = await loadStatus(true);
		if (confirmed && owner === generation && revision === commandRevision && !commandPending.value) {
			commandBlocked.value = false;
			commandError.value = null;
		}
	};

	const toggleExpand = (containerId: string) => {
		const next = new Set(expanded.value);
		if (next.has(containerId)) {
			next.delete(containerId);
		} else {
			next.add(containerId);
		}
		expanded.value = next;
	};

	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		consumerCount = 0;
		workspaceAvailable = false;
		resetForDisconnect();
	};

	return {
		available: shallowReadonly(available),
		containers: shallowReadonly(containers),
		loading: shallowReadonly(loading),
		error: computed(() => commandError.value ?? readError.value),
		commandPending: shallowReadonly(commandPending),
		commandBlocked: shallowReadonly(commandBlocked),
		reconcile,
		expandedContainerIds: computed<ReadonlySet<string>>(() => expanded.value),
		activate,
		deactivate,
		setIntervalSeconds,
		setDefaultExpand,
		workspaceConnected,
		workspaceDisconnected,
		refresh,
		command,
		toggleExpand,
		dispose,
	};
}

export function useDocker(
	controller: DockerSessionController,
	intervalSeconds?: () => number,
	defaultExpand?: () => boolean,
): DockerSessionController {
	let active = false;

	const activate = () => {
		if (active) {
			return;
		}
		active = true;
		controller.activate();
	};

	const deactivate = () => {
		if (!active) {
			return;
		}
		active = false;
		controller.deactivate();
	};

	if (intervalSeconds) {
		watch(intervalSeconds, (value) => controller.setIntervalSeconds(value), { immediate: true });
	}
	if (defaultExpand) {
		watch(defaultExpand, (value) => controller.setDefaultExpand(value), { immediate: true });
	}
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onBeforeUnmount(deactivate);
	return controller;
}
