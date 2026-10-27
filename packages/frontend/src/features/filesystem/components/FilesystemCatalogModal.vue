<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiContextMenu,
		UiContextMenuItem,
		UiEmptyState,
		UiLoadingState,
		UiFormActions,
		UiFormField,
		UiInlineNotice,
		UiInput,
		UiOverlayPanel,
		UiSearchInput,
	} from '@/foundation/ui';
	import { useDeviceCapabilities } from '@/foundation/browser';
	import { useLongPressGesture } from '@/foundation/interaction';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { useFeedback, preferenceFailureMessage } from '@/shared/feedback/public';
	import { useFilesystemCatalog } from '../composables/useFilesystemCatalog';
	import type { FavoritePathSummary } from '../model/catalog-types';

	const PADDING = 8;
	const props = defineProps<{
		visible: boolean;
		currentPath: string;
		triggerElement?: HTMLElement | null;
	}>();
	const emit = defineEmits<{ close: []; navigate: [path: string]; terminal: [path: string] }>();
	const { t } = useI18n();
	const device = useDeviceCapabilities();
	const feedback = useFeedback();
	const catalog = useFilesystemCatalog();
	const panel = ref<HTMLElement | null>(null);
	const panelStyle = ref<Record<string, string>>({ visibility: 'hidden' });
	const editing = ref<FavoritePathSummary | null>(null);
	const context = ref<{ item: FavoritePathSummary; x: number; y: number } | null>(null);
	const formVisible = ref(false);
	const saving = ref(false);
	const errorMessage = ref('');
	const form = reactive({ name: '', path: '' });
	const view = useAuthenticatedViewScope({
		available: () => props.visible,

		onRevoke: () => {
			editing.value = null;
			context.value = null;
			formVisible.value = false;
			saving.value = false;
			form.name = '';
			form.path = '';
			errorMessage.value = '';
		},
	});
	const sortIcon = computed(() =>
		catalog.favoriteSort.value === 'name' ? 'fas fa-sort-alpha-down' : 'fas fa-clock',
	);

	const updatePosition = async (): Promise<void> => {
		if (!props.visible || !props.triggerElement) {
			return;
		}
		await nextTick();
		if (!props.visible || !panel.value) {
			return;
		}
		const trigger = props.triggerElement.getBoundingClientRect();
		const width = panel.value.offsetWidth;
		const below = Math.max(0, window.innerHeight - trigger.bottom - 4 - PADDING);
		const above = Math.max(0, trigger.top - 4 - PADDING);
		const desiredHeight = Math.min(320, window.innerHeight - PADDING * 2);
		const openAbove = below < desiredHeight && above > below;
		// Align right edge of popover with trigger's right edge so it expands inward/leftward
		let left = trigger.right - width;
		if (left < PADDING && trigger.left + width <= window.innerWidth - PADDING) {
			left = trigger.left;
		}
		left = Math.max(PADDING, Math.min(left, window.innerWidth - width - PADDING));
		panelStyle.value = {
			[openAbove ? 'bottom' : 'top']:
				`${openAbove ? window.innerHeight - trigger.top + 4 : trigger.bottom + 4}px`,
			left: `${left}px`,
			maxHeight: `${Math.min(desiredHeight, openAbove ? above : below)}px`,
			visibility: 'visible',
		};
	};

	const handleOutsidePointer = (event: MouseEvent): void => {
		if (!props.visible || formVisible.value || context.value) {
			return;
		}
		const target = event.target as Node;
		if (props.triggerElement?.contains(target) || panel.value?.contains(target)) {
			return;
		}
		emit('close');
	};

	const attachPositioning = (): void => {
		document.addEventListener('mousedown', handleOutsidePointer);
		window.addEventListener('resize', updatePosition);
	};

	const detachPositioning = (): void => {
		document.removeEventListener('mousedown', handleOutsidePointer);
		window.removeEventListener('resize', updatePosition);
	};

	watch(
		() => props.visible,
		async (visible, _previous, onCleanup) => {
			let current = true;
			onCleanup(() => {
				current = false;
			});
			detachPositioning();
			if (!visible) {
				context.value = null;
				panelStyle.value = { visibility: 'hidden' };
				return;
			}
			catalog.favoriteSearch.value = '';
			attachPositioning();
			await updatePosition();
			try {
				await catalog.loadFavorites(true);
			} catch {
				if (current) {
					feedback.notifyError(t('favoritePaths.notifications.fetchError'));
				}
			}
		},
		{ immediate: true },
	);
	watch(
		() => [catalog.filteredFavorites.value.length, catalog.favoriteSort.value] as const,
		() => void updatePosition(),
	);
	onBeforeUnmount(detachPositioning);

	const toggleSort = async (): Promise<void> => {
		await catalog.setFavoriteSort(catalog.favoriteSort.value === 'name' ? 'lastUsedAt' : 'name');
		await updatePosition();
	};

	const openAdd = (): void => {
		editing.value = null;
		form.name = '';
		form.path = '';
		errorMessage.value = '';
		formVisible.value = true;
	};

	const openEdit = (item: FavoritePathSummary): void => {
		editing.value = item;
		form.name = item.name ?? '';
		form.path = item.path;
		errorMessage.value = '';
		formVisible.value = true;
	};

	const closeForm = (): void => {
		if (!saving.value) {
			formVisible.value = false;
		}
	};

	const save = async (): Promise<void> => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		const path = form.path.trim();
		if (!path || saving.value) {
			if (!path) {
				errorMessage.value = t('favoritePaths.addEditForm.validation.pathRequired');
			}
			return;
		}
		saving.value = true;
		errorMessage.value = '';
		try {
			await catalog.saveFavorite(
				editing.value
					? { id: editing.value.id, expectedVersion: editing.value.version, path, name: form.name }
					: { path, name: form.name },
				signal,
			);
			if (!view.isCurrent(signal)) {
				return;
			}
			feedback.notifySuccess(
				t(
					editing.value
						? 'favoritePaths.notifications.updateSuccess'
						: 'favoritePaths.notifications.addSuccess',
				),
			);
			formVisible.value = false;
			await updatePosition();
		} catch (cause) {
			if (view.isCurrent(signal)) {
				feedback.notifyError(preferenceFailureMessage(cause, t));
			}
		} finally {
			if (view.isCurrent(signal)) {
				saving.value = false;
			}
		}
	};

	const removeFavorite = async (item: FavoritePathSummary): Promise<void> => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		if (
			!(await feedback.confirm({
				message: t('favoritePaths.confirmDelete', { name: item.name || item.path }),
				signal,
				destructive: true,
			}))
		) {
			return;
		}
		try {
			if (!view.isCurrent(signal)) {
				return;
			}
			await catalog.removeFavorite(item, signal);
			if (!view.isCurrent(signal)) {
				return;
			}
			feedback.notifySuccess(t('favoritePaths.notifications.deleteSuccess'));
			await updatePosition();
		} catch (cause) {
			if (view.isCurrent(signal)) {
				feedback.notifyError(preferenceFailureMessage(cause, t));
			}
		}
	};

	const navigateFavorite = async (item: FavoritePathSummary): Promise<void> => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		try {
			await catalog.useFavorite(item, signal);
		} catch {
			if (view.isCurrent(signal)) {
				feedback.notifyError(t('favoritePaths.notifications.markAsUsedError'));
			}
		}
		if (!view.isCurrent(signal)) {
			return;
		}
		emit('navigate', item.path);
		emit('close');
	};

	const sendToTerminal = (item: FavoritePathSummary): void => {
		emit('terminal', item.path);
		emit('close');
	};

	const openContextAt = (item: FavoritePathSummary, x: number, y: number): void => {
		context.value = { item, x, y };
	};

	const openContext = (event: MouseEvent, item: FavoritePathSummary): void => {
		event.preventDefault();
		openContextAt(item, event.clientX, event.clientY);
	};

	const longPress = useLongPressGesture<FavoritePathSummary>({
		enabled: () => device.hasTouch.value,

		vibrateMs: 15,

		onTrigger: (item, point) => openContextAt(item, point.x, point.y),
	});

	const navigateFromClick = (event: MouseEvent, item: FavoritePathSummary): void => {
		if (longPress.consumeClick(event)) {
			return;
		}
		void navigateFavorite(item);
	};

	const sendContextToTerminal = (): void => {
		if (!context.value) {
			return;
		}
		const item = context.value.item;
		context.value = null;
		sendToTerminal(item);
	};

	const editContextFavorite = (): void => {
		if (!context.value) {
			return;
		}
		const item = context.value.item;
		context.value = null;
		openEdit(item);
	};

	const removeContextFavorite = (): void => {
		if (!context.value) {
			return;
		}
		const item = context.value.item;
		context.value = null;
		void removeFavorite(item);
	};
</script>

<template>
	<div
		v-if="visible"
		ref="panel"
		role="dialog"
		:aria-label="t('favoritePaths.title')"
		:style="panelStyle"
		class="favorite-paths-popover ui-glass-panel fixed z-50 flex flex-col overflow-hidden rounded-md"
	>
		<div class="flex shrink-0 items-center gap-2 p-2">
			<div class="min-w-0 flex-grow">
				<UiSearchInput
					v-model="catalog.favoriteSearch.value"
					density="compact"
					class="w-full"
					:placeholder="t('favoritePaths.searchPlaceholder')"
					:aria-label="t('favoritePaths.searchPlaceholder')"
					:clear-label="t('common.clear')"
				/>
			</div>
			<UiButton
				type="button"
				appearance="soft"
				icon-only
				:aria-label="t('favoritePaths.sortToggle')"
				:title="t('favoritePaths.sortToggle')"
				@click="toggleSort"
			>
				<i :class="sortIcon" aria-hidden="true"></i>
			</UiButton>
			<UiButton
				type="button"
				appearance="solid"
				tone="primary"
				icon-only
				:title="t('favoritePaths.addNew')"
				:aria-label="t('favoritePaths.addNew')"
				@click="openAdd"
			>
				<i class="fas fa-plus text-base" aria-hidden="true"></i>
			</UiButton>
		</div>

		<div class="min-h-0 flex-grow overflow-y-auto p-1 text-sm">
			<UiLoadingState
				v-if="catalog.loadingFavorites.value && !catalog.filteredFavorites.value.length"
				dense
				:bordered="false"
				:title="t('favoritePaths.loading')"
			/>
			<UiEmptyState
				v-else-if="!catalog.filteredFavorites.value.length"
				dense
				:bordered="false"
				icon="fa-solid fa-star-half-stroke"
				:title="catalog.favoriteSearch.value ? t('favoritePaths.noResults') : t('favoritePaths.noFavorites')"
			/>
			<ul v-else class="m-0 list-none p-0">
				<li
					v-for="item in catalog.filteredFavorites.value"
					:key="item.id"
					class="group flex cursor-pointer items-start rounded-lg p-2 transition-colors duration-150 hover:bg-primary/10"
					:title="item.path"
					@contextmenu.prevent.stop="openContext($event, item)"
					@pointerdown="longPress.start($event, item)"
					@pointermove="longPress.move"
					@pointerup="longPress.end"
					@pointercancel="longPress.cancel"
				>
					<button
						type="button"
						class="min-w-0 w-full overflow-hidden text-left"
						:aria-label="item.name || item.path"
						@click="navigateFromClick($event, item)"
					>
						<span class="favorite-path-text block font-medium text-foreground">{{
							item.name || item.path
						}}</span>
						<span v-if="item.name" class="favorite-path-text mt-0.5 block text-xs text-text-secondary">{{
							item.path
						}}</span>
					</button>
				</li>
			</ul>
		</div>
	</div>

	<UiContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="210" @close="context = null">
		<UiContextMenuItem @mousedown.prevent @click="sendContextToTerminal">
			<i class="fas fa-terminal" aria-hidden="true"></i>
			<span>{{ t('favoritePaths.terminalAction') }}</span>
		</UiContextMenuItem>
		<UiContextMenuItem @mousedown.prevent @click="editContextFavorite">
			<i class="fas fa-pencil-alt" aria-hidden="true"></i>
			<span>{{ t('common.edit') }}</span>
		</UiContextMenuItem>
		<UiContextMenuItem tone="danger" @mousedown.prevent @click="removeContextFavorite">
			<i class="fas fa-trash-alt" aria-hidden="true"></i>
			<span>{{ t('common.delete') }}</span>
		</UiContextMenuItem>
	</UiContextMenu>

	<UiOverlayPanel
		:visible="formVisible"
		:z-index="60"
		panel-class="max-w-md flex flex-col p-6"
		role="dialog"
		:aria-modal="true"
		:aria-label="t(editing ? 'favoritePaths.addEditForm.editTitle' : 'favoritePaths.addEditForm.addTitle')"
		@close="closeForm"
	>
		<h2 class="m-0 mb-6 text-center text-xl font-semibold">
			{{ t(editing ? 'favoritePaths.addEditForm.editTitle' : 'favoritePaths.addEditForm.addTitle') }}
		</h2>
		<form class="flex-grow space-y-4 overflow-y-auto" @submit.prevent="save">
			<UiFormField :label="t('favoritePaths.addEditForm.nameLabel')" for-id="favPath-name">
				<UiInput
					id="favPath-name"
					v-model="form.name"
					:disabled="saving"
					:placeholder="t('favoritePaths.addEditForm.namePlaceholder')"
				/>
			</UiFormField>
			<UiFormField :label="t('favoritePaths.addEditForm.pathLabel')" for-id="favPath-path" required>
				<UiInput
					id="favPath-path"
					v-model="form.path"
					required
					:disabled="saving"
					:placeholder="t('favoritePaths.addEditForm.pathPlaceholder')"
				/>
			</UiFormField>
			<UiInlineNotice v-if="errorMessage" tone="danger">
				{{ errorMessage }}
			</UiInlineNotice>
		</form>
		<UiFormActions class="mt-8 border-t border-border/50 pt-4">
			<UiButton type="button" :disabled="saving" @click="closeForm">
				{{ t('common.cancel') }}
			</UiButton>
			<UiButton
				type="button"
				appearance="solid"
				tone="primary"
				:disabled="saving || !form.path.trim()"
				:loading="saving"
				@click="save"
			>
				{{ t('common.save') }}
			</UiButton>
		</UiFormActions>
	</UiOverlayPanel>
</template>

<style scoped>
	.favorite-paths-popover {
		width: 18rem;
		max-width: calc(100vw - 1rem);
		max-height: min(20rem, calc(100dvh - 1rem));
	}

	.favorite-path-text {
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.35;
		white-space: nowrap;
	}

	@media (min-width: 768px) {
		.favorite-paths-popover {
			width: 20rem;
		}
	}
</style>
