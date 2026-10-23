<script setup lang="ts">
	import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInlineNotice, UiModal, UiSpinner, UiTextarea } from '@/foundation/ui';
	import { targetArray, InvalidTargetPayload } from '@nexus-terminal/shared/targets/http';
	import { TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
	import { readConnectionImportInput } from '@nexus-terminal/shared/targets/connections/http-codec';
	import { targetErrorKey } from '@/client/targets/target-types';
	import { useConnectionEditor } from '../composables/use-connection-editor';
	import { CONNECTION_CREATION_MAX_ITEMS } from '../model/connection-script';
	import type { ConnectionSummary } from '../model/connection-types';
	const props = defineProps<{ visible: boolean }>();
	const emit = defineEmits<{ close: []; saved: [item: ConnectionSummary] }>();
	const { t } = useI18n();
	const { loading, message, receipts, data, refresh, saveMany } = useConnectionEditor(
		props,
		(event: string, value?: ConnectionSummary | number) => {
			if (event === 'close') {
				emit('close');
			} else if (event === 'saved' && typeof value === 'object') {
				emit('saved', value);
			}
		},
	);
	const source = ref('');
	const fileInput = ref<HTMLInputElement | null>(null);
	const fileName = ref('');
	const showJson = ref(false);
	const reading = ref(false);
	const fileError = ref('');
	let generation = 0;
	const failureReasons = computed(() => [
		...new Set(
			receipts.value
				.filter((item) => item.status === 'error')
				.map((item) => t('connections.failures.' + item.code)),
		),
	]);

	function resetSource(): void {
		generation++;
		source.value = '';
		fileName.value = '';
		showJson.value = false;
		fileError.value = '';
		reading.value = false;
	}

	watch(() => props.visible, resetSource, { flush: 'sync' });
	onDeactivated(resetSource);
	onBeforeUnmount(resetSource);

	async function read(event: Event): Promise<void> {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) {
			return;
		}
		const file = input.files?.[0];
		input.value = '';
		if (!file) {
			return;
		}
		const current = ++generation;
		reading.value = true;
		fileError.value = '';
		try {
			if (file.size > TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES) {
				throw new InvalidTargetPayload();
			}
			const bytes = await file.arrayBuffer();
			if (current !== generation) {
				return;
			}
			source.value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
			fileName.value = file.name;
		} catch {
			if (current === generation) {
				fileError.value = t('connections.failures.invalid_input');
			}
		} finally {
			if (current === generation) {
				reading.value = false;
			}
		}
	}

	function submit(): void {
		if (loading.value || reading.value) {
			return;
		}
		fileError.value = '';
		try {
			if (new TextEncoder().encode(source.value).byteLength > TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES) {
				throw new InvalidTargetPayload();
			}
			const value: unknown = JSON.parse(source.value);
			const items = targetArray(value, readConnectionImportInput, CONNECTION_CREATION_MAX_ITEMS);
			void saveMany(items);
		} catch (cause) {
			fileError.value = t('connections.failures.' + targetErrorKey(cause));
		}
	}

	function requestFile(): void {
		fileInput.value?.click();
	}

	function clearSource(): void {
		source.value = '';
		fileName.value = '';
		fileError.value = '';
	}
</script>
<template>
	<UiModal :visible="visible" :title="t('connections.importTitle')" panel-class="!max-w-3xl" @close="emit('close')">
		<form id="connection-import-form" class="space-y-4" @submit.prevent="submit">
			<fieldset :disabled="loading || reading || data.needsRefresh.value" class="space-y-4">
				<input
					ref="fileInput"
					type="file"
					accept="application/json,.json"
					class="sr-only"
					:aria-label="t('connections.selectFile')"
					@change="read"
				/>
				<div class="rounded-lg border border-border/70 bg-background/45 p-4">
					<div class="flex flex-wrap items-center gap-3">
						<UiButton type="button" appearance="soft" @click="requestFile">
							<template #leading><i class="fas fa-file-import" aria-hidden="true" /></template>
							{{ t('connections.selectFile') }}
						</UiButton>
						<p v-if="fileName" class="min-w-0 flex-1 break-all text-sm text-text-secondary">
							{{ t('connections.fileLoaded', { name: fileName }) }}
						</p>
						<p v-else class="min-w-0 flex-1 text-sm text-text-secondary">
							{{ t('connections.fileHint') }}
						</p>
						<UiButton
							v-if="source"
							type="button"
							appearance="ghost"
							density="compact"
							:disabled="reading"
							@click="clearSource"
							>{{ t('common.clear') }}</UiButton
						>
					</div>
				</div>

				<div>
					<UiButton
						type="button"
						appearance="ghost"
						density="compact"
						:aria-expanded="showJson"
						@click="showJson = !showJson"
					>
						<i
							:class="['fas', showJson ? 'fa-chevron-down' : 'fa-chevron-right', 'mr-1']"
							aria-hidden="true"
						/>
						{{ t('connections.pasteJson') }}
					</UiButton>
					<div v-if="showJson" class="mt-2">
						<UiTextarea v-model="source" :min-rows="10" :aria-label="t('connections.pasteJson')" />
					</div>
				</div>

				<div v-if="reading" class="flex items-center gap-2 text-sm text-text-secondary" role="status">
					<UiSpinner />
					{{ t('common.loading') }}
				</div>
				<UiInlineNotice v-if="fileError || message" tone="danger">
					{{ fileError || message }}
				</UiInlineNotice>
				<UiInlineNotice v-if="failureReasons.length" tone="danger">
					<p class="m-0 font-medium">{{ t('connections.failedItems') }}</p>
					<ul class="mt-1 list-disc space-y-1 pl-5">
						<li v-for="reason in failureReasons" :key="reason">{{ reason }}</li>
					</ul>
				</UiInlineNotice>
			</fieldset>
		</form>
		<template #footer
			><UiButton v-if="!loading && data.needsRefresh.value" :disabled="reading" @click="refresh">{{
				t('connections.refresh')
			}}</UiButton
			><UiButton
				type="submit"
				form="connection-import-form"
				appearance="solid"
				tone="primary"
				:disabled="loading || reading || data.needsRefresh.value || !source.trim()"
				>{{ t('connections.importTitle') }}</UiButton
			><UiButton @click="emit('close')">{{ t('common.close') }}</UiButton></template
		>
	</UiModal>
</template>
