import { computed, onScopeDispose, ref, shallowReadonly } from 'vue';
import { registerAuthenticatedSessionOwner } from '@/shared/session/public';
import { systemOverviewApi } from '../api/system-overview-api';
import { resourceKey, toPendingResource } from '../model/system-overview-mapper';
import {
	ResourceFailure,
	type LocalResourceStatus,
	type SshResource,
	type SshResourceTarget,
	type ResourceFailureCode,
	type SystemOverviewController,
} from '../model/system-overview-types';

let nextOwnerId = 0;

function waitForNextHost(signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', finish);
			resolve();
		};

		const timer = setTimeout(finish, 200);
		signal.addEventListener('abort', finish, { once: true });
	});
}

function failureCode(cause: unknown): ResourceFailureCode {
	return cause instanceof ResourceFailure ? cause.code : 'request_failed';
}

export function createSystemOverview(): SystemOverviewController {
	const local = ref<LocalResourceStatus | null>(null);
	const remote = ref<SshResource[]>([]);
	const localLoading = ref(false);
	const remoteLoading = ref(false);
	const localError = ref<ResourceFailureCode | null>(null);
	const remoteError = ref<ResourceFailureCode | null>(null);
	let active = true;
	let disposed = false;
	let localRequest: AbortController | null = null;
	let remoteRequest: AbortController | null = null;

	function stopLocal(): void {
		localRequest?.abort();
		localRequest = null;
		localLoading.value = false;
		local.value = null;
		localError.value = null;
	}

	function stopRemote(): void {
		remoteRequest?.abort();
		remoteRequest = null;
		remoteLoading.value = false;
		remote.value = [];
		remoteError.value = null;
	}

	const unregister = registerAuthenticatedSessionOwner(`system-overview-${++nextOwnerId}`, () => {
		stopLocal();
		stopRemote();
	});

	async function loadLocal(): Promise<void> {
		if (!active || disposed || localRequest) {
			return;
		}
		const request = new AbortController();
		localRequest = request;
		localLoading.value = true;
		localError.value = null;
		try {
			const value = await systemOverviewApi.local(request.signal);
			if (localRequest === request) {
				local.value = value;
			}
		} catch (cause) {
			if (localRequest === request) {
				local.value = null;
				localError.value = failureCode(cause);
			}
		} finally {
			if (localRequest === request) {
				localLoading.value = false;
				localRequest = null;
			}
		}
	}

	async function loadRemote(targets: () => Promise<SshResourceTarget[]>): Promise<void> {
		if (!active || disposed || remoteRequest) {
			return;
		}
		const request = new AbortController();
		remoteRequest = request;
		remoteLoading.value = true;
		remoteError.value = null;
		try {
			const items = await targets();
			if (remoteRequest !== request) {
				return;
			}
			const unique = new Map<string, SshResourceTarget>();
			for (const target of items) {
				const key = resourceKey(target.host, target.port);
				if (!unique.has(key)) {
					unique.set(key, {
						id: target.id,
						name: target.name,
						username: target.username,
						host: target.host,
						port: target.port,
					});
				}
			}
			const pending = [...unique.values()].sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
			remote.value = pending.map((target) => toPendingResource(target));

			async function loadHost(target: SshResourceTarget): Promise<void> {
				let result: SshResource;
				try {
					result = await systemOverviewApi.ssh(target, request.signal);
				} catch (cause) {
					result = toPendingResource(target, failureCode(cause));
				}
				if (remoteRequest === request) {
					const key = resourceKey(target.host, target.port);
					remote.value = remote.value.map((current) => (current.key === key ? result : current));
				}
			}

			await Promise.all(
				Array.from({ length: Math.min(4, pending.length) }, async () => {
					while (remoteRequest === request) {
						const target = pending.shift();
						if (!target) {
							return;
						}
						await loadHost(target);
						if (pending.length) {
							await waitForNextHost(request.signal);
						}
					}
				}),
			);
		} catch (cause) {
			if (remoteRequest === request) {
				remote.value = [];
				remoteError.value = failureCode(cause);
			}
		} finally {
			if (remoteRequest === request) {
				remoteLoading.value = false;
				remoteRequest = null;
			}
		}
	}

	function deactivate(): void {
		active = false;
		stopLocal();
		stopRemote();
	}

	function dispose(): void {
		disposed = true;
		deactivate();
		unregister();
	}

	return {
		local: shallowReadonly(local),
		remote: shallowReadonly(remote),
		loading: computed(() => localLoading.value || remoteLoading.value),
		localLoading: shallowReadonly(localLoading),
		remoteLoading: shallowReadonly(remoteLoading),
		localError: shallowReadonly(localError),
		remoteError: shallowReadonly(remoteError),
		loadLocal,
		loadRemote,
		stopLocal,
		stopRemote,

		activate() {
			if (!disposed) {
				active = true;
			}
		},

		deactivate,
		dispose,
	};
}

export function useSystemOverview(): SystemOverviewController {
	const controller = createSystemOverview();
	onScopeDispose(controller.dispose);
	return controller;
}
