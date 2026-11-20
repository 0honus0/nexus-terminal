import { useStorage } from '@vueuse/core';
import { computed, onScopeDispose, watch } from 'vue';
import type { PluginComponentEntry } from '../../plugin/plugin-api.browser.js';
import type { DesktopApplication } from './desktop-api.js';

const recentLimit = 8;
const idleLimit = 2;

export function useDesktopPreload(
	applications: () => ReadonlyMap<string, DesktopApplication>,
	suggestedKeys: () => readonly string[],
) {
	const recent = useStorage<string[]>('nexus.desktop.recent-applications', []);
	const recentKeys = computed(() => (Array.isArray(recent.value) ? recent.value : []));
	const loads = new WeakMap<PluginComponentEntry, Promise<void>>();
	const attempted = new WeakSet<PluginComponentEntry>();
	let cancelIdle: (() => void) | undefined;
	let idleLoading = false;
	let disposed = false;

	const candidates = computed(() =>
		[...new Set([...recentKeys.value, ...suggestedKeys()])]
			.map((key) => applications().get(key)?.plugin)
			.filter((entry): entry is PluginComponentEntry => !!entry?.preload && !entry.lifetime.signal.aborted)
			.slice(0, idleLimit),
	);

	function load(entry: PluginComponentEntry): Promise<void> {
		const existing = loads.get(entry);
		if (existing) return existing;
		attempted.add(entry);
		const loading = Promise.resolve()
			.then(() => {
				if (!disposed && !entry.lifetime.signal.aborted) return entry.preload?.();
			})
			.then(() => undefined)
			.catch(() => {
				loads.delete(entry);
			});
		loads.set(entry, loading);
		return loading;
	}

	function schedule(): void {
		if (disposed || cancelIdle || idleLoading || !candidates.value.some((entry) => !attempted.has(entry))) return;

		function run(): void {
			cancelIdle = undefined;
			const entry = candidates.value.find((candidate) => !attempted.has(candidate));
			if (!entry || disposed) return;
			idleLoading = true;
			void load(entry).then(() => {
				idleLoading = false;
				schedule();
			});
		}

		if (typeof window.requestIdleCallback === 'function') {
			const id = window.requestIdleCallback(run);
			cancelIdle = () => window.cancelIdleCallback(id);
		} else {
			const id = window.setTimeout(run, 0);
			cancelIdle = () => window.clearTimeout(id);
		}
	}

	watch(candidates, schedule, { flush: 'post', immediate: true });
	onScopeDispose(() => {
		disposed = true;
		cancelIdle?.();
	});

	return {
		prepare(key: string) {
			const entry = applications().get(key)?.plugin;
			if (entry?.preload && !entry.lifetime.signal.aborted) void load(entry);
		},

		opened(key: string) {
			if (applications().get(key)?.plugin?.preload && recentKeys.value[0] !== key)
				recent.value = [key, ...recentKeys.value.filter((entry) => entry !== key)].slice(0, recentLimit);
		},
	};
}
