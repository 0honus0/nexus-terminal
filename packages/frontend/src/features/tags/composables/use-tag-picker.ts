import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TARGET_CONNECTION_MAX_TAGS } from '@nexus-terminal/shared/targets/connections/values';
import { targetIds } from '@nexus-terminal/shared/targets/http';
import { useAuthSession } from '@/features/auth/public';
import { TargetRequestFailure, targetErrorKey } from '@/client/targets/target-types';
import { useFeedback } from '@/shared/feedback/public';
import { useConnectionTags } from './useConnectionTags';

export function useTagPicker(selection: Ref<number[]>) {
	const data = useConnectionTags();
	const auth = useAuthSession();
	const feedback = useFeedback();
	const { t } = useI18n();
	const pending = ref(false);
	const message = ref('');
	let active = true;
	let generation = 0;
	let controller = new AbortController();

	function reset(): void {
		generation += 1;
		controller.abort();
		controller = new AbortController();
		pending.value = false;
		message.value = '';
	}

	async function execute(
		work: (signal: AbortSignal) => Promise<void>,
		operation: 'read' | 'write' = 'write',
	): Promise<void> {
		if (!active || pending.value) {
			return;
		}
		const current = generation;
		const signal = controller.signal;
		pending.value = true;
		message.value = '';
		try {
			await work(signal);
		} catch (cause) {
			if (active && current === generation) {
				message.value = t('tags.failures.' + targetErrorKey(cause, operation));
			}
		} finally {
			if (current === generation) {
				pending.value = false;
			}
		}
	}

	function refresh(): Promise<void> {
		return execute(async () => {
			await data.load(true);
		}, 'read');
	}

	function updateSelection(values: (string | number)[]): void {
		if (!active || pending.value || data.busy.value || data.needsRefresh.value) {
			return;
		}
		try {
			selection.value = targetIds(values, TARGET_CONNECTION_MAX_TAGS);
		} catch (cause) {
			message.value = t('tags.failures.' + targetErrorKey(cause));
		}
	}

	function create(name: string): Promise<void> {
		return execute(async (signal) => {
			if (selection.value.length >= TARGET_CONNECTION_MAX_TAGS) {
				throw new TargetRequestFailure('invalid_input', 'not_dispatched');
			}
			const existing = data.tags.value.find((tag) => tag.name === name.trim());
			const tag = existing ?? (await data.create(name, signal));
			if (!signal.aborted && !selection.value.includes(tag.id)) {
				selection.value = [...selection.value, tag.id];
			}
		});
	}

	function remove(value: string | number): Promise<void> {
		const tag = data.tags.value.find((item) => item.id === value);
		if (!tag) {
			return Promise.resolve();
		}
		return execute(async (signal) => {
			const confirmed = await feedback.confirm({
				signal,
				message: t('tags.prompts.confirmDelete', { name: tag.name }),
				destructive: true,
			});
			if (!confirmed || signal.aborted) {
				return;
			}
			await data.remove(tag.id, signal);
			if (!signal.aborted) {
				selection.value = selection.value.filter((id) => id !== tag.id);
			}
		});
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset, { flush: 'sync' });
	watch([data.tags, data.loaded, data.needsRefresh, data.busy], () => {
		if (active && data.loaded.value && !data.needsRefresh.value && !data.busy.value) {
			const ids = new Set(data.tags.value.map((tag) => tag.id));
			selection.value = selection.value.filter((id) => ids.has(id));
		}
	});
	onMounted(refresh);
	onActivated(() => {
		active = true;
		if (!data.loaded.value || data.needsRefresh.value) {
			void refresh();
		}
	});
	onDeactivated(() => {
		active = false;
		reset();
	});
	onBeforeUnmount(() => {
		active = false;
		reset();
	});
	return { data, pending, message, refresh, create, remove, updateSelection };
}
