<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import AgentConfigPopover from './AgentConfigPopover.vue';
	import { RecycleScroller } from 'vue-virtual-scroller';
	import type { ManagedArtifact } from '../model/artifact-types';
	import { useArtifactPicker } from '../composables/use-artifact-picker';

	const props = defineProps<{
		appId: string;
		active?: boolean;
		modelValue: ManagedArtifact[];
		disabled?: boolean;
		compact?: boolean;
	}>();
	const emit = defineEmits<{ 'update:modelValue': [value: ManagedArtifact[]] }>();
	const { t } = useI18n();
	const opened = ref(false);
	const input = ref<HTMLInputElement | null>(null);
	const error = ref('');
	const selectedIds = computed(() => new Set(props.modelValue.map((item) => item.id)));
	const selectionLimit = 10;

	function select(item: ManagedArtifact): void {
		if (props.disabled || selectedIds.value.has(item.id)) {
			return;
		}
		if (props.modelValue.length >= selectionLimit) {
			error.value = t('agent.attachments.limitReached', { count: selectionLimit });
			return;
		}
		emit('update:modelValue', [...props.modelValue, item]);
	}

	const {
		query,
		items,
		nextOffset,
		needsReload,
		uploadUnknown,
		reservation,
		acknowledged,
		operation,
		blocked,
		load,
		uploadFiles,
		checkUpload,
		newIntent,
	} = useArtifactPicker(
		() => opened.value && props.active !== false,
		() => props.appId,
		select,
	);
	const busy = operation.busy;

	function toggle(item: ManagedArtifact): void {
		if (props.disabled || blocked.value) {
			return;
		}
		if (selectedIds.value.has(item.id)) {
			emit(
				'update:modelValue',
				props.modelValue.filter((value) => value.id !== item.id),
			);
		} else {
			select(item);
		}
	}

	function chooseFile(event: Event): void {
		if (!(event.target instanceof HTMLInputElement)) {
			return;
		}
		const files = Array.from(event.target.files ?? []);
		event.target.value = '';
		if (!props.disabled && props.modelValue.length < selectionLimit) {
			void uploadFiles(files.slice(0, selectionLimit - props.modelValue.length));
		}
	}

	watch(
		() => props.active,
		(value) => {
			if (value === false) opened.value = false;
		},
	);

	watch(
		() => props.appId,
		() => {
			opened.value = false;
			error.value = '';
		},
	);
</script>

<template>
	<AgentConfigPopover
		:ariaLabel="$t('agent.attachments.button', { count: modelValue.length })"
		:title="$t('agent.attachments.button', { count: modelValue.length })"
		:disabled="disabled"
		panel-class="w-[min(520px,calc(100vw-24px))]"
		:trigger-variant="compact ? 'square' : 'default'"
		@open-change="(value) => (opened = value)"
	>
		<template #trigger>
			<template v-if="compact">
				<i class="fa-solid fa-plus text-[11px]" aria-hidden="true"></i>
				<span
					v-if="modelValue.length > 0"
					class="pointer-events-none absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-white"
					aria-hidden="true"
					>{{ modelValue.length }}</span
				>
			</template>
			<template v-else>
				<i class="fa-solid fa-paperclip text-[10px]" aria-hidden="true"></i>
				<span class="agent-config-verbose whitespace-nowrap">{{
					$t('agent.attachments.button', { count: modelValue.length })
				}}</span>
				<span v-if="modelValue.length > 0" class="agent-config-compact hidden text-[11px] font-medium">{{
					modelValue.length
				}}</span>
			</template>
		</template>

		<template #panel>
			<div class="flex h-[340px] min-h-0 flex-col">
				<div class="flex shrink-0 gap-1.5 border-b border-border/60 pb-2">
					<input
						v-model="query"
						type="search"
						class="h-8 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 text-xs outline-none transition-colors focus:border-primary/50"
						:placeholder="$t('agent.attachments.search')"
						@keydown.enter.prevent="load()"
					/>
					<button
						type="button"
						class="h-8 rounded-lg px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-header hover:text-foreground"
						:disabled="busy"
						@click="load()"
					>
						{{ $t('agent.attachments.searchAction') }}
					</button>
					<button
						type="button"
						class="h-8 rounded-lg bg-header/70 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-header"
						:disabled="blocked || uploadUnknown || disabled || modelValue.length >= selectionLimit"
						@click="input?.click()"
					>
						{{ $t('agent.attachments.upload') }}
					</button>
					<input ref="input" type="file" multiple class="hidden" @change="chooseFile" />
				</div>
				<p v-if="operation.notice.value" class="p-2 text-xs" role="status">
					{{ t('agent.settings.appManagement.' + operation.notice.value) }}
				</p>
				<p v-if="needsReload" class="p-2 text-xs">{{ t('agent.settings.appManagement.refreshRequired') }}</p>
				<div
					v-if="uploadUnknown || (reservation && reservation.status !== 'ready')"
					class="space-y-2 p-2 text-xs"
				>
					<UiButton v-if="reservation" type="button" :disabled="busy" @click="checkUpload">{{
						t('agent.artifactManagement.checkUpload')
					}}</UiButton>
					<template v-if="uploadUnknown">
						<p>{{ t('agent.artifactManagement.uploadUnknown') }}</p>
						<UiCheckbox v-model="acknowledged">{{
							t('agent.artifactManagement.acknowledgeUpload')
						}}</UiCheckbox>
						<UiButton type="button" :disabled="blocked || !acknowledged" @click="newIntent">{{
							t('agent.artifactManagement.newUpload')
						}}</UiButton>
					</template>
				</div>
				<p v-if="error" class="shrink-0 px-1 py-2 text-xs text-error">{{ error }}</p>
				<RecycleScroller class="min-h-0 flex-1 overflow-y-auto" :items="items" :item-size="54" key-field="id">
					<template #default="{ item }">
						<button
							type="button"
							class="flex h-[54px] w-full items-center gap-2.5 border-b border-border/50 px-2 text-left transition-colors hover:bg-header/60"
							:class="selectedIds.has(item.id) ? 'bg-primary/8' : ''"
							@click="toggle(item)"
						>
							<i
								:class="
									selectedIds.has(item.id)
										? 'fa-solid fa-square-check text-primary'
										: 'fa-regular fa-square text-text-secondary'
								"
								aria-hidden="true"
							></i>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs font-medium text-foreground">{{ item.name }}</span>
								<span class="mt-0.5 block truncate text-[11px] text-text-secondary"
									>{{ item.appId }} · {{ item.mediaType }}</span
								>
							</span>
						</button>
					</template>
				</RecycleScroller>
				<button
					v-if="nextOffset !== null"
					type="button"
					class="h-8 shrink-0 border-t border-border/60 text-xs font-medium text-text-secondary transition-colors hover:bg-header hover:text-foreground"
					:disabled="busy || needsReload"
					@click="load(true)"
				>
					{{ $t('agent.attachments.loadMore') }}
				</button>
			</div>
		</template>
	</AgentConfigPopover>
</template>

<style scoped>
	.agent-config-summary {
		font-size: 11px;
		line-height: 1;
	}

	@container agent-hub-window (max-width: 1040px) {
		.agent-config-summary {
			min-width: 28px;
			height: 28px;
			gap: 3px;
			padding-inline: 6px;
			font-size: 11px;
		}

		.agent-config-verbose {
			display: none;
		}

		.agent-config-compact {
			display: inline;
		}
	}
</style>
