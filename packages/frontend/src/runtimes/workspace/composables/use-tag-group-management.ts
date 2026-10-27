import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback, useFeedbackMessage } from '@/shared/feedback/public';
import { useAuthSession } from '@/features/auth/public';
import { targetErrorKey } from '@/client/targets/target-types';
import { useConnectionTags, type TagSummary } from '@/features/tags/public';
import type { TagGroupInput } from '../model/tag-group-types';

export function useTagGroupManagement(props: TagGroupInput, events: { close(): void; changed(): void }) {
	const { t } = useI18n();
	const feedback = useFeedback();
	const auth = useAuthSession();
	const tags = useConnectionTags();
	const search = ref('');
	const selected = ref(new Set<number>());
	const name = ref('');
	const snapshot = ref<TagSummary | null>(null);
	const saving = ref(false);
	const message = ref('');
	let failureCause: unknown;
	useFeedbackMessage(
		() => message.value,
		undefined,
		() => failureCause,
	);
	const requiresReview = ref(false);
	let generation = 0;
	let controller = new AbortController();

	const modalTitle = computed(() =>
		props.tag
			? `${t('workspaceConnectionList.manageTags.title')} - ${props.tag.name}`
			: t('workspaceConnectionList.manageTags.title'),
	);
	const filtered = computed(() => {
		const query = search.value.trim().toLocaleLowerCase();
		return props.connections
			.filter(
				(connection) =>
					!query ||
					`${connection.name ?? ''} ${connection.username} ${connection.host}`
						.toLocaleLowerCase()
						.includes(query),
			)
			.slice()
			.sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
	});

	function reset(): void {
		generation += 1;
		controller.abort();
		controller = new AbortController();
		saving.value = false;
		message.value = '';
		requiresReview.value = false;
		snapshot.value = null;
		name.value = '';
		selected.value = new Set();
	}

	watch(
		() => [props.visible, props.tag?.id] as const,
		() => {
			reset();
			const tag = props.tag;
			if (!props.visible || !tag) {
				return;
			}
			snapshot.value = tag;
			name.value = tag.name;
			search.value = '';
			selected.value = new Set(
				props.connections
					.filter((connection) => connection.tagIds.includes(tag.id))
					.map((connection) => connection.id),
			);
		},
		{ immediate: true, flush: 'sync' },
	);
	watch(
		() => (auth.isAuthenticated.value ? auth.user.value?.id : null),
		() => {
			reset();
			events.close();
		},
		{ flush: 'sync' },
	);
	onDeactivated(() => {
		reset();
		events.close();
	});
	onBeforeUnmount(reset);

	function toggle(id: number): void {
		if (saving.value) {
			return;
		}
		const next = new Set(selected.value);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selected.value = next;
	}

	function selectVisible(): void {
		if (saving.value) {
			return;
		}
		selected.value = new Set([...selected.value, ...filtered.value.map((item) => item.id)]);
	}

	function deselectVisible(): void {
		if (saving.value) {
			return;
		}
		const visible = new Set(filtered.value.map((item) => item.id));
		selected.value = new Set([...selected.value].filter((id) => !visible.has(id)));
	}

	function invertVisible(): void {
		for (const connection of filtered.value) {
			toggle(connection.id);
		}
	}

	async function execute(work: (signal: AbortSignal, tag: TagSummary) => Promise<void>): Promise<void> {
		const tag = snapshot.value;
		if (!tag || !props.visible || saving.value || tags.busy.value || requiresReview.value) {
			return;
		}
		const current = generation;
		const signal = controller.signal;
		saving.value = true;
		message.value = '';
		try {
			await work(signal, tag);
		} catch (cause) {
			if (current === generation) {
				failureCause = cause;
				message.value = t('tags.failures.' + targetErrorKey(cause));
				requiresReview.value = tags.needsRefresh.value;
			}
		} finally {
			if (current === generation) {
				saving.value = false;
			}
		}
	}

	function rename(): Promise<void> {
		const nextName = name.value;
		return execute(async (signal, tag) => {
			const updated = await tags.rename(tag, nextName, signal);
			if (!signal.aborted) {
				snapshot.value = updated;
				name.value = updated.name;
				feedback.notifySuccess(t('tags.updateSuccess'));
			}
		});
	}

	function save(): Promise<void> {
		const connectionIds = [...selected.value];
		return execute(async (signal, tag) => {
			const confirmed = await feedback.confirm({
				signal,
				message: t('tags.confirmReplace'),
				destructive: connectionIds.length === 0,
			});
			if (!confirmed || signal.aborted) {
				return;
			}
			await tags.setConnections(tag.id, connectionIds, signal);
			if (!signal.aborted) {
				feedback.notifySuccess(t('tags.associationsSaved'));
				events.changed();
				events.close();
			}
		});
	}

	function removeTag(): Promise<void> {
		return execute(async (signal, tag) => {
			const confirmed = await feedback.confirm({
				signal,
				message: t('workspaceConnectionList.manageTags.confirmDeleteTag', { name: tag.name }),
				destructive: true,
			});
			if (!confirmed || signal.aborted) {
				return;
			}
			await tags.remove(tag.id, signal);
			if (!signal.aborted) {
				events.changed();
				events.close();
			}
		});
	}

	return {
		tags,
		search,
		selected,
		name,
		snapshot,
		saving,
		message,
		requiresReview,
		modalTitle,
		filtered,
		toggle,
		selectVisible,
		deselectVisible,
		invertVisible,
		rename,
		save,
		removeTag,
	};
}
