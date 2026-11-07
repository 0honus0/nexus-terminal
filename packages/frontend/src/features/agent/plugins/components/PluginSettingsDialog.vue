<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiEmptyState,
		UiFormActions,
		UiFormField,
		UiInlineNotice,
		UiLoadingState,
		UiModal,
		UiSelect,
		type UiSelectOption,
	} from '@/foundation/ui';

	withDefaults(
		defineProps<{
			visible: boolean;
			packageName: string;
			packageVersion: string;
			appOptions: UiSelectOption[];
			appId: string;
			status: 'loading' | 'failed' | 'ready';
			failure?: string;
			busy?: boolean;
		}>(),
		{ failure: '', busy: false },
	);
	const emit = defineEmits<{ close: []; reload: []; 'update:appId': [value: string] }>();
	const { t } = useI18n();
</script>

<template>
	<UiModal
		:visible="visible"
		:aria-label="t('agent.settings.plugins.settings.title')"
		:close-on-backdrop="!busy"
		:close-on-escape="!busy"
		:restore-focus="true"
		:panel-style="{ height: 'min(760px, calc(100dvh - 2rem))', maxHeight: 'calc(100dvh - 2rem)' }"
		panel-class="ui-form-surface !max-w-3xl !p-4 sm:!p-6 lg:!p-7"
		content-class="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !py-0"
		@close="emit('close')"
	>
		<template #header>
			<div class="min-w-0">
				<h2 class="text-lg font-semibold">{{ t('agent.settings.plugins.settings.title') }}</h2>
				<p class="mt-1 break-words text-xs text-text-secondary">
					{{ packageName }} <span class="font-mono">v{{ packageVersion }}</span>
				</p>
			</div>
		</template>
		<UiLoadingState
			v-if="status === 'loading'"
			class="my-auto py-8"
			compact
			:bordered="false"
			:title="t('agent.settings.plugins.settings.loading')"
		/>
		<UiInlineNotice v-else-if="status === 'failed'" class="my-4" tone="warning" compact>
			{{ failure || t('agent.settings.plugins.settings.failed') }}
			<template #actions>
				<UiButton type="button" :disabled="busy" @click="emit('reload')">{{
					t('agent.settings.plugins.settings.reload')
				}}</UiButton>
			</template>
		</UiInlineNotice>
		<template v-else-if="appOptions.length">
			<UiFormField
				class="shrink-0 py-4"
				:label="t('agent.settings.plugins.settings.app')"
				for-id="plugin-settings-app"
			>
				<UiSelect
					id="plugin-settings-app"
					:model-value="appId"
					:options="appOptions"
					:placeholder="t('agent.settings.plugins.settings.chooseApp')"
					:disabled="busy"
					:aria-label="t('agent.settings.plugins.settings.app')"
					@update:model-value="(value) => typeof value === 'string' && emit('update:appId', value)"
				/>
			</UiFormField>
			<div v-if="appId" class="min-h-0 flex-1 overflow-hidden">
				<slot />
			</div>
			<UiEmptyState
				v-else
				class="my-auto py-8"
				compact
				:bordered="false"
				icon="fa-solid fa-layer-group"
				:title="t('agent.settings.plugins.settings.chooseApp')"
			/>
		</template>
		<UiEmptyState
			v-else
			class="my-auto py-8"
			compact
			:bordered="false"
			icon="fa-solid fa-puzzle-piece"
			:title="t('agent.settings.plugins.settings.noApps')"
			:description="t('agent.settings.plugins.settings.noAppsHint')"
		/>
		<template #footer>
			<UiFormActions>
				<slot name="actions" />
				<UiButton type="button" appearance="soft" tone="neutral" :disabled="busy" @click="emit('close')">
					{{ t('common.close') }}
				</UiButton>
			</UiFormActions>
		</template>
	</UiModal>
</template>
