<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiSearchInput } from '@/foundation/ui';
	import AgentConfigPopover from './AgentConfigPopover.vue';
	import { RecycleScroller } from 'vue-virtual-scroller';
	import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
	import type { ManagedArtifact } from '../model/artifact-types';
	import { useArtifactPicker } from '../composables/use-artifact-picker';

	const props = defineProps<{
		appId: string;
		appNames?: Record<string, string>;
		active?: boolean;
		modelValue: ManagedArtifact[];
		disabled?: boolean;
		compact?: boolean;
	}>();
	const emit = defineEmits<{ 'update:modelValue': [value: ManagedArtifact[]] }>();
	const { t } = useI18n();
	const opened = ref(false);
	const input = ref<HTMLInputElement | null>(null);
	const selectedIds = computed(() => new Set(props.modelValue.map((item) => item.id)));

	function appName(item: ManagedArtifact): string {
		return props.appNames?.[item.appId] ?? t('agent.files.unknownApp');
	}

	function select(item: ManagedArtifact): void {
		if (props.disabled || selectedIds.value.has(item.id)) {
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
		if (!props.disabled) {
			void uploadFiles(files);
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
				<div class="flex shrink-0 items-center gap-1.5 border-b border-border/50 pb-2.5">
					<UiSearchInput
						v-model="query"
						density="compact"
						class="min-w-0 flex-1"
						:placeholder="$t('agent.attachments.search')"
						:aria-label="$t('agent.attachments.search')"
						:clear-label="$t('common.clear')"
						@keydown.enter.prevent="load()"
					/>
					<UiButton density="compact" appearance="soft" :disabled="busy" @click="load()">
						{{ $t('agent.attachments.searchAction') }}
					</UiButton>
					<UiButton
						density="compact"
						appearance="solid"
						:disabled="blocked || uploadUnknown || disabled"
						@click="input?.click()"
					>
						{{ $t('agent.attachments.upload') }}
					</UiButton>
					<input ref="input" type="file" multiple class="hidden" @change="chooseFile" />
				</div>
				<p v-if="needsReload" class="p-2 text-xs">{{ t('agent.settings.appManagement.refreshRequired') }}</p>
				<div
					v-if="uploadUnknown || (reservation && reservation.status !== 'ready')"
					class="space-y-2 p-2 text-xs"
				>
					<UiButton
						v-if="reservation"
						density="compact"
						appearance="soft"
						:disabled="busy"
						@click="checkUpload"
					>
						{{ t('agent.artifactManagement.checkUpload') }}
					</UiButton>
					<template v-if="uploadUnknown">
						<p>{{ t('agent.artifactManagement.uploadUnknown') }}</p>
						<div class="flex items-start gap-2">
							<UiCheckbox
								v-model="acknowledged"
								density="compact"
								:aria-label="t('agent.artifactManagement.acknowledgeUpload')"
							/>
							<span>{{ t('agent.artifactManagement.acknowledgeUpload') }}</span>
						</div>
						<UiButton
							density="compact"
							appearance="soft"
							:disabled="blocked || !acknowledged"
							@click="newIntent"
						>
							{{ t('agent.artifactManagement.newUpload') }}
						</UiButton>
					</template>
				</div>
				<RecycleScroller class="min-h-0 flex-1 overflow-y-auto" :items="items" :item-size="54" key-field="id">
					<template #default="{ item }">
						<button
							type="button"
							role="checkbox"
							:aria-checked="selectedIds.has(item.id)"
							class="flex h-[54px] w-full items-center gap-2.5 border-b border-border/40 px-2 text-left transition-colors hover:bg-header/45"
							:class="selectedIds.has(item.id) ? 'bg-primary/[0.06]' : ''"
							@click="toggle(item)"
						>
							<span
								class="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors"
								:class="
									selectedIds.has(item.id)
										? 'border-primary bg-primary text-white'
										: 'border-border/80 bg-background/50 text-transparent'
								"
								aria-hidden="true"
							>
								<i class="fa-solid fa-check text-[8px]"></i>
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs font-medium text-foreground">{{ item.name }}</span>
								<span class="mt-0.5 block truncate text-[11px] text-text-secondary"
									>{{ appName(item) }} · {{ item.mediaType }}</span
								>
							</span>
						</button>
					</template>
				</RecycleScroller>
				<UiButton
					v-if="nextOffset !== null"
					block
					density="compact"
					appearance="ghost"
					class="shrink-0 rounded-none border-t border-border/45"
					:disabled="busy || needsReload"
					@click="load(true)"
				>
					{{ $t('agent.attachments.loadMore') }}
				</UiButton>
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
