<script setup lang="ts">
	import { onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiModal, UiTextarea } from '@/foundation/ui';
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
	const reading = ref(false);
	const fileError = ref('');
	let generation = 0;

	function resetSource(): void {
		generation++;
		source.value = '';
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
</script>
<template>
	<UiModal :visible="visible" :title="t('connections.importTitle')" panel-class="!max-w-3xl" @close="emit('close')">
		<p class="mb-3 text-sm text-text-secondary">{{ t('connections.importHelp') }}</p>
		<p v-if="message || fileError" role="status">{{ fileError || message }}</p>
		<ol v-if="receipts.length" class="my-3 max-h-48 overflow-y-auto" aria-live="polite">
			<li v-for="item in receipts" :key="item.index">
				#{{ item.index }}:
				{{
					item.status === 'ok'
						? `${t('connections.saved')} (${item.id})`
						: t('connections.failures.' + item.code)
				}}
			</li>
		</ol>
		<form @submit.prevent="submit">
			<fieldset :disabled="loading || reading || data.needsRefresh.value" class="space-y-3">
				<input
					type="file"
					accept="application/json,.json"
					:aria-label="t('connections.importTitle')"
					@change="read"
				/><UiTextarea v-model="source" :min-rows="10" :aria-label="t('connections.importTitle')" /><UiButton
					type="submit"
					>{{ t('connections.importTitle') }}</UiButton
				>
			</fieldset>
		</form>
		<template #footer
			><UiButton :disabled="loading || reading" @click="refresh">{{ t('connections.refresh') }}</UiButton
			><UiButton @click="emit('close')">{{ t('common.close') }}</UiButton></template
		>
	</UiModal>
</template>
