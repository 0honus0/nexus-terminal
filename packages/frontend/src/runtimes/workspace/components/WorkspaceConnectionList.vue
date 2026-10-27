<script setup lang="ts">
	import { isNetworkFailure } from '@/client/http/network-failure';
	import {
		computed,
		defineAsyncComponent,
		nextTick,
		onBeforeUnmount,
		onDeactivated,
		onMounted,
		ref,
		watch,
	} from 'vue';
	import { useAuthSession } from '@/features/auth/public';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiContextMenu,
		UiContextMenuItem,
		UiEmptyState,
		UiLoadingState,
		UiSearchInput,
	} from '@/foundation/ui';
	import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
	import {
		loadConnectionEditorModal,
		useConnectionManagement,
		type ConnectionSummary,
	} from '@/features/connections/public';
	import { useConnectionTags, type TagSummary } from '@/features/tags/public';
	import { targetErrorKey } from '@/client/targets/target-types';
	import { useFeedback } from '@/shared/feedback/public';
	import WorkspaceTagGroupManager from './WorkspaceTagGroupManager.vue';
	import { focusRegistry } from '@/shared/focus/public';

	const ConnectionEditorModal = defineAsyncComponent(loadConnectionEditorModal);
	const props = withDefaults(
		defineProps<{
			showTags?: boolean;
			activeConnectionId?: number | null;
			pageScroll?: boolean;
			launchpad?: boolean;
		}>(),
		{
			showTags: true,
			activeConnectionId: null,
			launchpad: false,
		},
	);
	const emit = defineEmits<{ open: [connection: ConnectionSummary]; openMany: [connections: ConnectionSummary[]] }>();
	const { t, locale } = useI18n();
	const feedback = useFeedback();
	const management = useConnectionManagement();
	const data = management.data;
	const tags = useConnectionTags();
	const root = ref<HTMLElement | null>(null);
	const search = ref('');
	const highlightedId = ref<number | null>(null);
	const managerTag = ref<TagSummary | null>(null);
	const editorVisible = ref(false);
	const editorConnection = ref<ConnectionSummary | null>(null);
	const context = ref<{ connection: ConnectionSummary; x: number; y: number } | null>(null);
	type ConnectionGroup = { key: string; tagId: number | null; name: string; connections: ConnectionSummary[] };
	const groupContext = ref<{ group: ConnectionGroup; x: number; y: number } | null>(null);
	const expandedGroupsStorage = {
		namespace: 'workspace.connection-groups',
		version: 1,
		codec: jsonStorageCodec<Record<string, boolean>>((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
			const result = new Map<string, boolean>();
			for (const [key, expanded] of Object.entries(value)) {
				if (typeof expanded !== 'boolean') {
					return undefined;
				}
				result.set(key, expanded);
			}
			return Object.fromEntries(result);
		}),
		legacyKeys: ['nexus.workspace.connectionGroups'],
	} as const;
	const expanded = ref<Record<string, boolean>>(readStoredValue(expandedGroupsStorage) ?? {});
	let unregisterFocus: (() => void) | undefined;
	const loading = ref(true);
	const loadError = ref('');
	const tagLoadFailed = ref(false);
	let loadFailureCause: unknown;
	watch([loadError, tagLoadFailed, loading], () => {
		if (loading.value || isNetworkFailure(loadFailureCause)) return;
		const message = loadError.value || (tagLoadFailed.value ? t('workspaceConnectionList.tagLoadFailed') : '');
		if (!message) return;
		feedback.notifyError(message, 0, {
			key: 'workspace-connections',
			label: t('common.refresh'),

			disabled: () => loading.value || !root.value?.isConnected,

			onClick: () => {
				if (root.value?.isConnected) void load(true);
			},
		});
	});
	const auth = useAuthSession();
	let loadGeneration = 0;

	function resetPanels(): void {
		loadGeneration++;
		loading.value = false;
		loadError.value = '';
		tagLoadFailed.value = false;
		editorVisible.value = false;
		editorConnection.value = null;
		managerTag.value = null;
		context.value = null;
		groupContext.value = null;
	}

	const load = async (force = false): Promise<void> => {
		const current = ++loadGeneration;
		loading.value = true;
		loadFailureCause = undefined;
		loadError.value = '';
		tagLoadFailed.value = false;
		try {
			await data.load(force);
		} catch (cause) {
			if (current === loadGeneration) {
				loadFailureCause = cause;
				loadError.value = t('connections.failures.' + targetErrorKey(cause, 'read'));
			}
			return;
		} finally {
			if (current === loadGeneration) {
				loading.value = false;
			}
		}
		if (current === loadGeneration && props.showTags) {
			try {
				await tags.load();
			} catch (cause) {
				if (current === loadGeneration) {
					tagLoadFailed.value = true;
					loadFailureCause = cause;
				}
			}
		}
	};

	onMounted(() => {
		unregisterFocus = focusRegistry.register(
			'connectionListSearch',
			() => {
				root.value?.querySelector<HTMLInputElement>('[data-focus-id="connectionListSearch"]')?.focus();
				return true;
			},
			() => Boolean(root.value?.getClientRects().length),
		);
		void load();
	});
	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), resetPanels, { flush: 'sync' });
	onDeactivated(resetPanels);
	onBeforeUnmount(() => {
		resetPanels();
		unregisterFocus?.();
	});
	watch(
		() => props.showTags,
		(value) => {
			if (value) {
				void load();
			}
		},
	);
	const tagMap = computed(() => new Map(tags.tags.value.map((tag) => [tag.id, tag.name])));
	const searchableConnections = computed(() =>
		data.connections.value.map((connection) => ({
			connection,
			text: `${connection.name ?? ''} ${connection.host} ${connection.username} ${connection.tagIds.map((id) => tagMap.value.get(id) ?? '').join(' ')}`.toLowerCase(),
		})),
	);
	const filtered = computed(() => {
		const q = search.value.trim().toLowerCase();
		return searchableConnections.value
			.filter(({ text }) => !q || text.includes(q))
			.map(({ connection }) => connection);
	});
	const groups = computed(() => {
		const result = new Map<number, ConnectionSummary[]>();
		const untagged: ConnectionSummary[] = [];
		for (const connection of filtered.value) {
			const ids = connection.tagIds.filter((id) => tagMap.value.has(id));
			if (!ids.length) untagged.push(connection);
			else {
				for (const id of ids) {
					const group = result.get(id) ?? [];
					group.push(connection);
					result.set(id, group);
				}
			}
		}
		const tagged: Array<{ key: string; tagId: number | null; name: string; connections: ConnectionSummary[] }> = [
			...result.entries(),
		].map(([tagId, connections]) => ({
			key: String(tagId),
			tagId,
			name: tagMap.value.get(tagId) ?? String(tagId),
			connections,
		}));
		if (untagged.length)
			tagged.push({
				key: 'untagged',
				tagId: null,
				name: t('workspaceConnectionList.untagged'),
				connections: untagged,
			});
		return tagged;
	});

	const isExpanded = (key: string) => expanded.value[key] !== false;

	const visibleConnections = computed(() => {
		const source = props.showTags
			? groups.value.flatMap((group) => (props.launchpad || isExpanded(group.key) ? group.connections : []))
			: filtered.value;
		const seen = new Set<number>();
		return source.filter((connection) => {
			if (seen.has(connection.id)) return false;
			seen.add(connection.id);
			return true;
		});
	});

	const scrollHighlightedIntoView = async () => {
		await nextTick();
		if (highlightedId.value === null) return;
		root.value
			?.querySelector<HTMLElement>(`[data-connection-id="${highlightedId.value}"]`)
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	};

	const moveHighlight = (delta: 1 | -1) => {
		const list = visibleConnections.value;
		if (!list.length) return;
		const current =
			highlightedId.value === null ? -1 : list.findIndex((connection) => connection.id === highlightedId.value);
		const next = current < 0 ? (delta > 0 ? 0 : list.length - 1) : (current + delta + list.length) % list.length;
		highlightedId.value = list[next]?.id ?? null;
		void scrollHighlightedIntoView();
	};

	const handleSearchKeydown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
			return;
		}
		if (event.key === 'Enter' && highlightedId.value !== null) {
			const connection = visibleConnections.value.find((item) => item.id === highlightedId.value);
			if (connection) {
				event.preventDefault();
				emit('open', connection);
			}
			return;
		}
		if (event.key === 'Escape') highlightedId.value = null;
	};

	watch(search, () => {
		highlightedId.value = null;
	});
	watch(visibleConnections, (list) => {
		if (highlightedId.value !== null && !list.some((connection) => connection.id === highlightedId.value))
			highlightedId.value = null;
	});

	const toggleGroup = (key: string) => {
		if (props.launchpad) return;
		expanded.value = { ...expanded.value, [key]: !isExpanded(key) };
		writeStoredValue(expandedGroupsStorage, expanded.value);
	};

	const relativeTimeFormatter = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }));

	const formatLastConnected = (timestamp: number | null): string => {
		if (!timestamp) return '';
		try {
			const seconds = (timestamp - Date.now()) / 1000;
			const absoluteSeconds = Math.abs(seconds);
			const [scale, unit]: [number, Intl.RelativeTimeFormatUnit] =
				absoluteSeconds < 60
					? [1, 'second']
					: absoluteSeconds < 3600
						? [60, 'minute']
						: absoluteSeconds < 86400
							? [3600, 'hour']
							: absoluteSeconds < 604800
								? [86400, 'day']
								: absoluteSeconds < 2629800
									? [604800, 'week']
									: absoluteSeconds < 31557600
										? [2629800, 'month']
										: [31557600, 'year'];
			return relativeTimeFormatter.value.format(Math.round(seconds / scale), unit);
		} catch {
			return '';
		}
	};

	const openFromKeyboard = (event: KeyboardEvent, connection: ConnectionSummary) => {
		if (!props.launchpad) return;
		event.preventDefault();
		emit('open', connection);
	};

	const connectGroup = (connections: ConnectionSummary[]) => {
		const ssh = connections.filter((connection) => connection.type === 'SSH');
		if (ssh.length) emit('openMany', ssh);
	};

	const manageGroup = (tagId: number | null) => {
		if (tagId === null) return;
		if (!data.loaded.value || tags.needsRefresh.value) {
			feedback.notifyError(t('tags.reopenToRefresh'));
			return;
		}
		managerTag.value = tags.tags.value.find((tag) => tag.id === tagId) ?? null;
	};

	const addConnection = () => {
		editorConnection.value = null;
		editorVisible.value = true;
	};

	const editConnection = (connection: ConnectionSummary) => {
		context.value = null;
		editorConnection.value = connection;
		editorVisible.value = true;
	};

	const cloneConnection = (connection: ConnectionSummary) => {
		context.value = null;
		return management.clone(connection);
	};

	const deleteConnection = (connection: ConnectionSummary) => {
		context.value = null;
		return management.remove(connection);
	};

	const openContext = (event: MouseEvent, connection: ConnectionSummary) => {
		groupContext.value = null;
		context.value = { connection, x: event.clientX, y: event.clientY };
	};

	const hasGroupActions = (group: ConnectionGroup): boolean =>
		group.tagId !== null || group.connections.some((connection) => connection.type === 'SSH');

	const openGroupContext = (event: MouseEvent, group: ConnectionGroup) => {
		context.value = null;
		const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
		groupContext.value = {
			group,
			x: rect?.right ?? event.clientX,
			y: (rect?.bottom ?? event.clientY) + 4,
		};
	};

	const connectGroupFromMenu = () => {
		const group = groupContext.value?.group;
		groupContext.value = null;
		if (group) connectGroup(group.connections);
	};

	const manageGroupFromMenu = () => {
		const group = groupContext.value?.group;
		groupContext.value = null;
		if (group) manageGroup(group.tagId);
	};

	const deleteGroupFromMenu = () => {
		const group = groupContext.value?.group;
		groupContext.value = null;
		if (group) void deleteGroupConnections(group);
	};

	const deleteGroupConnections = (group: { tagId: number | null; name: string; connections: ConnectionSummary[] }) =>
		group.tagId === null || !group.connections.length
			? Promise.resolve()
			: management.removeMany(
					group.connections,
					t('workspaceConnectionList.confirmDeleteAllConnectionsInGroup', {
						count: group.connections.length,
						groupName: group.name,
					}),
				);
</script>
<template>
	<section
		ref="root"
		class="workspace-connection-list flex min-h-0 flex-col text-foreground"
		:class="[
			props.pageScroll ? 'workspace-connection-list--page' : 'h-full overflow-hidden',
			props.launchpad ? 'workspace-connection-list--launchpad' : '',
		]"
	>
		<div class="workspace-connection-toolbar flex items-center gap-2" :class="props.pageScroll ? 'mb-3' : 'p-2'">
			<UiSearchInput
				v-model="search"
				data-focus-id="connectionListSearch"
				:aria-label="t('common.search')"
				:placeholder="t('workspaceConnectionList.searchPlaceholder')"
				:clear-label="t('common.clear')"
				class="workspace-connection-search min-w-0 flex-1"
				@keydown="handleSearchKeydown"
			/>
			<UiButton
				type="button"
				appearance="solid"
				tone="primary"
				:icon-only="!props.launchpad"
				class="workspace-connection-add shrink-0"
				:title="t('connections.addConnection')"
				:aria-label="t('connections.addConnection')"
				@click="addConnection"
			>
				<i class="fas fa-plus" aria-hidden="true"></i>
				<span v-if="props.launchpad" class="workspace-connection-add-label">{{
					t('connections.addConnection')
				}}</span>
			</UiButton>
		</div>

		<UiLoadingState
			v-if="loading"
			class="workspace-connection-loading"
			:class="props.launchpad ? 'workspace-connection-loading--launchpad' : 'h-full'"
			:compact="props.launchpad"
			:dense="!props.launchpad"
			:bordered="false"
			:title="t('common.loading')"
		/>

		<div
			v-else
			class="workspace-connection-content min-h-0"
			:class="props.pageScroll ? '' : 'flex-1 overflow-y-auto p-2'"
		>
			<UiEmptyState
				v-if="data.connections.value.length && !filtered.length && search"
				class="workspace-connection-empty"
				dense
				icon="fas fa-search"
				:title="t('workspaceConnectionList.noResults', { searchTerm: search })"
				:bordered="false"
			>
				<template v-if="props.launchpad" #action>
					<UiButton appearance="ghost" density="compact" @click="search = ''">
						{{ t('common.clear') }}
					</UiButton>
				</template>
			</UiEmptyState>
			<UiEmptyState
				v-else-if="!data.connections.value.length && !loadError"
				class="workspace-connection-empty"
				icon="fas fa-plug"
				:title="t('connections.noConnections')"
				:bordered="false"
			>
				<template #action>
					<UiButton type="button" appearance="solid" tone="primary" density="compact" @click="addConnection">
						{{ t('connections.addFirstConnection') }}
					</UiButton>
				</template>
			</UiEmptyState>

			<template v-else-if="showTags">
				<section v-for="group in groups" :key="group.key" class="workspace-connection-section mb-1 last:mb-0">
					<header
						v-if="!props.launchpad || groups.length > 1 || group.tagId !== null"
						class="workspace-connection-group group flex items-center rounded-lg px-3 py-2 font-semibold text-foreground transition-colors duration-150"
						:class="{
							'cursor-pointer': !props.launchpad,
							'workspace-connection-group--static': props.launchpad,
						}"
						@click="toggleGroup(group.key)"
					>
						<i
							v-if="!props.launchpad"
							:class="['fas', isExpanded(group.key) ? 'fa-chevron-down' : 'fa-chevron-right']"
							class="mr-2 w-4 shrink-0 cursor-pointer text-center text-text-secondary transition-transform duration-200 ease-in-out group-hover:text-foreground"
							aria-hidden="true"
						></i>
						<span
							class="workspace-connection-group-name inline-block min-w-0 truncate text-sm"
							:title="group.name"
							>{{ group.name }}</span
						>
						<span class="ml-1 text-xs font-normal text-text-secondary"
							>({{ group.connections.length }})</span
						>
						<div class="min-w-0 flex-1"></div>
						<div class="workspace-connection-group-actions flex items-center">
							<UiButton
								v-if="group.connections.some((connection) => connection.type === 'SSH')"
								type="button"
								appearance="ghost"
								density="compact"
								icon-only
								class="workspace-connection-group-action workspace-connection-group-action--direct ml-1 shrink-0"
								:title="t('workspaceConnectionList.connectAllSshInGroupMenu')"
								:aria-label="t('workspaceConnectionList.connectAllSshInGroupMenu')"
								@click.stop="connectGroup(group.connections)"
							>
								<i class="fas fa-network-wired fa-xs" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								v-if="group.tagId !== null"
								type="button"
								appearance="ghost"
								density="compact"
								icon-only
								class="workspace-connection-group-action workspace-connection-group-action--direct ml-1 shrink-0"
								:title="t('workspaceConnectionList.manageTags.menuItem')"
								:aria-label="t('workspaceConnectionList.manageTags.menuItem')"
								@click.stop="manageGroup(group.tagId)"
							>
								<i class="fas fa-pen fa-xs" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								v-if="group.tagId !== null && group.connections.length"
								type="button"
								appearance="ghost"
								tone="danger"
								density="compact"
								icon-only
								class="workspace-connection-group-action workspace-connection-group-action--direct ml-1 shrink-0"
								:title="t('workspaceConnectionList.deleteAllConnectionsInGroupMenu')"
								:aria-label="t('workspaceConnectionList.deleteAllConnectionsInGroupMenu')"
								@click.stop="deleteGroupConnections(group)"
							>
								<i class="fas fa-trash-alt fa-xs" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								v-if="hasGroupActions(group)"
								type="button"
								appearance="ghost"
								density="compact"
								icon-only
								class="workspace-connection-group-action workspace-connection-group-more ml-1 shrink-0"
								:title="t('workspaceConnectionList.groupActions')"
								:aria-label="t('workspaceConnectionList.groupActions')"
								@click.stop="openGroupContext($event, group)"
							>
								<i class="fas fa-ellipsis-vertical fa-xs" aria-hidden="true"></i>
							</UiButton>
						</div>
					</header>

					<ul
						v-show="props.launchpad || isExpanded(group.key)"
						class="workspace-connection-group-items m-0 list-none p-0"
					>
						<li
							v-for="connection in group.connections"
							:key="connection.id"
							:data-connection-id="connection.id"
							:role="props.launchpad ? 'button' : undefined"
							:tabindex="props.launchpad ? 0 : undefined"
							:aria-label="
								props.launchpad
									? `${connection.name || connection.host}, ${connection.username}@${connection.host}:${connection.port}`
									: undefined
							"
							class="workspace-connection-item group my-0.5 flex cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-lg px-3 py-2 text-ellipsis text-foreground transition-colors duration-150"
							:class="{
								'bg-primary/20 font-medium': connection.id === props.activeConnectionId,
								'ring-1 ring-inset ring-primary/40': connection.id === highlightedId,
								'workspace-connection-item--launchpad': props.launchpad,
							}"
							@click.left="emit('open', connection)"
							@contextmenu.prevent="openContext($event, connection)"
							@keydown.enter="openFromKeyboard($event, connection)"
							@keydown.space="openFromKeyboard($event, connection)"
						>
							<span class="workspace-connection-icon" aria-hidden="true">
								<i
									:class="[
										'fas',
										connection.type === 'RDP'
											? 'fa-desktop'
											: connection.type === 'VNC'
												? 'fa-chalkboard'
												: 'fa-server',
									]"
								></i>
							</span>
							<span class="workspace-connection-copy min-w-0 flex-1">
								<span
									class="workspace-connection-name truncate"
									:title="connection.name || connection.host"
								>
									{{ connection.name || connection.host }}
								</span>
								<span class="workspace-connection-subline">
									<span class="workspace-connection-host truncate">
										{{ connection.username }}@{{ connection.host }}:{{ connection.port }}
									</span>
									<span v-if="connection.lastConnectedAt" class="workspace-connection-time">
										· {{ formatLastConnected(connection.lastConnectedAt) }}
									</span>
								</span>
							</span>
							<span v-if="props.launchpad" class="workspace-connection-meta">
								<span class="workspace-connection-type">{{ connection.type }}</span>
							</span>
						</li>
					</ul>
				</section>
			</template>

			<ul v-else class="workspace-connection-grid m-0 list-none p-0">
				<li
					v-for="connection in filtered"
					:key="connection.id"
					:data-connection-id="connection.id"
					:role="props.launchpad ? 'button' : undefined"
					:tabindex="props.launchpad ? 0 : undefined"
					:aria-label="
						props.launchpad
							? `${connection.name || connection.host}, ${connection.username}@${connection.host}:${connection.port}`
							: undefined
					"
					class="workspace-connection-item group my-0.5 flex cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-lg py-2 pl-4 pr-3 text-ellipsis text-foreground transition-colors duration-150"
					:class="{
						'bg-primary/20 font-medium': connection.id === props.activeConnectionId,
						'ring-1 ring-inset ring-primary/40': connection.id === highlightedId,
						'workspace-connection-item--launchpad': props.launchpad,
					}"
					@click.left="emit('open', connection)"
					@contextmenu.prevent="openContext($event, connection)"
					@keydown.enter="openFromKeyboard($event, connection)"
					@keydown.space="openFromKeyboard($event, connection)"
				>
					<span class="workspace-connection-icon" aria-hidden="true">
						<i
							:class="[
								'fas',
								connection.type === 'RDP'
									? 'fa-desktop'
									: connection.type === 'VNC'
										? 'fa-chalkboard'
										: 'fa-server',
							]"
						></i>
					</span>
					<span class="workspace-connection-copy min-w-0 flex-1">
						<span class="workspace-connection-name truncate" :title="connection.name || connection.host">
							{{ connection.name || connection.host }}
						</span>
						<span class="workspace-connection-subline">
							<span class="workspace-connection-host truncate">
								{{ connection.username }}@{{ connection.host }}:{{ connection.port }}
							</span>
							<span v-if="connection.lastConnectedAt" class="workspace-connection-time">
								· {{ formatLastConnected(connection.lastConnectedAt) }}
							</span>
						</span>
					</span>
					<span v-if="props.launchpad" class="workspace-connection-meta">
						<span class="workspace-connection-type">{{ connection.type }}</span>
					</span>
				</li>
			</ul>
		</div>

		<UiContextMenu
			v-if="groupContext"
			:visible="true"
			:x="groupContext.x"
			:y="groupContext.y"
			:width="190"
			@close="groupContext = null"
		>
			<UiContextMenuItem
				v-if="groupContext.group.connections.some((connection) => connection.type === 'SSH')"
				@click="connectGroupFromMenu"
			>
				<i class="fas fa-network-wired" aria-hidden="true"></i>
				<span>{{ t('workspaceConnectionList.connectAllSshInGroupMenu') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem v-if="groupContext.group.tagId !== null" @click="manageGroupFromMenu">
				<i class="fas fa-pen" aria-hidden="true"></i>
				<span>{{ t('workspaceConnectionList.manageTags.menuItem') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem
				v-if="groupContext.group.tagId !== null && groupContext.group.connections.length"
				tone="danger"
				@click="deleteGroupFromMenu"
			>
				<i class="fas fa-trash-alt" aria-hidden="true"></i>
				<span>{{ t('workspaceConnectionList.deleteAllConnectionsInGroupMenu') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>

		<UiContextMenu
			v-if="context"
			:visible="true"
			:x="context.x"
			:y="context.y"
			:width="190"
			@close="context = null"
		>
			<UiContextMenuItem @click="addConnection">
				<i class="fas fa-plus" aria-hidden="true"></i><span>{{ t('connections.addConnection') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem @click="editConnection(context.connection)">
				<i class="fas fa-edit" aria-hidden="true"></i><span>{{ t('connections.actions.edit') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem @click="cloneConnection(context.connection)">
				<i class="fas fa-clone" aria-hidden="true"></i><span>{{ t('connections.actions.clone') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem tone="danger" @click="deleteConnection(context.connection)">
				<i class="fas fa-trash-alt" aria-hidden="true"></i><span>{{ t('connections.actions.delete') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>

		<ConnectionEditorModal
			v-if="editorVisible"
			:visible="true"
			:connection="editorConnection"
			@close="
				editorVisible = false;
				editorConnection = null;
			"
		/>
		<WorkspaceTagGroupManager
			:visible="Boolean(managerTag)"
			:tag="managerTag"
			:connections="data.connections.value"
			@close="managerTag = null"
			@changed="load"
		/>
	</section>
</template>

<style scoped>
	.workspace-connection-list {
		container-type: inline-size;
		container-name: workspace-connection-pane;
		background: var(--app-bg-color);
	}
	.workspace-connection-content {
		background: var(--app-bg-color);
	}
	.workspace-connection-icon {
		display: grid;
		width: 1.25rem;
		flex-shrink: 0;
		place-items: center;
		margin-right: 0.625rem;
		color: var(--text-color-secondary);
		font-size: 0.8125rem;
		transition: color 0.15s ease;
	}
	.workspace-connection-copy {
		display: flex;
		flex-direction: column;
	}
	.workspace-connection-name {
		display: block;
		font-size: 0.875rem;
		line-height: 1.35;
	}
	.workspace-connection-item:hover .workspace-connection-icon {
		color: var(--link-active-color);
	}
	.workspace-connection-group .workspace-connection-group-action {
		width: 2rem;
		height: 2rem;
	}
	.workspace-connection-group-more {
		display: none;
	}
	.workspace-connection-group:hover {
		background: color-mix(in srgb, var(--text-color) 9%, var(--app-bg-color));
	}
	.workspace-connection-group {
		border-radius: 0.4rem;
		background: color-mix(in srgb, var(--text-color) 3%, transparent);
		box-shadow: none;
	}
	.workspace-connection-item:hover {
		background: color-mix(in srgb, var(--link-active-color) 9%, var(--app-bg-color));
	}
	@container workspace-connection-pane (max-width: 240px) {
		.workspace-connection-group {
			padding-inline: 0.45rem;
		}
		.workspace-connection-group-actions {
			opacity: 0.7;
		}
	}
	.workspace-connection-item.bg-primary\/20 {
		background: color-mix(in srgb, var(--link-active-color) 16%, var(--app-bg-color));
	}

	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-toolbar {
		gap: 0.35rem;
		padding: 0.5rem 0.5rem 0.35rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-search {
		height: 1.9rem;
		min-height: 1.9rem;
		border-color: transparent;
		background: color-mix(in srgb, var(--input-bg-color) 44%, transparent);
		box-shadow: inset 0 1px 1px rgb(0 0 0 / 4%);
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad)
		.workspace-connection-search
		:deep(.ui-input__control) {
		font-size: 0.7rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad)
		.workspace-connection-search
		:deep(.ui-input__adornment) {
		padding-inline: 0.5rem 0.2rem;
		font-size: 0.65rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-add {
		width: 1.9rem;
		height: 1.9rem;
		min-height: 1.9rem;
		border-radius: 0.5rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-content {
		padding: 0.2rem 0.3rem 0.4rem 0.4rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group {
		min-height: 1.85rem;
		padding: 0.18rem 0.4rem;
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--text-color) 3.5%, transparent);
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group-name {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group > i {
		width: 0.75rem;
		margin-right: 0.35rem;
		font-size: 0.58rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group-actions {
		margin-left: 0.25rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group-action {
		width: 1.55rem;
		height: 1.55rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-item {
		min-height: 1.72rem;
		margin-block: 0.08rem;
		padding: 0.25rem 0.4rem;
		border-radius: 0.4rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-icon {
		width: 1.05rem;
		margin-right: 0.42rem;
		font-size: 0.7rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-name {
		font-size: 0.76rem;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-subline {
		display: none;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-empty {
		margin: auto;
		padding: 0.75rem;
		background: transparent;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad)
		.workspace-connection-empty
		:deep(.ui-empty-state__icon) {
		width: 25px;
		height: 25px;
		border: 0;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 10px;
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad)
		.workspace-connection-empty
		:deep(.ui-empty-state__title) {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-color-secondary);
	}
	.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-loading {
		font-size: 0.7rem;
	}
	@container workspace-connection-pane (max-width: 250px) {
		.workspace-connection-list:not(.workspace-connection-list--launchpad)
			.workspace-connection-group-action--direct {
			display: none;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group-more {
			display: inline-flex;
		}
	}
	@container workspace-connection-pane (max-width: 180px) {
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-toolbar {
			padding-inline: 0.35rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad)
			.workspace-connection-search
			:deep(.ui-input__adornment) {
			display: none;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group {
			padding-inline: 0.3rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group-name {
			font-size: 0.68rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group-actions {
			margin-left: 0;
		}
	}
	@container workspace-connection-pane (min-width: 13rem) {
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-toolbar {
			gap: 0.5rem;
			padding: 0.5rem 0.6rem 0.4rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-search {
			height: 2rem;
			min-height: 2rem;
			border-radius: 0.5rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-add {
			width: 2rem;
			height: 2rem;
			min-height: 2rem;
			border-radius: 0.5rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-content {
			padding: 0.25rem 0.4rem 0.5rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group {
			min-height: 2rem;
			padding: 0.25rem 0.5rem;
			border-radius: 0.5rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-group-name {
			font-size: 0.76rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-item {
			min-height: 2.5rem;
			margin-block: 0.1rem;
			padding: 0.35rem 0.5rem;
			border-radius: 0.5rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-icon {
			width: 1.15rem;
			margin-right: 0.5rem;
			font-size: 0.75rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-name {
			font-size: 0.8rem;
			line-height: 1.25;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-subline {
			display: flex;
			margin-top: 0.08rem;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-host,
		.workspace-connection-list:not(.workspace-connection-list--launchpad) .workspace-connection-time {
			font-size: 0.64rem;
			opacity: 0.64;
		}
		.workspace-connection-list:not(.workspace-connection-list--launchpad)
			.workspace-connection-item.bg-primary\/20 {
			box-shadow: inset 2px 0 0 var(--link-active-color);
		}
	}
	.workspace-connection-list--page .workspace-connection-section {
		margin-bottom: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
		border-radius: 0.625rem;
		overflow: hidden;
	}
	.workspace-connection-list--page .workspace-connection-section:last-child {
		margin-bottom: 0;
	}
	.workspace-connection-list--page .workspace-connection-group {
		min-height: 2.25rem;
		padding: 0.25rem 0.625rem;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: var(--text-color-secondary);
		font-weight: 500;
	}
	.workspace-connection-list--page .workspace-connection-group:hover {
		background: color-mix(in srgb, var(--text-color) 3%, var(--app-bg-color));
	}
	.workspace-connection-list--page .workspace-connection-group-name {
		font-size: 0.75rem;
	}
	.workspace-connection-list--page .workspace-connection-group > i {
		width: 0.75rem;
		font-size: 0.625rem;
	}
	.workspace-connection-list--page .workspace-connection-group button {
		width: 1.5rem;
		height: 1.5rem;
	}
	.workspace-connection-list--page .workspace-connection-group-items {
		padding: 0 0.375rem 0.375rem;
	}
	.workspace-connection-list--page .workspace-connection-item {
		margin-block: 0.125rem;
		border-radius: 0.375rem;
	}
	.workspace-connection-list--page .workspace-connection-group-items .workspace-connection-item {
		padding-left: 1.25rem;
	}

	.workspace-connection-list--launchpad {
		container-type: inline-size;
	}

	.workspace-connection-list--launchpad .workspace-connection-toolbar {
		margin-bottom: 1.25rem;
		gap: 0.5rem;
	}

	.workspace-connection-list--launchpad .workspace-connection-search {
		height: 2.5rem;
		min-height: 2.5rem;
		border-radius: 0.625rem;
	}

	.workspace-connection-list--launchpad .workspace-connection-add,
	.workspace-connection-list--launchpad .workspace-connection-toolbar > [data-ui='button'] {
		height: 2.5rem;
		min-height: 2.5rem;
		border-radius: 0.625rem;
	}

	.workspace-connection-list--launchpad .workspace-connection-toolbar > .workspace-connection-add {
		height: 2.5rem;
		padding-inline: 0.75rem;
		border-radius: 0.625rem;
	}

	.workspace-connection-add-label {
		margin-left: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.workspace-connection-loading--launchpad {
		min-height: 12rem;
	}

	.workspace-connection-list--launchpad .workspace-connection-empty {
		padding: 4rem 1rem;
	}

	.workspace-connection-list--launchpad .workspace-connection-empty i {
		color: color-mix(in srgb, var(--text-color-secondary) 65%, transparent);
	}

	.workspace-connection-list--launchpad .workspace-connection-section {
		margin-bottom: 1.75rem;
		border: 0;
		border-radius: 0;
		overflow: visible;
	}

	.workspace-connection-list--launchpad .workspace-connection-section:last-child {
		margin-bottom: 0;
	}

	.workspace-connection-list--launchpad .workspace-connection-group {
		height: 2rem;
		min-height: 2rem;
		margin-bottom: 0.5rem;
		padding: 0 0.125rem;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: var(--text-color-secondary);
		font-weight: 500;
	}

	.workspace-connection-list--launchpad .workspace-connection-group:hover {
		background: transparent;
	}

	.workspace-connection-list--launchpad .workspace-connection-group--static {
		cursor: default;
	}

	.workspace-connection-list--launchpad .workspace-connection-group-name {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.015em;
	}

	.workspace-connection-list--launchpad .workspace-connection-group-actions {
		opacity: 0.5;
		transition: opacity 0.15s ease;
	}

	.workspace-connection-list--launchpad .workspace-connection-group:hover .workspace-connection-group-actions,
	.workspace-connection-list--launchpad .workspace-connection-group:focus-within .workspace-connection-group-actions {
		opacity: 1;
	}

	.workspace-connection-list--launchpad .workspace-connection-group-actions [data-ui='button'] {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
	}

	.workspace-connection-list--launchpad .workspace-connection-group-items,
	.workspace-connection-list--launchpad .workspace-connection-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		padding: 0;
	}

	.workspace-connection-list--launchpad .workspace-connection-item {
		min-width: 0;
		min-height: 4rem;
		margin: 0;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		white-space: normal;
		background: color-mix(in srgb, var(--text-color) 2.5%, transparent);
		transition:
			background-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.workspace-connection-list--launchpad .workspace-connection-item:hover {
		background: color-mix(in srgb, var(--link-active-color) 8%, transparent);
	}

	.workspace-connection-list--launchpad .workspace-connection-item:focus-visible {
		outline: 1px solid var(--link-active-color);
		outline-offset: 1px;
	}

	.workspace-connection-list--launchpad .workspace-connection-item.bg-primary\/20 {
		background: color-mix(in srgb, var(--link-active-color) 11%, transparent);
		box-shadow: inset 2px 0 0 var(--link-active-color);
	}

	.workspace-connection-list--launchpad .workspace-connection-name {
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.35;
	}

	.workspace-connection-subline {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.125rem;
	}

	.workspace-connection-host {
		min-width: 0;
		color: var(--text-color-secondary);
		font-family: var(--font-family-monospace);
		font-size: 0.6875rem;
		line-height: 1.35;
		opacity: 0.78;
	}

	.workspace-connection-meta {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		margin-left: 0.75rem;
		color: var(--text-color-secondary);
	}

	.workspace-connection-type {
		padding: 0.125rem 0.375rem;
		border: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1.4;
	}

	.workspace-connection-time {
		flex-shrink: 0;
		font-size: 0.6875rem;
		white-space: nowrap;
		opacity: 0.72;
	}

	.workspace-connection-list--launchpad .workspace-connection-meta {
		justify-content: flex-end;
	}

	@container (max-width: 44rem) {
		.workspace-connection-list--launchpad .workspace-connection-group-items,
		.workspace-connection-list--launchpad .workspace-connection-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (hover: none) {
		.workspace-connection-list--launchpad .workspace-connection-group-actions {
			opacity: 1;
		}
	}

	@media (max-width: 640px) {
		.workspace-connection-add-label {
			display: none;
		}

		.workspace-connection-list--launchpad .workspace-connection-toolbar > .workspace-connection-add {
			width: 2.5rem;
			height: 2.5rem;
			padding-inline: 0;
		}

		.workspace-connection-list--launchpad .workspace-connection-item {
			min-height: 3.75rem;
		}

		.workspace-connection-list--launchpad .workspace-connection-group-actions [data-ui='button'] {
			width: 2.25rem;
			height: 2.25rem;
		}
	}
</style>
