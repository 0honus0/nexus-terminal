<script setup lang="ts">
	import { onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
	import { useAuthSession } from '@/features/auth/public';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiModal, UiSelect, UiTextarea } from '@/foundation/ui';
	import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
	import { targetErrorKey } from '@/client/targets/target-types';
	import { readConnectionChanges, readCredentialInput } from '@nexus-terminal/shared/targets/connections/http-codec';
	import type { TargetConnectionChanges } from '@nexus-terminal/shared/targets/connections/http';
	import type { ConnectionBatchCommand } from '../model/connection-types';
	const props = defineProps<{ visible: boolean; count: number; loading?: boolean }>();
	const emit = defineEmits<{ close: []; save: [command: ConnectionBatchCommand] }>();
	const { t } = useI18n();
	const capabilities = useRuntimeFeatureCapabilities();
	const session = useAuthSession();
	const proxies = capabilities.proxies;
	const sshKeys = capabilities.sshKeys;
	const ConnectionTagPicker = capabilities.tags.picker;
	const kind = ref<'metadata' | 'credential'>('metadata');
	const port = ref('');
	const username = ref('');
	const password = ref('');
	const sshKeyId = ref('');
	const proxyId = ref('__nochange__');
	const notes = ref('');
	const tagIds = ref<number[]>([]);
	const editPort = ref(false);
	const editUsername = ref(false);
	const editTags = ref(false);
	const editNotes = ref(false);
	const auth = ref('password');
	const error = ref('');
	let generation = 0;

	function reset(): void {
		generation++;
		kind.value = 'metadata';
		port.value = '';
		username.value = '';
		password.value = '';
		sshKeyId.value = '';
		proxyId.value = '__nochange__';
		notes.value = '';
		tagIds.value = [];
		editPort.value = false;
		editUsername.value = false;
		editTags.value = false;
		editNotes.value = false;
		error.value = '';
		auth.value = 'password';
	}

	watch(
		() => props.visible,
		async (visible) => {
			reset();
			if (!visible) {
				return;
			}
			const current = generation;
			const result = await Promise.allSettled([proxies.load(), sshKeys.load()]);
			if (current === generation && result.some((row) => row.status === 'rejected')) {
				error.value = t('connections.failures.options_failed');
			}
		},
		{ immediate: true },
	);
	watch(kind, () => {
		password.value = '';
		sshKeyId.value = '';
	});
	onBeforeUnmount(reset);
	onDeactivated(reset);
	watch(
		() => (session.isAuthenticated.value ? session.user.value?.id : null),
		() => {
			reset();
			emit('close');
		},
		{ flush: 'sync' },
	);

	function save(): void {
		if (props.loading) {
			return;
		}
		error.value = '';
		try {
			if (kind.value === 'credential') {
				const credential =
					auth.value === 'none'
						? null
						: readCredentialInput(
								auth.value === 'key'
									? { kind: 'ssh_key', sshKeyId: Number(sshKeyId.value) }
									: { kind: 'password', password: password.value },
							);
				emit('save', { kind: 'credential', credential });
				return;
			}
			const changes: TargetConnectionChanges = {};
			if (editPort.value) {
				changes.port = Number(port.value);
			}
			if (editUsername.value) {
				changes.username = username.value.trim();
			}
			if (proxyId.value !== '__nochange__') {
				changes.route = proxyId.value === '__none__' ? 'direct' : 'proxy';
				changes.proxyId = proxyId.value === '__none__' ? null : Number(proxyId.value);
				changes.jumpIds = [];
			}
			if (editTags.value) {
				changes.tagIds = tagIds.value.map((id) => id);
			}
			if (editNotes.value) {
				changes.notes = notes.value || null;
			}
			emit('save', { kind: 'metadata', changes: readConnectionChanges(changes) });
		} catch (cause) {
			error.value = t('connections.failures.' + targetErrorKey(cause));
		}
	}
</script>
<template>
	<UiModal
		:visible="visible"
		:title="t('connections.batchEdit.title') + ' (' + count + ')'"
		panel-class="!max-w-xl"
		@close="emit('close')"
	>
		<form @submit.prevent="save">
			<fieldset :disabled="loading" class="space-y-4">
				<UiFormField :label="t('connections.batchMode')"
					><UiSelect v-model="kind"
						><option value="metadata">{{ t('connections.metadata') }}</option>
						<option value="credential">{{ t('connections.credentials') }}</option></UiSelect
					></UiFormField
				>
				<p class="text-sm text-text-secondary">{{ t('connections.separateSaves') }}</p>
				<template v-if="kind === 'metadata'">
					<label class="flex gap-2"><UiCheckbox v-model="editPort" />{{ t('connections.form.port') }}</label
					><UiInput v-if="editPort" v-model="port" type="number" min="1" max="65535" />
					<label class="flex gap-2"
						><UiCheckbox v-model="editUsername" />{{ t('connections.form.username') }}</label
					><UiInput v-if="editUsername" v-model="username" />
					<UiFormField :label="t('connections.form.proxy')"
						><UiSelect v-model="proxyId"
							><option value="__nochange__">{{ t('connections.batchEdit.noChange') }}</option>
							<option value="__none__">{{ t('connections.form.noProxy') }}</option>
							<option v-for="item in proxies.items.value" :key="item.id" :value="String(item.id)">
								{{ item.name }}
							</option></UiSelect
						></UiFormField
					>
					<label class="flex gap-2"><UiCheckbox v-model="editTags" />{{ t('connections.form.tags') }}</label
					><ConnectionTagPicker v-if="editTags" v-model="tagIds" />
					<label class="flex gap-2"><UiCheckbox v-model="editNotes" />{{ t('connections.form.notes') }}</label
					><UiTextarea v-if="editNotes" v-model="notes" :min-rows="3" />
				</template>
				<template v-else
					><UiSelect v-model="auth"
						><option value="password">{{ t('connections.form.authMethodPassword') }}</option>
						<option value="key">{{ t('connections.form.authMethodKey') }}</option>
						<option value="none">{{ t('connections.clearCredential') }}</option></UiSelect
					><UiInput
						v-if="auth === 'password'"
						v-model="password"
						type="password"
						autocomplete="new-password"
					/><UiSelect v-if="auth === 'key'" v-model="sshKeyId"
						><option value="">{{ t('connections.form.noSshKey') }}</option>
						<option v-for="key in sshKeys.items.value" :key="key.id" :value="String(key.id)">
							{{ key.name }}
						</option></UiSelect
					></template
				>
				<p v-if="error" role="alert">{{ error }}</p>
				<UiButton type="submit" :disabled="loading">{{ t('common.save') }}</UiButton>
			</fieldset>
		</form>
		<template #footer
			><UiButton @click="emit('close')">{{ t('common.close') }}</UiButton></template
		>
	</UiModal>
</template>
