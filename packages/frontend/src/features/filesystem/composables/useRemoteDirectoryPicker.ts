import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import { useFeedback } from '@/shared/feedback/public';
import { isNetworkFailure } from '@/client/http/network-failure';
import { directoryBrowserApi } from '../api/directory-browser-api';
import { DirectoryBrowserFailure, type DirectoryEntry, type DirectoryResource } from '../model/directory-browser-types';

export function useRemoteDirectoryPicker(targetId: number, initialPath: string) {
	const { t } = useI18n();
	const feedback = useFeedback();
	const path = ref('/');
	const entries = ref<DirectoryEntry[]>([]);
	const busy = ref(false);
	const ready = ref(false);
	const listed = ref(false);
	let active = true;
	let resource: DirectoryResource | null = null;
	let lastReadAt = 0;
	const pending = new Set<Promise<void>>();
	let closePromise: Promise<void> | null = null;
	const view = useAuthenticatedViewScope({ onRevoke: stop });

	function notify(cause: unknown): void {
		if (isNetworkFailure(cause)) return;
		const code = cause instanceof DirectoryBrowserFailure ? cause.code : 'request_failed';
		const messages: Partial<Record<DirectoryBrowserFailure['code'], string>> = {
			unauthenticated: 'fileManager.errors.sessionExpired',
			forbidden: 'fileManager.errors.permissionDenied',
			not_found: 'fileManager.errors.notFound',
			stale_target: 'fileManager.errors.targetChanged',
			host_key_untrusted: 'fileManager.errors.hostKeyUntrusted',
			limit_exceeded: 'fileManager.errors.capacityExceeded',
			protocol_failure: 'fileManager.errors.invalidResponse',
			not_directory: 'fileManager.directoryPicker.notDirectory',
		};
		feedback.notifyError(t(messages[code] ?? 'fileManager.errors.remoteUnavailable'));
	}

	function stop(): void {
		if (closePromise) return;
		active = false;
		ready.value = false;
		closePromise = Promise.allSettled([...pending]).then(async () => {
			if (resource) {
				const owned = resource;
				resource = null;
				await directoryBrowserApi.close(owned);
			}
		});
		void closePromise.catch(notify);
	}

	async function read(nextPath: string, signal: AbortSignal): Promise<void> {
		if (resource && Date.now() - lastReadAt >= 60_000) {
			await directoryBrowserApi.close(resource);
			resource = null;
		}
		if (!active || !view.isCurrent(signal)) return;
		if (!resource) {
			resource = await directoryBrowserApi.open(targetId, signal);
		}
		if (!active || !view.isCurrent(signal)) return;
		await directoryBrowserApi.checkDirectory(resource, nextPath, signal);
		if (!active || !view.isCurrent(signal)) return;
		path.value = nextPath;
		entries.value = [];
		ready.value = true;
		listed.value = false;
		lastReadAt = Date.now();
		const listing = await directoryBrowserApi.list(resource, nextPath, signal);
		if (!active || !view.isCurrent(signal)) return;
		entries.value = listing;
		listed.value = true;
		lastReadAt = Date.now();
	}

	function navigate(nextPath: string, fallbackToRoot = false): void {
		if (!active || busy.value) return;
		const signal = view.capture();
		if (signal.aborted) return;
		busy.value = true;
		const task = Promise.resolve().then(async () => {
			try {
				await read(nextPath, signal);
			} catch (cause) {
				if (!active || !view.isCurrent(signal)) return;
				if (cause instanceof DirectoryBrowserFailure && cause.code === 'not_found') lastReadAt = 0;
				notify(cause);
				if (
					fallbackToRoot &&
					nextPath !== '/' &&
					cause instanceof DirectoryBrowserFailure &&
					cause.code === 'not_found'
				) {
					try {
						await read('/', signal);
					} catch (fallbackCause) {
						if (active && view.isCurrent(signal)) notify(fallbackCause);
					}
				}
			} finally {
				if (active && view.isCurrent(signal)) busy.value = false;
			}
		});
		pending.add(task);
		void task.then(
			() => pending.delete(task),
			() => pending.delete(task),
		);
	}

	navigate(initialPath || '/', true);
	return { path, entries, busy, ready, listed, navigate };
}
