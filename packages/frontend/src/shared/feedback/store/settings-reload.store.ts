import { defineStore } from 'pinia';
import { computed, ref, shallowReactive, watch } from 'vue';
import type { SettingsReloadResult, SettingsReloadSource } from '../model';

export const useSettingsReloadStore = defineStore('shared-settings-reload', () => {
	const sources = shallowReactive(new Map<string, SettingsReloadSource>());
	const busy = ref(false);
	const promptOpen = ref(false);
	const lastRunFailed = ref(false);
	let dismissedSignature = '';

	const pendingSources = computed(() => Array.from(sources.values()).filter((source) => source.pending()));
	const pendingCount = computed(() => pendingSources.value.length);
	const pendingSignature = computed(() =>
		pendingSources.value
			.map((source) => source.id)
			.sort()
			.join('|'),
	);

	watch(
		pendingSignature,
		(signature) => {
			if (!signature) {
				dismissedSignature = '';
				promptOpen.value = false;
				lastRunFailed.value = false;
				return;
			}
			if (signature !== dismissedSignature) {
				promptOpen.value = true;
			}
		},
		{ immediate: true },
	);

	function register(source: SettingsReloadSource): () => void {
		sources.set(source.id, source);
		return () => {
			if (sources.get(source.id) === source) {
				sources.delete(source.id);
			}
		};
	}

	function open(): void {
		if (pendingCount.value > 0) {
			promptOpen.value = true;
		}
	}

	function dismiss(): void {
		dismissedSignature = pendingSignature.value;
		promptOpen.value = false;
	}

	async function reloadPending(): Promise<SettingsReloadResult> {
		if (busy.value) {
			return { attempted: 0, failed: 0, remaining: pendingCount.value };
		}
		const targets = pendingSources.value;
		if (targets.length === 0) {
			promptOpen.value = false;
			return { attempted: 0, failed: 0, remaining: 0 };
		}
		busy.value = true;
		lastRunFailed.value = false;
		try {
			const results = await Promise.allSettled(
				targets.map((source) => Promise.resolve().then(() => source.reload())),
			);
			const failed = results.filter((result) => result.status === 'rejected').length;
			const remaining = pendingCount.value;
			lastRunFailed.value = failed > 0 || remaining > 0;
			if (!lastRunFailed.value) {
				promptOpen.value = false;
			}
			return { attempted: targets.length, failed, remaining };
		} finally {
			busy.value = false;
		}
	}

	return {
		busy,
		promptOpen,
		lastRunFailed,
		pendingCount,
		pendingSignature,
		register,
		open,
		dismiss,
		reloadPending,
	};
});
