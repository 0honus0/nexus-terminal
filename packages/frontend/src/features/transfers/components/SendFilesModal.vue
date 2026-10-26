<script setup lang="ts">
	import type { ServerTransferMethod } from '@nexus-terminal/shared/remote/transfers/server-values';
	import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiEmptyState,
		UiLoadingState,
		UiFormActions,
		UiFormField,
		UiInlineNotice,
		UiOverlayPanel,
		UiSearchInput,
		UiSelect,
	} from '@/foundation/ui';
	import { apiErrorMessage } from '@/client/http';
	import { useFeedback } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { loadRemoteDirectoryPicker } from '@/features/filesystem/public';
	import { useRuntimeFeatureCapabilities, type ConnectionSummary } from '@/shared/capabilities/public';
	import { useServerTransfersStore, serverTransferFailureKey } from '../store/serverTransfers.store';
	import type { SendFileSource, ServerTransferTask } from '../model/server-transfer-types';
	import { readServerTransferDirectory, rememberServerTransferDirectory } from '../model/server-transfer-directory';

	const RemoteDirectoryPicker = defineAsyncComponent(loadRemoteDirectoryPicker);

	const props = defineProps<{
		visible: boolean;
		sourceConnectionId: number;
		items: readonly SendFileSource[];
	}>();
	const emit = defineEmits<{ close: []; sent: [task: ServerTransferTask] }>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const capabilities = useRuntimeFeatureCapabilities();
	const connections = capabilities.connections;
	const tags = capabilities.tags;
	const transfers = useServerTransfersStore();
	const search = ref('');
	const selected = ref(new Set<number>());
	const targetPath = ref('');
	const browseTargetId = ref('');
	const pickerOpen = ref(false);
	const method = ref<ServerTransferMethod>('auto');
	const loadingOptions = ref(false);
	const submitting = ref(false);
	const error = ref('');
	const expandedGroups = ref<Record<string, boolean>>({});
	let generation = 0;
	let operation = new AbortController();

	function invalidate(): void {
		generation += 1;
		operation.abort();
		operation = new AbortController();
		submitting.value = false;
		loadingOptions.value = false;
		pickerOpen.value = false;
	}

	useAuthenticatedViewScope({
		available: () => props.visible,

		onRevoke: () => {
			invalidate();
			selected.value = new Set();
			targetPath.value = '';
		},
	});

	interface ConnectionGroup {
		id: string;
		name: string;
		connections: ConnectionSummary[];
	}

	const tagNames = computed(() => new Map(tags.items.value.map((tag) => [tag.id, tag.name])));
	const sshConnections = computed(() =>
		connections.items.value.filter(
			(connection) => connection.type === 'SSH' && connection.id !== props.sourceConnectionId,
		),
	);
	const selectedConnections = computed(() =>
		sshConnections.value.filter((connection) => selected.value.has(connection.id)),
	);
	const browseTarget = computed(() =>
		selectedConnections.value.find((connection) => String(connection.id) === browseTargetId.value),
	);
	const browseTargetKey = computed(() => {
		const target = browseTarget.value;
		return target ? `${target.id}:${target.createdAt}:${target.version}` : '';
	});
	watch(
		selectedConnections,
		(targets) => {
			if (!targets.some((target) => String(target.id) === browseTargetId.value)) {
				browseTargetId.value = targets[0] ? String(targets[0].id) : '';
			}
		},
		{ flush: 'sync' },
	);
	watch(
		[browseTargetKey, capabilities.auth.userId],
		() => {
			pickerOpen.value = false;
			const target = browseTarget.value;
			const userId = capabilities.auth.userId.value;
			targetPath.value = target && userId !== null ? readServerTransferDirectory(userId, target) : '';
		},
		{ flush: 'sync' },
	);

	function selectDirectory(path: string): void {
		const target = browseTarget.value;
		const userId = capabilities.auth.userId.value;
		if (!pickerOpen.value || !props.visible || submitting.value || !target || userId === null) return;
		targetPath.value = path;
		rememberServerTransferDirectory(userId, target, path);
		pickerOpen.value = false;
	}

	const groupedConnections = computed<ConnectionGroup[]>(() => {
		const groups = new Map<number, ConnectionSummary[]>();
		const untagged: ConnectionSummary[] = [];

		for (const connection of sshConnections.value) {
			if (!connection.tagIds.length) {
				untagged.push(connection);
				continue;
			}
			let matchedTag = false;
			for (const tagId of connection.tagIds) {
				if (!tagNames.value.has(tagId)) continue;
				matchedTag = true;
				const items = groups.get(tagId) ?? [];
				if (!items.some((item) => item.id === connection.id)) items.push(connection);
				groups.set(tagId, items);
			}
			if (!matchedTag) untagged.push(connection);
		}

		const result = [...groups.entries()]
			.map(([tagId, items]) => ({
				id: String(tagId),
				name: tagNames.value.get(tagId) ?? String(tagId),
				connections: items,
			}))
			.sort((left, right) => left.name.localeCompare(right.name));
		if (untagged.length)
			result.push({ id: 'untagged', name: t('sendFilesModal.untaggedConnections'), connections: untagged });
		return result;
	});
	const filteredGroups = computed<ConnectionGroup[]>(() => {
		const q = search.value.trim().toLocaleLowerCase();
		if (!q) return groupedConnections.value;
		return groupedConnections.value
			.map((group) => {
				if (group.name.toLocaleLowerCase().includes(q)) return group;
				const matches = group.connections.filter((connection) =>
					(connection.name || connection.host).toLocaleLowerCase().includes(q),
				);
				return matches.length ? { ...group, connections: matches } : null;
			})
			.filter((group): group is ConnectionGroup => Boolean(group));
	});

	const toggle = (id: number) => {
		if (submitting.value) return;
		const next = new Set(selected.value);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected.value = next;
	};

	const isGroupSelected = (group: ConnectionGroup) =>
		Boolean(group.connections.length) && group.connections.every((connection) => selected.value.has(connection.id));

	const isGroupIndeterminate = (group: ConnectionGroup) => {
		const count = group.connections.filter((connection) => selected.value.has(connection.id)).length;
		return count > 0 && count < group.connections.length;
	};

	const toggleGroup = (group: ConnectionGroup) => {
		if (submitting.value) return;
		const next = new Set(selected.value);
		if (isGroupSelected(group)) group.connections.forEach((connection) => next.delete(connection.id));
		else group.connections.forEach((connection) => next.add(connection.id));
		selected.value = next;
	};

	const isGroupExpanded = (group: ConnectionGroup) => expandedGroups.value[group.id] ?? true;

	const toggleGroupExpansion = (group: ConnectionGroup) => {
		expandedGroups.value = {
			...expandedGroups.value,
			[group.id]: !isGroupExpanded(group),
		};
	};

	const selectVisible = () => {
		if (submitting.value) return;
		const ids = filteredGroups.value.flatMap((group) => group.connections.map((connection) => connection.id));
		selected.value = new Set([...selected.value, ...ids]);
	};

	const clear = () => {
		if (!submitting.value) selected.value = new Set();
	};

	const loadOptions = async () => {
		const current = generation;
		loadingOptions.value = true;
		error.value = '';
		try {
			await Promise.all([connections.load(), tags.load()]);
		} catch (cause) {
			if (current === generation && props.visible) {
				error.value = apiErrorMessage(cause, t('sendFilesModal.errorFetchingData'));
			}
		} finally {
			if (current === generation) {
				loadingOptions.value = false;
			}
		}
	};

	watch(
		() => props.visible,
		(visible) => {
			invalidate();
			if (!visible) return;
			search.value = '';
			selected.value = new Set();
			expandedGroups.value = {};
			targetPath.value = '';
			method.value = 'auto';
			void loadOptions();
		},
	);
	onMounted(() => props.visible && void loadOptions());
	watch([() => props.sourceConnectionId, () => props.items], invalidate);

	const submit = async () => {
		if (submitting.value) return;
		error.value = '';
		const path = targetPath.value;
		if (!selectedConnections.value.length || !path || !props.items.length) {
			error.value = t('sendFilesModal.validationError');
			return;
		}
		submitting.value = true;
		const current = generation;
		const signal = operation.signal;
		const command = {
			sourceConnectionId: props.sourceConnectionId,
			connectionIds: selectedConnections.value.map((target) => target.id),
			sourceItems: props.items.map((item) => ({ name: item.name, path: item.path, type: item.type })),
			remoteTargetPath: path,
			transferMethod: method.value,
		};
		try {
			if (
				!(await feedback.confirm({
					message: t('sendFilesModal.credentialTrustWarning'),
					destructive: true,
					signal,
				})) ||
				current !== generation ||
				!props.visible ||
				signal.aborted
			)
				return;
			if (current !== generation || !props.visible || signal.aborted) {
				return;
			}
			const task = await transfers.send(command, signal);
			if (current !== generation || !props.visible || signal.aborted) {
				return;
			}
			feedback.notifySuccess(t('sendFilesModal.transferInitiatedGeneric'));
			emit('sent', task);
			emit('close');
		} catch (cause) {
			if (current === generation && props.visible) {
				error.value = t(serverTransferFailureKey(cause));
			}
		} finally {
			if (current === generation) {
				submitting.value = false;
			}
		}
	};
</script>

<template>
	<UiOverlayPanel
		:visible="visible"
		:z-index="70"
		panel-class="ui-form-surface flex flex-col !w-[calc(100vw-1rem)] !max-w-[60rem] !h-[calc(100dvh-1rem)] !max-h-[calc(100dvh-1rem)] !p-0 overflow-hidden sm:!w-[calc(100vw-2rem)] sm:!h-auto sm:!max-h-[calc(100dvh-2rem)]"
		role="dialog"
		:aria-modal="true"
		:aria-label="t('sendFilesModal.title')"
		focus-on-open
		restore-focus
		close-on-escape
		@close="emit('close')"
	>
		<header class="send-files__header">
			<div class="send-files__heading">
				<span class="send-files__mark" aria-hidden="true">
					<i class="fa-solid fa-paper-plane"></i>
				</span>
				<h2 class="send-files__title">{{ t('sendFilesModal.title') }}</h2>
			</div>
			<UiButton
				type="button"
				appearance="ghost"
				icon-only
				:aria-label="t('common.close')"
				:title="t('common.close')"
				@click="emit('close')"
			>
				<i class="fas fa-times" aria-hidden="true"></i>
			</UiButton>
		</header>

		<div class="send-files__body">
			<section class="send-files__targets" aria-labelledby="send-files-targets-title">
				<header class="send-files__section-head">
					<div class="send-files__section-title">
						<h3 id="send-files-targets-title">
							<i class="fa-solid fa-server" aria-hidden="true"></i>
							{{ t('sendFilesModal.targetsTitle') }}
						</h3>
						<UiBadge appearance="ghost" density="compact"
							>{{ selected.size }}/{{ sshConnections.length }}</UiBadge
						>
					</div>
					<div class="send-files__selection-actions">
						<UiButton
							type="button"
							appearance="ghost"
							density="compact"
							:disabled="submitting || !filteredGroups.length"
							@click="selectVisible"
						>
							<i class="fa-solid fa-check-double" aria-hidden="true"></i>
							{{ t('sendFilesModal.selectAll') }}
						</UiButton>
						<UiButton
							type="button"
							appearance="ghost"
							density="compact"
							:disabled="submitting || selected.size === 0"
							@click="clear"
						>
							<i class="fa-solid fa-xmark" aria-hidden="true"></i>
							{{ t('sendFilesModal.clearSelection') }}
						</UiButton>
					</div>
				</header>

				<UiSearchInput
					v-model="search"
					class="send-files__search"
					:placeholder="t('sendFilesModal.searchConnectionsPlaceholder')"
					:aria-label="t('sendFilesModal.searchConnectionsPlaceholder')"
					:clear-label="t('common.clear')"
				/>

				<div class="send-files__list" :aria-busy="loadingOptions">
					<UiLoadingState
						v-if="loadingOptions"
						class="h-32"
						compact
						:bordered="false"
						:title="t('sendFilesModal.loadingConnections')"
					/>
					<UiEmptyState
						v-else-if="!sshConnections.length"
						class="h-32"
						compact
						:bordered="false"
						icon="fa-solid fa-folder-open"
						:title="t('sendFilesModal.noConnections')"
					/>
					<UiEmptyState
						v-else-if="!filteredGroups.length"
						class="h-32"
						compact
						:bordered="false"
						icon="fa-solid fa-magnifying-glass"
						:title="t('sendFilesModal.noConnectionsFound')"
					/>
					<div v-else class="send-files__groups">
						<section v-for="group in filteredGroups" :key="group.id" class="send-files__group">
							<div class="send-files__group-head">
								<UiCheckbox
									:id="'send-files-group-' + group.id"
									:model-value="isGroupSelected(group)"
									:indeterminate="isGroupIndeterminate(group)"
									:aria-label="group.name"
									@update:model-value="toggleGroup(group)"
									@click.stop
								/>
								<button
									type="button"
									class="send-files__group-toggle"
									:aria-expanded="isGroupExpanded(group)"
									@click="toggleGroupExpansion(group)"
								>
									<i
										class="fa-solid send-files__chevron"
										:class="isGroupExpanded(group) ? 'fa-chevron-down' : 'fa-chevron-right'"
										aria-hidden="true"
									></i>
									<span class="send-files__group-name">{{ group.name }}</span>
									<span class="send-files__group-count">{{ group.connections.length }}</span>
								</button>
							</div>
							<ul v-show="isGroupExpanded(group)" class="send-files__target-list">
								<li
									v-for="connection in group.connections"
									:key="connection.id"
									class="send-files__target"
									:class="{ 'is-selected': selected.has(connection.id) }"
									@click="toggle(connection.id)"
								>
									<UiCheckbox
										:id="'send-files-connection-' + connection.id"
										:model-value="selected.has(connection.id)"
										:aria-label="connection.name || connection.host"
										@update:model-value="toggle(connection.id)"
										@click.stop
									/>
									<span class="send-files__target-icon" aria-hidden="true">
										<i class="fa-solid fa-server"></i>
									</span>
									<span class="send-files__target-copy">
										<span
											class="send-files__target-name"
											:title="connection.name || connection.host"
											>{{ connection.name || connection.host }}</span
										>
										<span class="send-files__target-address"
											>{{ connection.username }}@{{ connection.host }}:{{ connection.port }}</span
										>
									</span>
									<i
										v-if="selected.has(connection.id)"
										class="fa-solid fa-check send-files__target-check"
										aria-hidden="true"
									></i>
								</li>
							</ul>
						</section>
					</div>
				</div>
			</section>

			<aside class="send-files__settings">
				<section class="send-files__setup" aria-labelledby="send-files-settings-title">
					<header class="send-files__section-head send-files__section-head--settings">
						<div class="send-files__section-title">
							<h3 id="send-files-settings-title">
								<i class="fa-solid fa-sliders" aria-hidden="true"></i>
								{{ t('sendFilesModal.settingsTitle') }}
							</h3>
						</div>
					</header>

					<div class="send-files__fields">
						<UiFormField
							v-if="selectedConnections.length > 1"
							:label="t('sendFilesModal.browseServer')"
							for-id="send-files-browse-server"
						>
							<UiSelect
								id="send-files-browse-server"
								v-model="browseTargetId"
								:disabled="submitting"
								class="w-full"
							>
								<option
									v-for="target in selectedConnections"
									:key="target.id"
									:value="String(target.id)"
								>
									{{ target.name || target.host }}
								</option>
							</UiSelect>
						</UiFormField>
						<UiFormField :label="t('sendFilesModal.targetPathLabel')" for-id="send-files-target-path">
							<UiButton
								id="send-files-target-path"
								type="button"
								class="send-files__path-control"
								block
								:disabled="!browseTarget || submitting || transfers.sendBlocked"
								@click="pickerOpen = true"
							>
								<span class="send-files__path-icon" aria-hidden="true">
									<i class="fa-solid fa-folder-open"></i>
								</span>
								<span class="send-files__path-value">{{
									targetPath || t('sendFilesModal.chooseDirectory')
								}}</span>
								<i class="fa-solid fa-chevron-right send-files__path-chevron" aria-hidden="true"></i>
							</UiButton>
						</UiFormField>
						<UiFormField
							:label="t('sendFilesModal.transferMethodLabel')"
							for-id="send-files-transfer-method"
						>
							<UiSelect
								id="send-files-transfer-method"
								v-model="method"
								class="w-full"
								:disabled="submitting"
							>
								<option value="auto">{{ t('sendFilesModal.transferMethodAuto') }}</option>
								<option value="rsync">{{ t('sendFilesModal.methodRsync') }}</option>
								<option value="scp">{{ t('sendFilesModal.methodScp') }}</option>
							</UiSelect>
						</UiFormField>
					</div>
				</section>

				<section class="send-files__items" aria-labelledby="send-files-items-title">
					<header class="send-files__items-head">
						<h3 id="send-files-items-title">
							<i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
							{{ t('sendFilesModal.itemsToSendTitle') }}
						</h3>
						<UiBadge appearance="ghost" density="compact">{{ items.length }}</UiBadge>
					</header>
					<ul v-if="items.length" class="send-files__item-list">
						<li v-for="item in items" :key="item.path" class="send-files__item" :title="item.path">
							<i
								class="send-files__item-icon"
								:class="item.type === 'directory' ? 'fa-solid fa-folder' : 'fa-regular fa-file'"
								aria-hidden="true"
							></i>
							<span class="send-files__item-name">{{ item.name }}</span>
						</li>
					</ul>
					<p v-else class="send-files__empty-items">{{ t('sendFilesModal.noItemsSelected') }}</p>
				</section>

				<div v-if="transfers.sendBlocked || error" class="send-files__notices">
					<UiInlineNotice v-if="transfers.sendBlocked" tone="danger">
						{{ t('serverTransferErrors.operation_unknown') }}
					</UiInlineNotice>
					<UiInlineNotice v-else-if="error" tone="danger">{{ error }}</UiInlineNotice>
				</div>
			</aside>
		</div>

		<footer class="send-files__footer">
			<UiFormActions>
				<UiButton type="button" @click="emit('close')">
					{{ t('sendFilesModal.cancelButton') }}
				</UiButton>
				<UiButton
					type="button"
					appearance="solid"
					tone="primary"
					:disabled="
						submitting ||
						transfers.sendBlocked ||
						!items.length ||
						!selected.size ||
						!targetPath ||
						pickerOpen
					"
					:loading="submitting"
					@click="submit"
				>
					<i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
					{{ t('sendFilesModal.sendButton') }}
				</UiButton>
			</UiFormActions>
		</footer>
	</UiOverlayPanel>
	<RemoteDirectoryPicker
		v-if="pickerOpen && visible && browseTarget"
		:key="browseTargetKey"
		:target-id="browseTarget.id"
		:target-name="browseTarget.name || browseTarget.host"
		:initial-path="targetPath || '/'"
		@close="pickerOpen = false"
		@select="selectDirectory"
	/>
</template>

<style scoped>
	.send-files__header {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 20px;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 32%, transparent);
	}

	.send-files__heading,
	.send-files__section-title,
	.send-files__items-head {
		display: flex;
		min-width: 0;
		align-items: center;
	}

	.send-files__heading {
		gap: 12px;
	}

	.send-files__mark {
		display: inline-flex;
		width: 38px;
		height: 38px;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 12px;
		background: linear-gradient(
			145deg,
			color-mix(in srgb, var(--link-active-color) 20%, transparent),
			color-mix(in srgb, var(--card-bg-color) 30%, transparent)
		);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-rim) 16%, transparent);
		color: var(--link-active-color);
		font-size: 15px;
	}

	.send-files__title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 650;
		letter-spacing: -0.015em;
		line-height: 1.25;
	}

	.send-files__body {
		display: grid;
		min-height: 0;
		flex: 1 1 auto;
		grid-template-columns: minmax(0, 1.15fr) minmax(19rem, 0.85fr);
		overflow: hidden;
	}

	.send-files__targets,
	.send-files__settings {
		min-width: 0;
		min-height: 0;
	}

	.send-files__targets {
		display: flex;
		flex-direction: column;
		padding: 16px 18px 12px 20px;
	}

	.send-files__settings {
		display: flex;
		flex-direction: column;
		gap: 16px;
		overflow-y: auto;
		padding: 16px 20px 18px 18px;
		border-left: 1px solid color-mix(in srgb, var(--border-color) 28%, transparent);
		background: color-mix(in srgb, var(--card-bg-color) 10%, transparent);
		overscroll-behavior: contain;
	}

	.send-files__section-head {
		display: flex;
		min-width: 0;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.send-files__section-title {
		gap: 8px;
	}

	.send-files__section-title h3,
	.send-files__items-head h3 {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
		margin: 0;
		color: var(--text-color);
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.01em;
		line-height: 1.3;
	}

	.send-files__section-title h3 > i,
	.send-files__items-head h3 > i {
		color: var(--link-active-color);
		font-size: 11px;
	}

	.send-files__selection-actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: 2px;
	}

	.send-files__selection-actions :deep(.ui-button) {
		padding-inline: 6px;
		color: var(--text-color-secondary);
		font-size: 10.5px;
	}

	.send-files__selection-actions :deep(.ui-button i) {
		font-size: 9px;
	}

	.send-files__search {
		flex: none;
		margin-top: 12px;
	}

	.send-files__list {
		display: flex;
		min-height: 0;
		flex: 1 1 auto;
		flex-direction: column;
		margin-top: 8px;
		overflow: hidden;
	}

	.send-files__groups {
		min-height: 0;
		flex: 1 1 auto;
		max-height: min(26rem, calc(100dvh - 20rem));
		overflow-y: auto;
		padding-right: 7px;
		scrollbar-gutter: stable;
	}

	.send-files__group + .send-files__group {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 20%, transparent);
	}

	.send-files__group-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 3px 5px;
	}

	.send-files__group-toggle {
		display: flex;
		min-width: 0;
		flex: 1 1 auto;
		align-items: center;
		gap: 7px;
		border: 0;
		padding: 2px 0;
		background: transparent;
		color: var(--text-color-secondary);
		cursor: pointer;
		font: inherit;
		text-align: left;
	}

	.send-files__group-toggle:focus-visible {
		border-radius: 6px;
		outline: 1px solid var(--ui-focus-color);
		outline-offset: 2px;
	}

	.send-files__chevron {
		width: 11px;
		flex: none;
		color: var(--text-color-secondary);
		font-size: 9px;
		text-align: center;
	}

	.send-files__group-name {
		overflow: hidden;
		color: var(--text-color);
		font-size: 11.5px;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.send-files__group-count {
		display: inline-flex;
		min-width: 19px;
		height: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--ui-fill-soft);
		color: var(--text-color-secondary);
		font-size: 9.5px;
		font-variant-numeric: tabular-nums;
	}

	.send-files__target-list {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0 0 2px 22px;
		list-style: none;
	}

	.send-files__target {
		position: relative;
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 10px;
		border-radius: 10px;
		padding: 8px 10px 8px 8px;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.send-files__target:hover {
		background: var(--ui-fill-soft-hover);
	}

	.send-files__target.is-selected {
		background: color-mix(in srgb, var(--link-active-color) 11%, transparent);
	}

	.send-files__target.is-selected::before {
		position: absolute;
		top: 8px;
		bottom: 8px;
		left: 0;
		width: 2px;
		border-radius: 99px;
		background: var(--link-active-color);
		content: '';
	}

	.send-files__target-icon {
		display: inline-flex;
		width: 30px;
		height: 30px;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		background: var(--ui-fill-soft);
		color: color-mix(in srgb, var(--link-active-color) 64%, var(--text-color-secondary));
		font-size: 11px;
	}

	.send-files__target-copy {
		display: flex;
		min-width: 0;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 1px;
	}

	.send-files__target-name,
	.send-files__target-address,
	.send-files__item-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.send-files__target-name {
		color: var(--text-color);
		font-size: 12.5px;
		font-weight: 590;
		line-height: 1.35;
	}

	.send-files__target-address {
		color: var(--text-color-secondary);
		font-family: var(--font-family-monospace);
		font-size: 10px;
		line-height: 1.35;
	}

	.send-files__target-check {
		flex: none;
		color: var(--link-active-color);
		font-size: 10px;
	}

	.send-files__section-head--settings {
		flex: none;
	}

	.send-files__fields {
		display: grid;
		gap: 13px;
		margin-top: 12px;
	}

	.send-files__path-control {
		min-height: 42px;
		justify-content: flex-start;
		gap: 9px;
		padding: 8px 10px;
		text-align: left;
	}

	.send-files__path-icon {
		display: inline-flex;
		width: 25px;
		height: 25px;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 7px;
		background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		color: var(--link-active-color);
		font-size: 10px;
	}

	.send-files__path-value {
		min-width: 0;
		flex: 1 1 auto;
		overflow-wrap: anywhere;
		font-family: var(--font-family-monospace);
		font-size: 11px;
		line-height: 1.4;
	}

	.send-files__path-chevron {
		flex: none;
		color: var(--text-color-secondary);
		font-size: 9px;
	}

	.send-files__items {
		flex: none;
		border-radius: 13px;
		padding: 12px;
		background: var(--ui-fill-soft);
	}

	.send-files__items-head {
		justify-content: space-between;
		gap: 10px;
	}

	.send-files__item-list {
		display: grid;
		max-height: 8.5rem;
		gap: 1px;
		margin: 8px 0 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
		scrollbar-gutter: stable;
	}

	.send-files__item {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
		border-radius: 7px;
		padding: 5px 4px;
	}

	.send-files__item-icon {
		width: 14px;
		flex: none;
		color: color-mix(in srgb, var(--link-active-color) 62%, var(--text-color-secondary));
		font-size: 10px;
		text-align: center;
	}

	.send-files__item-name {
		min-width: 0;
		color: var(--text-color-secondary);
		font-size: 11px;
		line-height: 1.35;
	}

	.send-files__empty-items {
		margin: 7px 0 1px;
		color: var(--text-color-secondary);
		font-size: 11px;
		font-style: italic;
	}

	.send-files__notices {
		display: grid;
		flex: none;
		gap: 8px;
	}

	.send-files__footer {
		flex: 0 0 auto;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 32%, transparent);
		padding: 13px 20px;
	}

	@media (max-width: 767px) {
		.send-files__header {
			padding: 14px 16px;
		}

		.send-files__mark {
			width: 34px;
			height: 34px;
			border-radius: 10px;
		}

		.send-files__body {
			display: flex;
			flex-direction: column;
			overflow-y: auto;
			overscroll-behavior: contain;
		}

		.send-files__targets {
			flex: none;
			padding: 14px 14px 10px 16px;
		}

		.send-files__section-head {
			align-items: flex-start;
			flex-wrap: wrap;
			gap: 6px 10px;
		}

		.send-files__selection-actions {
			margin-left: auto;
		}

		.send-files__list {
			max-height: 18rem;
		}

		.send-files__settings {
			flex: none;
			overflow: visible;
			padding: 16px;
			border-top: 1px solid color-mix(in srgb, var(--border-color) 28%, transparent);
			border-left: 0;
		}

		.send-files__footer {
			padding: 12px 16px 16px;
		}
	}

	@media (max-width: 430px) {
		.send-files__selection-actions :deep(.ui-button) {
			gap: 4px;
			padding-inline: 5px;
		}

		.send-files__target-list {
			padding-left: 18px;
		}
	}
</style>
