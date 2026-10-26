<script setup lang="ts">
	import { isNetworkFailure } from '@/client/http/network-failure';
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiContextMenu,
		UiContextMenuItem,
		UiEmptyState,
		UiLoadingState,
		UiInput,
		UiSearchInput,
	} from '@/foundation/ui';
	import { readStoredValue, stringStorageCodec, writeClipboardText, writeStoredValue } from '@/foundation/browser';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { useFeedback, preferenceFailureMessage } from '@/shared/feedback/public';
	import { focusRegistry } from '@/shared/focus/public';
	import { useWheelScale } from '@/foundation/interaction';
	import QuickCommandForm from './QuickCommandForm.vue';
	import { useQuickCommandsStore } from '../store/quickCommands.store';
	import { expandQuickCommand } from '../model/quick-command-expansion';
	import type {
		ExecuteCommandIntent,
		QuickCommandSummary,
		QuickCommandFormInput,
		QuickCommandTagSummary,
	} from '../model/quick-command-types';

	type DisplayMode = 'name' | 'command';
	const displayModeStorage = {
		namespace: 'quick-commands.display-mode',
		version: 1,
		codec: stringStorageCodec((value) => value === 'name' || value === 'command'),
	} as const;
	const props = withDefaults(
		defineProps<{ collapsibleSearch?: boolean; showTags?: boolean; rowScale?: number; compact?: boolean }>(),
		{ collapsibleSearch: false, showTags: true, rowScale: 1, compact: false },
	);
	const emit = defineEmits<{
		execute: [intent: ExecuteCommandIntent];
		rowScale: [scale: number];
		compactMode: [compact: boolean];
	}>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const store = useQuickCommandsStore();
	const { groups, flat, tags, search, sort, loading, error, expanded, selectedId } = storeToRefs(store);
	const localScale = ref(props.rowScale);
	const visible = ref(false);
	const editing = ref<QuickCommandSummary | null>(null);
	const searchInput = ref<{ focus?: (options?: FocusOptions) => void } | null>(null);
	const searchExpanded = ref(!props.collapsibleSearch);
	const root = ref<HTMLElement | null>(null);
	const list = ref<HTMLElement | null>(null);
	const context = ref<{ command: QuickCommandSummary; x: number; y: number } | null>(null);
	const tagContext = ref<{ tag: QuickCommandTagSummary | null; x: number; y: number } | null>(null);
	const deletingTag = ref(false);
	const editingTagId = ref<number | 'untagged' | null>(null);
	const tagDraft = ref('');
	const editingTag = ref<QuickCommandTagSummary | null>(null);
	let unregisterFocus: (() => void) | undefined;
	const view = useAuthenticatedViewScope({
		onRevoke: () => {
			visible.value = false;
			editing.value = null;
			context.value = null;
			tagContext.value = null;
			deletingTag.value = false;
			editingTagId.value = null;
			editingTag.value = null;
			tagDraft.value = '';
		},
	});

	watch(error, (cause) => {
		if (!cause || isNetworkFailure(cause)) return;
		feedback.notifyError(preferenceFailureMessage(cause, t), 0, {
			key: 'quick-commands',
			label: t('common.refresh'),

			disabled: () => loading.value,

			onClick: () => {
				void store.load(true).catch(() => undefined);
			},
		});
	});

	const saving = ref(false);
	const formView = useAuthenticatedViewScope({
		available: () => visible.value,

		onRevoke: () => {
			saving.value = false;
		},
	});

	const readDisplayMode = (): DisplayMode => (readStoredValue(displayModeStorage) === 'name' ? 'name' : 'command');

	const displayMode = ref<DisplayMode>(readDisplayMode());
	useWheelScale({
		target: () => list.value,

		value: () => props.rowScale,

		scale: localScale,

		onChange: (scale) => {
			emit('rowScale', scale);
		},

		min: 0.5,
		max: 2.5,
		step: 0.12,
		precision: 2,
		thresholdPx: 64,
		maxStepsPerEvent: 3,
	});
	const rowStyle = computed(() => {
		const scale = localScale.value;
		return {
			'--quick-row-scale': scale,
			'--quick-row-min-height': `${scale * 1.875}rem`,
			'--quick-row-padding-block': `${Math.max(0.1, scale * 0.5 - 0.15)}rem`,
			'--quick-row-padding-inline': `${scale * 0.6}rem`,
			'--quick-row-compact-min-height': `${scale * 1.5}rem`,
			'--quick-row-compact-padding-block': `${Math.max(0.05, scale * 0.3 - 0.15)}rem`,
		};
	});

	watch(
		() => props.collapsibleSearch,
		(enabled) => {
			searchExpanded.value = !enabled || Boolean(search.value);
		},
	);

	const openSearch = async (): Promise<boolean> => {
		searchExpanded.value = true;
		await nextTick();
		searchInput.value?.focus?.();
		return true;
	};

	onMounted(() => {
		void store.load().catch(() => undefined);
		unregisterFocus = focusRegistry.register('quickCommandsSearch', openSearch, () =>
			Boolean(root.value?.getClientRects().length),
		);
	});
	onBeforeUnmount(() => unregisterFocus?.());

	const toggleDisplayMode = () => {
		displayMode.value = displayMode.value === 'name' ? 'command' : 'name';
		writeStoredValue(displayModeStorage, displayMode.value);
	};

	const cycleSort = () => {
		sort.value = sort.value === 'name' ? 'usageCount' : sort.value === 'usageCount' ? 'lastUsed' : 'name';
	};

	const sortButtonIcon = computed(() =>
		sort.value === 'name'
			? 'fas fa-sort-alpha-down'
			: sort.value === 'usageCount'
				? 'fas fa-sort-amount-down'
				: 'fas fa-clock',
	);
	const sortButtonTitle = computed(() =>
		t(
			sort.value === 'name'
				? 'quickCommands.sortByName'
				: sort.value === 'usageCount'
					? 'quickCommands.sortByUsage'
					: 'quickCommands.sortByLastUsed',
		),
	);

	const revealSelected = () => {
		const id = selectedId.value;
		if (id === null) {
			return;
		}
		root.value?.querySelector<HTMLElement>(`[data-command-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
	};

	const handleSearchKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && props.collapsibleSearch && !search.value) {
			event.preventDefault();
			searchExpanded.value = false;
			store.resetSelection();
			return;
		}
		const candidates = props.showTags ? store.visible : store.flat;
		if (!candidates.length) {
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			store.selectNext(props.showTags);
			revealSelected();
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			store.selectPrevious(props.showTags);
			revealSelected();
			return;
		}
		if (event.key === 'Enter') {
			const command = candidates.find((item) => item.id === selectedId.value);
			if (!command) {
				return;
			}
			event.preventDefault();
			run(command);
		}
	};

	const handleSearchBlur = () => {
		window.setTimeout(() => {
			if (document.activeElement !== searchInput.value && !list.value?.contains(document.activeElement)) {
				store.resetSelection();
				if (props.collapsibleSearch && !search.value) {
					searchExpanded.value = false;
				}
			}
		}, 0);
	};

	const startTagEdit = (group: { id: number | null; name: string }) => {
		tagContext.value = null;
		editingTagId.value = group.id ?? 'untagged';
		editingTag.value = tags.value.find((tag) => tag.id === group.id) ?? null;
		tagDraft.value = group.id === null ? '' : group.name;
	};

	const cancelTagEdit = () => {
		editingTagId.value = null;
		tagDraft.value = '';
	};

	const finishTagEdit = async (group: { id: number | null; name: string; commands: QuickCommandSummary[] }) => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		const editing = editingTagId.value;
		const original = editingTag.value;
		if (editing === null) {
			return;
		}
		const name = tagDraft.value.trim();
		cancelTagEdit();
		if (!name) {
			return;
		}
		try {
			if (editing === 'untagged') {
				const result = await store.createTagForCommands(name, group.commands, signal);
				if (!view.isCurrent(signal)) {
					return;
				}
				if (!result.assigned) {
					feedback.notifyWarning(
						t('quickCommands.tags.assignFailedAfterCreate', {
							name: result.tag.name,
							error: preferenceFailureMessage(result.error, t),
						}),
					);
				}
			} else if (original && name !== original.name) {
				await store.renameTag(original, name, signal);
			}
		} catch (cause) {
			if (isNetworkFailure(cause) || cause === error.value) return;
			if (!view.isCurrent(signal)) {
				return;
			}
			feedback.notifyError(
				t(editing === 'untagged' ? 'quickCommands.tags.createFailed' : 'quickCommands.tags.renameFailed', {
					error: preferenceFailureMessage(cause, t),
				}),
			);
		}
	};

	const displayText = (command: QuickCommandSummary) =>
		displayMode.value === 'name' ? command.name?.trim() || command.command : command.command;

	const edit = (command: QuickCommandSummary) => {
		editing.value = command;
		visible.value = true;
	};

	const add = () => {
		editing.value = null;
		visible.value = true;
	};

	const save = async (input: QuickCommandFormInput) => {
		const signal = formView.capture();
		if (!formView.isCurrent(signal) || saving.value) {
			return;
		}
		saving.value = true;
		try {
			await store.save(input, editing.value ?? undefined, signal);
			if (formView.isCurrent(signal)) {
				visible.value = false;
			}
		} catch (cause) {
			if (isNetworkFailure(cause) || cause === error.value) return;
			if (!formView.isCurrent(signal)) {
				return;
			}
			feedback.notifyError(
				t('quickCommands.notifications.saveFailed', {
					error: preferenceFailureMessage(cause, t),
				}),
			);
		} finally {
			if (formView.isCurrent(signal)) {
				saving.value = false;
			}
		}
	};

	const processTemplate = (template: string, variables: Record<string, string>) => {
		const expansion = expandQuickCommand(template, variables);
		if (expansion.unresolvedVariables.length) {
			feedback.notifyWarning(
				t('quickCommands.form.warningUndefinedVariables', {
					variables: expansion.unresolvedVariables.join(', '),
				}),
			);
		}
		return expansion.command;
	};

	const processCommand = (commandDefinition: QuickCommandSummary) =>
		processTemplate(commandDefinition.command, commandDefinition.variables);

	const executeDraft = (input: QuickCommandFormInput) => {
		emit('execute', { command: processTemplate(input.command, input.variables) });
		visible.value = false;
	};

	const run = (command: QuickCommandSummary, all = false) => {
		context.value = null;
		emit('execute', { command: processCommand(command), sourceId: command.id, allSessions: all });
		void store.recordUsage(command.id);
	};

	const copy = async (command: QuickCommandSummary) => {
		context.value = null;
		try {
			await writeClipboardText(command.command);
			feedback.notifySuccess(t('quickCommands.notifications.copied'));
		} catch {
			feedback.notifyError(t('quickCommands.notifications.copyFailed'));
		}
	};

	const remove = async (command: QuickCommandSummary) => {
		context.value = null;
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		if (
			await feedback.confirm({
				message: t('quickCommands.confirmDelete', { name: command.name ?? command.command }),
				signal,
				destructive: true,
			})
		) {
			try {
				if (!view.isCurrent(signal)) {
					return;
				}
				await store.remove(command, signal);
			} catch (cause) {
				if (isNetworkFailure(cause) || cause === error.value) return;
				if (!view.isCurrent(signal)) {
					return;
				}
				feedback.notifyError(
					t('quickCommands.notifications.deleteFailed', {
						error: preferenceFailureMessage(cause, t),
					}),
				);
			}
		}
	};

	const openContext = (event: MouseEvent, command: QuickCommandSummary) => {
		tagContext.value = null;
		selectedId.value = command.id;
		context.value = { command, x: event.clientX, y: event.clientY };
	};

	const openTagContext = (event: MouseEvent, group: { id: number | null }) => {
		context.value = null;
		const tag = tags.value.find((item) => item.id === group.id);
		if ((group.id !== null && !tag) || deletingTag.value) {
			return;
		}
		const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
		const keyboard = event.clientX === 0 && event.clientY === 0;
		tagContext.value = {
			tag: tag ?? null,
			x: keyboard && anchor ? anchor.left : event.clientX,
			y: keyboard && anchor ? anchor.bottom : event.clientY,
		};
	};

	const removeTag = async (tag: QuickCommandTagSummary | null, mode: 'tag' | 'group') => {
		tagContext.value = null;
		const signal = view.capture();
		if (!view.isCurrent(signal) || deletingTag.value) {
			return;
		}
		deletingTag.value = true;
		// Use the full store, including commands hidden by the current search.
		const commands = store.items.filter((command) =>
			tag ? command.tagIds.includes(tag.id) : command.tagIds.length === 0,
		);
		const name = tag?.name ?? t('quickCommands.untagged');
		try {
			const confirmed = await feedback.confirm({
				message:
					mode === 'group'
						? t(
								tag
									? 'quickCommands.tags.confirmDeleteGroup'
									: 'quickCommands.tags.confirmDeleteUntaggedGroup',
								{ name, count: commands.length },
							)
						: t('quickCommands.tags.confirmDelete', { name }),
				signal,
				destructive: true,
			});
			if (!confirmed || !view.isCurrent(signal)) {
				return;
			}
			if (mode === 'group') {
				await store.removeGroup(tag, commands, signal);
			} else if (tag) {
				await store.removeTag(tag, signal);
			}
		} catch (cause) {
			if (!view.isCurrent(signal) || isNetworkFailure(cause) || cause === error.value) {
				return;
			}
			feedback.notifyError(
				t('quickCommands.tags.deleteFailed', {
					name,
					error: preferenceFailureMessage(cause, t),
				}),
			);
		} finally {
			if (view.isCurrent(signal)) {
				deletingTag.value = false;
			}
		}
	};
</script>

<template>
	<section ref="root" class="quick-commands-root flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
		<div class="quick-commands-controls flex shrink-0 items-center gap-2 px-2 py-1.5">
			<UiButton
				v-if="collapsibleSearch && !searchExpanded"
				appearance="ghost"
				density="compact"
				icon-only
				class="quick-control"
				:title="t('quickCommands.expandSearch')"
				:aria-label="t('quickCommands.expandSearch')"
				@click="openSearch"
			>
				<i class="fas fa-search" aria-hidden="true"></i>
			</UiButton>
			<UiSearchInput
				v-if="searchExpanded"
				ref="searchInput"
				v-model="search"
				data-focus-id="quickCommandsSearch"
				class="quick-commands-search min-w-0 flex-1 text-sm text-foreground"
				density="compact"
				:placeholder="t('quickCommands.searchPlaceholder')"
				:aria-label="t('quickCommands.searchPlaceholder')"
				:clear-label="t('common.clear')"
				@keydown="handleSearchKeydown"
				@blur="handleSearchBlur"
			/>
			<UiButton
				v-if="error"
				appearance="ghost"
				density="compact"
				icon-only
				class="quick-control"
				:loading="loading"
				:disabled="loading"
				:title="t('common.refresh')"
				:aria-label="t('common.refresh')"
				@click="store.load(true).catch(() => undefined)"
			>
				<i class="fas fa-sync-alt" aria-hidden="true"></i>
			</UiButton>
			<UiButton
				appearance="ghost"
				density="compact"
				icon-only
				class="quick-control"
				:title="sortButtonTitle"
				:aria-label="sortButtonTitle"
				@click="cycleSort"
			>
				<i :class="sortButtonIcon" aria-hidden="true"></i>
			</UiButton>
			<UiButton
				appearance="ghost"
				density="compact"
				icon-only
				class="quick-control"
				:class="{ 'quick-control--active': compact }"
				:title="t('quickCommands.compactMode')"
				:aria-label="t('quickCommands.compactMode')"
				@click="emit('compactMode', !compact)"
			>
				<i :class="['fas', compact ? 'fa-compress-alt' : 'fa-expand-alt']" aria-hidden="true"></i>
			</UiButton>
			<UiButton
				appearance="ghost"
				density="compact"
				icon-only
				class="quick-control"
				:title="t(displayMode === 'name' ? 'quickCommands.switchToCommand' : 'quickCommands.switchToName')"
				:aria-label="t(displayMode === 'name' ? 'quickCommands.switchToCommand' : 'quickCommands.switchToName')"
				@click="toggleDisplayMode"
			>
				<i :class="['fas', displayMode === 'name' ? 'fa-tag' : 'fa-terminal']" aria-hidden="true"></i>
			</UiButton>
			<UiButton
				appearance="ghost"
				tone="primary"
				density="compact"
				icon-only
				class="quick-control quick-control--primary"
				:title="t('quickCommands.add')"
				:aria-label="t('quickCommands.add')"
				@click="add"
			>
				<i class="fas fa-plus" aria-hidden="true"></i>
			</UiButton>
		</div>

		<div
			ref="list"
			class="quick-command-list-area min-h-0 flex-1 overflow-y-auto p-2"
			:style="rowStyle"
			:data-row-scale="localScale.toFixed(2)"
		>
			<UiLoadingState v-if="loading" class="h-full" compact :bordered="false" :title="t('common.loading')" />
			<UiEmptyState
				v-else-if="!(showTags ? groups.length : flat.length) && search"
				class="h-full"
				compact
				icon="fa-solid fa-magnifying-glass"
				:title="t('quickCommands.empty')"
			/>
			<UiEmptyState
				v-else-if="!(showTags ? groups.length : flat.length)"
				class="h-full"
				compact
				icon="fa-solid fa-bolt"
				:title="t('quickCommands.empty')"
			>
				<template #action>
					<UiButton appearance="ghost" density="compact" @click="add">
						{{ t('quickCommands.addFirst') }}
					</UiButton>
				</template>
			</UiEmptyState>

			<template v-else-if="showTags">
				<section
					v-for="group in groups"
					:key="group.id ?? 'untagged'"
					class="quick-command-group-card mb-2 last:mb-0 overflow-hidden rounded-lg border border-border/60 bg-card/40 shadow-2xs transition-colors duration-200 hover:border-border/80"
				>
					<!-- 组头高度固定，展开时只显示或隐藏列表，避免边框参与布局动画。 -->
					<div
						class="quick-command-group-header group flex select-none items-center justify-between bg-card/90 dark:bg-card/60 px-2.5 py-1.5 font-semibold text-foreground transition-colors duration-150 hover:bg-header/70 cursor-pointer"
						:class="{ 'quick-command-group-header--compact': compact }"
						@click="store.toggle(group.name)"
						@contextmenu.prevent.stop="openTagContext($event, group)"
					>
						<div class="flex items-center gap-1.5 min-w-0 flex-1">
							<button
								type="button"
								class="quick-command-group-toggle flex shrink-0 items-center justify-center rounded text-text-secondary/70 transition-colors group-hover:text-foreground cursor-pointer"
								:aria-expanded="expanded[group.name] !== false"
								@click.stop="store.toggle(group.name)"
							>
								<i
									class="fas fa-chevron-down text-[10px] transition-transform duration-200"
									:class="{ '-rotate-90': expanded[group.name] === false }"
									aria-hidden="true"
								></i>
							</button>
							<UiInput
								v-if="editingTagId === (group.id ?? 'untagged')"
								v-model="tagDraft"
								class="min-w-0 flex-1 h-6 text-sm"
								autofocus
								:placeholder="
									group.id === null
										? t('quickCommands.tags.createFromUntagged')
										: t('quickCommands.tags.renameHint')
								"
								@click.stop
								@keyup.enter.stop="finishTagEdit(group)"
								@keyup.esc.stop="cancelTagEdit"
								@blur="finishTagEdit(group)"
							/>
							<button
								v-else
								type="button"
								class="quick-command-group-name inline-flex items-center min-w-0 shrink truncate text-left text-sm font-semibold text-foreground tracking-tight hover:text-primary transition-colors cursor-pointer"
								:title="
									group.id === null
										? t('quickCommands.tags.createFromUntagged')
										: t('quickCommands.tags.contextHint')
								"
								@click.stop="group.id === null ? startTagEdit(group) : store.toggle(group.name)"
							>
								{{ group.id === null ? t('quickCommands.untagged') : group.name }}
							</button>
						</div>

						<!-- 右侧：数量胶囊徽章 -->
						<span
							class="quick-command-group-badge flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-foreground/6 px-1.5 font-mono text-[10px] font-semibold text-text-secondary/80 border border-border/20 transition-colors group-hover:bg-foreground/10 group-hover:text-foreground"
						>
							{{ group.commands.length }}
						</span>
					</div>

					<!-- 指令条目列表 -->
					<ul
						v-show="expanded[group.name] !== false"
						class="quick-command-group-list m-0 list-none p-1 space-y-1 bg-background/20"
					>
						<li
							v-for="command in group.commands"
							:key="command.id"
							:data-command-id="command.id"
							class="quick-command-row group flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg transition-all duration-150 hover:bg-primary/10 active:bg-primary/15"
							:class="[
								compact ? 'quick-command-row--compact' : '',
								selectedId === command.id ? 'bg-primary/20 font-medium' : '',
							]"
							@click="run(command)"
							@contextmenu.prevent="openContext($event, command)"
						>
							<div class="flex items-center gap-2 min-w-0 flex-1">
								<span
									class="quick-command-display-text truncate text-xs font-medium text-foreground group-hover:text-foreground"
									:title="displayText(command)"
								>
									{{ displayText(command) }}
								</span>
							</div>
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-secondary/40 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:bg-primary/10 transition-all text-[9px]"
								:title="t('quickCommands.form.execute')"
							>
								<i class="fas fa-play" aria-hidden="true"></i>
							</span>
						</li>
					</ul>
				</section>
			</template>

			<!-- 扁平列表（未分组视图） -->
			<div v-else class="overflow-hidden rounded-xl border border-border/60 bg-card/25 shadow-2xs">
				<ul class="m-0 list-none p-1.5 space-y-1">
					<li
						v-for="command in flat"
						:key="command.id"
						:data-command-id="command.id"
						class="quick-command-row group flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg transition-all duration-150 hover:bg-primary/10 active:bg-primary/15"
						:class="[
							compact ? 'quick-command-row--compact' : '',
							selectedId === command.id ? 'bg-primary/20 font-medium' : '',
						]"
						@click="run(command)"
						@contextmenu.prevent="openContext($event, command)"
					>
						<div class="flex items-center gap-2 min-w-0 flex-1">
							<span
								class="quick-command-display-text truncate text-xs font-medium text-foreground group-hover:text-foreground"
								:title="displayText(command)"
							>
								{{ displayText(command) }}
							</span>
						</div>
						<span
							class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-secondary/40 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:bg-primary/10 transition-all text-[9px]"
							:title="t('quickCommands.form.execute')"
						>
							<i class="fas fa-play" aria-hidden="true"></i>
						</span>
					</li>
				</ul>
			</div>
		</div>

		<UiContextMenu
			v-if="context"
			:visible="true"
			:x="context.x"
			:y="context.y"
			:width="200"
			@close="context = null"
		>
			<UiContextMenuItem @click="copy(context.command)">
				<i class="fas fa-copy" aria-hidden="true"></i><span>{{ t('quickCommands.actions.copy') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem @click="run(context.command)">
				<i class="fas fa-play" aria-hidden="true"></i><span>{{ t('quickCommands.form.execute') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem
				@click="
					edit(context.command);
					context = null;
				"
			>
				<i class="fas fa-edit" aria-hidden="true"></i><span>{{ t('common.edit') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem tone="danger" @click="remove(context.command)">
				<i class="fas fa-trash-alt" aria-hidden="true"></i><span>{{ t('common.delete') }}</span>
			</UiContextMenuItem>
			<div class="my-1 border-t border-border" role="separator"></div>
			<UiContextMenuItem @click="run(context.command, true)">
				<i class="fas fa-paper-plane" aria-hidden="true"></i
				><span>{{ t('quickCommands.actions.sendToAllSessions') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>

		<UiContextMenu
			v-if="tagContext"
			:visible="true"
			:x="tagContext.x"
			:y="tagContext.y"
			:width="200"
			@close="tagContext = null"
		>
			<UiContextMenuItem
				v-if="tagContext.tag"
				tone="danger"
				:disabled="deletingTag"
				@click="removeTag(tagContext.tag, 'tag')"
			>
				<i class="fas fa-trash-alt" aria-hidden="true"></i><span>{{ t('quickCommands.tags.delete') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem tone="danger" :disabled="deletingTag" @click="removeTag(tagContext.tag, 'group')">
				<i class="fas fa-trash-alt" aria-hidden="true"></i
				><span>{{
					t(tagContext.tag ? 'quickCommands.tags.deleteGroup' : 'quickCommands.tags.deleteUntaggedGroup')
				}}</span>
			</UiContextMenuItem>
			<UiContextMenuItem
				v-if="tagContext.tag"
				:disabled="deletingTag"
				@click="startTagEdit({ id: tagContext.tag.id, name: tagContext.tag.name })"
			>
				<i class="fas fa-edit" aria-hidden="true"></i><span>{{ t('quickCommands.tags.renameHint') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>

		<QuickCommandForm
			:visible="visible"
			:command="editing"
			:tags="tags"
			@close="visible = false"
			@save="save"
			@execute="executeDraft"
		/>
	</section>
</template>

<style scoped>
	.quick-commands-root {
		container-type: size;
		container-name: quick-commands-pane;
		min-width: 0;
	}
	.quick-commands-controls {
		justify-content: space-between;
		flex-wrap: wrap;
		column-gap: 0.5rem;
		row-gap: 0.25rem;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 38%, transparent);
		background: transparent;
	}
	.quick-commands-controls,
	.quick-command-list-area,
	.quick-command-row {
		min-width: 0;
	}
	.quick-command-group-toggle {
		width: 14px;
		min-width: 14px;
		height: 18px;
		padding: 0;
		line-height: 1;
	}
	.quick-command-group-name {
		font-family: var(--font-family-sans-serif);
		height: 20px;
		padding: 0;
		line-height: 20px;
		vertical-align: middle;
	}
	.quick-command-group-badge {
		line-height: 1;
	}
	.quick-command-group-header {
		min-width: 0;
		min-height: calc(var(--quick-row-scale) * 2.125rem);
		line-height: 1.25;
	}
	.quick-command-group-header--compact {
		min-height: calc(var(--quick-row-scale) * 1.75rem);
		padding-block: calc(var(--quick-row-scale) * 0.1875rem);
	}
	.quick-command-row {
		min-height: var(--quick-row-min-height);
		padding-block: var(--quick-row-padding-block);
		padding-inline: var(--quick-row-padding-inline);
	}
	.quick-command-row--compact {
		min-height: var(--quick-row-compact-min-height);
		padding-block: var(--quick-row-compact-padding-block);
	}
	.quick-command-display-text {
		min-width: 0;
	}
	.quick-command-list-area {
		padding-top: 0.625rem;
	}
	.quick-commands-search {
		--ui-control-radius: 0.45rem;
	}
	@container quick-commands-pane (max-width: 340px) {
		.quick-commands-controls {
			gap: 0.25rem;
			padding: 0.35rem 0.4rem;
		}
		.quick-commands-search {
			--ui-control-font-size: 0.75rem;
		}
		.quick-command-list-area {
			padding: 0.625rem 0.35rem 0.35rem;
		}
		.quick-command-group-header {
			min-height: 2.125rem;
			align-items: center;
			padding: 0.25rem 0.5rem;
		}
		.quick-command-row {
			padding-inline: 0.45rem;
		}
	}
	@container quick-commands-pane (max-width: 260px) {
		.quick-commands-controls {
			flex-wrap: wrap;
			justify-content: space-between;
		}
		.quick-commands-search {
			flex: 1 1 100%;
			width: 100%;
		}
		.quick-command-row {
			flex-wrap: nowrap;
			align-items: center;
		}
	}
	@container quick-commands-pane (max-height: 220px) {
		.quick-commands-controls {
			padding-block: 0.2rem;
		}
	}
	@container quick-commands-pane (max-height: 140px) {
		.quick-commands-controls {
			border-bottom-color: transparent;
		}
	}
	.quick-control {
		display: flex;
		width: 1.75rem;
		height: 1.75rem;
		min-width: 1.75rem;
		min-height: 1.75rem;
		flex: 0 0 1.75rem;
		padding: 0;
		margin: 0;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 0.4rem;
		background: transparent;
		color: var(--text-color-secondary);
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
		cursor: pointer;
	}
	.quick-control i {
		font-size: 0.75rem;
		line-height: 1;
	}
	.quick-control:hover {
		background: color-mix(in srgb, var(--text-color) 7%, transparent);
		color: var(--text-color);
	}
	.quick-control--primary {
		color: var(--text-color-secondary);
	}
	.quick-control--primary i {
		color: currentColor !important;
	}
	.quick-control--primary:hover {
		background: color-mix(in srgb, var(--primary-color) 12%, transparent);
		color: var(--text-color);
	}
	.quick-control--active {
		background: color-mix(in srgb, var(--primary-color) 14%, transparent);
		color: var(--primary-color);
	}
</style>
