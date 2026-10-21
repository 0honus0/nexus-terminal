<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInput, UiModal } from '@/foundation/ui';
	import type { ConnectionSummary } from '@/features/connections/public';
	import type { TagGroupInput } from '../model/tag-group-types';
	import { useTagGroupManagement } from '../composables/use-tag-group-management';

	const props = defineProps<TagGroupInput>();
	const emit = defineEmits<{ close: []; changed: [] }>();
	const { t } = useI18n();
	const {
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
	} = useTagGroupManagement(props, {
		close: () => emit('close'),

		changed: () => emit('changed'),
	});

	function protocolIcon(connection: ConnectionSummary): string {
		if (connection.type === 'RDP') {
			return 'fas fa-desktop';
		}
		if (connection.type === 'VNC') {
			return 'fas fa-plug';
		}
		return 'fas fa-server';
	}
</script>

<template>
	<UiModal
		:visible="visible"
		:title="modalTitle"
		:z-index="150"
		panel-class="w-[min(672px,94vw)] max-h-[90dvh]"
		content-class="!py-0"
		@close="emit('close')"
	>
		<div v-if="tag" class="flex min-h-0 flex-col py-4">
			<p v-if="message" role="alert" class="px-4 text-sm text-error">{{ message }}</p>
			<p v-if="requiresReview || tags.needsRefresh.value" class="px-4 text-sm">{{ t('tags.reopenToRefresh') }}</p>
			<div class="space-y-3 border-b border-border/50 px-4 pb-4">
				<div class="grid gap-1.5 text-sm text-text-secondary">
					<span>{{ t('workspaceConnectionList.manageTags.tagName') }}</span>
					<UiInput
						v-model="name"
						:disabled="saving"
						:aria-label="t('workspaceConnectionList.manageTags.tagName')"
					/>
					<UiButton
						type="button"
						appearance="soft"
						density="compact"
						class="justify-self-start"
						:disabled="
							saving ||
							requiresReview ||
							tags.busy.value ||
							tags.needsRefresh.value ||
							name.trim() === snapshot?.name
						"
						@click="rename"
					>
						<i class="fas fa-pen mr-1" aria-hidden="true" />
						{{ t('tags.renameOnly') }}
					</UiButton>
				</div>

				<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
					<UiInput
						v-model="search"
						type="text"
						:placeholder="t('workspaceConnectionList.manageTags.searchPlaceholder')"
						:aria-label="t('workspaceConnectionList.manageTags.searchPlaceholder')"
						class="min-w-0 w-full flex-1"
					>
						<template #leading><i class="fas fa-search text-xs" aria-hidden="true" /></template>
					</UiInput>
					<div class="grid min-w-0 grid-cols-3 gap-2 sm:flex sm:shrink-0">
						<UiButton type="button" appearance="soft" density="compact" @click="selectVisible">
							{{ t('workspaceConnectionList.manageTags.selectAll') }}
						</UiButton>
						<UiButton type="button" appearance="soft" density="compact" @click="deselectVisible">
							{{ t('workspaceConnectionList.manageTags.deselectAll') }}
						</UiButton>
						<UiButton type="button" appearance="soft" density="compact" @click="invertVisible">
							{{ t('workspaceConnectionList.manageTags.invertSelection') }}
						</UiButton>
					</div>
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto p-4 pr-2">
				<div class="rounded-md border border-border bg-header/30 p-4">
					<ul v-if="filtered.length" class="m-0 list-none space-y-1 p-0">
						<li
							v-for="connection in filtered"
							:key="connection.id"
							class="flex cursor-pointer items-center rounded-md p-2.5 transition-colors duration-150 hover:bg-primary/10"
							:class="selected.has(connection.id) ? 'bg-primary/20' : ''"
							@click="toggle(connection.id)"
						>
							<input
								type="checkbox"
								class="mr-3 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0"
								:checked="selected.has(connection.id)"
								:aria-label="connection.name || connection.host"
								@change.stop="toggle(connection.id)"
								@click.stop
							/>
							<i
								:class="[
									protocolIcon(connection),
									'mr-2.5 w-4 shrink-0 text-center text-text-secondary',
								]"
								aria-hidden="true"
							></i>
							<span class="min-w-0 flex-1 truncate text-sm" :title="connection.name || connection.host">
								{{ connection.name || connection.host }}
							</span>
							<span class="ml-2 shrink-0 text-xs text-text-alt">({{ connection.type }})</span>
						</li>
					</ul>
					<div
						v-else
						class="flex min-h-40 flex-col items-center justify-center p-6 text-center text-text-secondary"
					>
						<i class="fas fa-search mb-3 text-2xl" aria-hidden="true"></i>
						<p>{{ t('workspaceConnectionList.manageTags.noConnectionsFound') }}</p>
					</div>
				</div>
			</div>
		</div>

		<template #footer>
			<div v-if="tag" class="flex flex-wrap justify-end gap-2 sm:gap-3">
				<UiButton
					type="button"
					appearance="ghost"
					tone="danger"
					:disabled="saving || requiresReview || tags.busy.value || tags.needsRefresh.value"
					@click="removeTag"
				>
					{{ t('common.delete') }}
				</UiButton>
				<UiButton type="button" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
				<UiButton
					type="button"
					appearance="solid"
					tone="primary"
					:loading="saving"
					:disabled="
						saving ||
						requiresReview ||
						tags.busy.value ||
						tags.needsRefresh.value ||
						name.trim() !== snapshot?.name
					"
					@click="save"
				>
					{{ t('tags.saveAssociations') }}
				</UiButton>
			</div>
		</template>
	</UiModal>
</template>
