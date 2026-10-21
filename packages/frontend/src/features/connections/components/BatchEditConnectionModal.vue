<script setup lang="ts">
	import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
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
	const port = ref('');
	const username = ref('');
	const password = ref('');
	const sshKeyId = ref('');
	const proxyId = ref('__nochange__');
	const notes = ref('');
	const tagIds = ref<number[]>([]);
	const editPort = ref(false);
	const editUsername = ref(false);
	const editAdvanced = ref(false);
	const editTags = ref(false);
	const editNotes = ref(false);
	const auth = ref('password');
	const error = ref('');
	let generation = 0;
	const hasMetadataChanges = computed(
		() =>
			editPort.value ||
			editUsername.value ||
			(editAdvanced.value && (proxyId.value !== '__nochange__' || editTags.value || editNotes.value)),
	);

	function reset(): void {
		generation++;
		port.value = '';
		username.value = '';
		password.value = '';
		sshKeyId.value = '';
		proxyId.value = '__nochange__';
		notes.value = '';
		tagIds.value = [];
		editPort.value = false;
		editUsername.value = false;
		editAdvanced.value = false;
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

	function saveMetadata(): void {
		if (props.loading) {
			return;
		}
		error.value = '';
		try {
			if (!hasMetadataChanges.value) return;
			const changes: TargetConnectionChanges = {};
			if (editPort.value) {
				changes.port = Number(port.value);
			}
			if (editUsername.value) {
				changes.username = username.value.trim();
			}
			if (editAdvanced.value && proxyId.value !== '__nochange__') {
				changes.route = proxyId.value === '__none__' ? 'direct' : 'proxy';
				changes.proxyId = proxyId.value === '__none__' ? null : Number(proxyId.value);
				changes.jumpIds = [];
			}
			if (editAdvanced.value && editTags.value) {
				changes.tagIds = tagIds.value.map((id) => id);
			}
			if (editAdvanced.value && editNotes.value) {
				changes.notes = notes.value || null;
			}
			emit('save', { kind: 'metadata', changes: readConnectionChanges(changes) });
		} catch (cause) {
			error.value = t('connections.failures.' + targetErrorKey(cause));
		}
	}

	function saveCredential(): void {
		if (props.loading) return;
		error.value = '';
		try {
			const credential =
				auth.value === 'none'
					? null
					: readCredentialInput(
							auth.value === 'key'
								? { kind: 'ssh_key', sshKeyId: Number(sshKeyId.value) }
								: { kind: 'password', password: password.value },
						);
			emit('save', { kind: 'credential', credential });
		} catch (cause) {
			error.value = t('connections.failures.' + targetErrorKey(cause));
		}
	}
</script>
<template>
	<UiModal
		:visible="visible"
		panel-class="!max-w-xl !max-h-[90vh] !p-6"
		content-class="!overflow-hidden !py-0"
		@close="emit('close')"
	>
		<form id="batch-connection-editor" class="flex max-h-[78vh] min-h-0 flex-col" @submit.prevent="saveMetadata">
			<h3 class="mb-6 shrink-0 text-center text-xl font-semibold">
				{{ t('connections.batchEdit.title') }} ({{ t('connections.batchEdit.selectedItems', { count }) }})
			</h3>
			<fieldset :disabled="loading" class="flex-grow space-y-4 overflow-y-auto pr-2">
				<p class="text-sm text-text-secondary">{{ t('connections.separateSaves') }}</p>
				<section class="rounded-md border border-border bg-background p-4">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="text-base font-semibold">{{ t('connections.table.port') }}</h4>
						<UiCheckbox v-model="editPort" :aria-label="t('connections.form.port')" />
					</div>
					<UiFormField v-if="editPort" :label="t('connections.form.port')"
						><UiInput v-model="port" type="number" min="1" max="65535"
					/></UiFormField>
				</section>
				<section class="rounded-md border border-border bg-background p-4">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="text-base font-semibold">{{ t('connections.form.sectionAuth') }}</h4>
						<UiCheckbox v-model="editUsername" :aria-label="t('connections.form.username')" />
					</div>
					<UiFormField v-if="editUsername" :label="t('connections.form.username')"
						><UiInput v-model="username" :placeholder="t('connections.batchEdit.leaveBlankNoChange')"
					/></UiFormField>
				</section>
				<section class="rounded-md border border-border bg-background p-4">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="text-base font-semibold">{{ t('connections.form.sectionAdvanced') }}</h4>
						<UiCheckbox v-model="editAdvanced" :aria-label="t('connections.form.sectionAdvanced')" />
					</div>
					<div v-if="editAdvanced" class="space-y-3">
						<UiFormField :label="t('connections.form.proxy')"
							><UiSelect v-model="proxyId"
								><option value="__nochange__">{{ t('connections.batchEdit.noChange') }}</option>
								<option value="__none__">{{ t('connections.form.noProxy') }}</option>
								<option v-for="item in proxies.items.value" :key="item.id" :value="String(item.id)">
									{{ item.name }} ({{ item.type }})
								</option></UiSelect
							></UiFormField
						>
						<div>
							<label
								class="mb-1 flex items-center justify-between text-sm font-medium text-text-secondary"
								><span>{{ t('connections.table.tags') }}</span
								><span class="flex items-center gap-2 text-xs font-normal"
									><UiCheckbox
										v-model="editTags"
										:aria-label="t('connections.batchEdit.changeTags')"
									/>{{ t('connections.batchEdit.changeTags') }}</span
								></label
							><ConnectionTagPicker v-if="editTags" v-model="tagIds" />
						</div>
						<div class="pt-2">
							<label
								class="mb-1 flex items-center justify-between text-sm font-medium text-text-secondary"
								><span>{{ t('connections.form.notes') }}</span
								><span class="flex items-center gap-2 text-xs font-normal"
									><UiCheckbox
										v-model="editNotes"
										:aria-label="t('connections.batchEdit.changeNotes')"
									/>{{ t('connections.batchEdit.changeNotes') }}</span
								></label
							><UiTextarea v-if="editNotes" v-model="notes" :min-rows="3" />
						</div>
					</div>
				</section>
				<section class="space-y-3 rounded-md border border-border bg-background p-4">
					<h4 class="text-base font-semibold">{{ t('connections.form.sectionAuth') }}</h4>
					<UiFormField :label="t('connections.form.authMethod')"
						><UiSelect v-model="auth"
							><option value="password">{{ t('connections.form.authMethodPassword') }}</option>
							<option value="key">{{ t('connections.form.authMethodKey') }}</option>
							<option value="none">{{ t('connections.clearCredential') }}</option></UiSelect
						></UiFormField
					>
					<UiFormField v-if="auth === 'password'" :label="t('connections.form.password')"
						><UiInput v-model="password" type="password" autocomplete="new-password"
					/></UiFormField>
					<UiFormField v-if="auth === 'key'" :label="t('connections.form.sshKey')"
						><UiSelect v-model="sshKeyId"
							><option value="">{{ t('connections.form.noSshKey') }}</option>
							<option v-for="key in sshKeys.items.value" :key="key.id" :value="String(key.id)">
								{{ key.name }}
							</option></UiSelect
						></UiFormField
					>
				</section>
				<p
					v-if="error"
					class="rounded-md border border-error/30 bg-error/10 p-3 text-center text-sm text-error"
					role="alert"
				>
					{{ error }}
				</p>
			</fieldset>
			<footer class="mt-4 flex shrink-0 justify-end space-x-3 border-t border-border/50 pt-5">
				<UiButton type="button" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
				<UiButton type="button" appearance="soft" tone="warning" :disabled="loading" @click="saveCredential"
					><template #leading><i class="fas fa-key" aria-hidden="true"></i></template
					>{{ t('connections.batchEdit.saveCredential') }}</UiButton
				>
				<UiButton type="submit" appearance="solid" tone="primary" :disabled="loading || !hasMetadataChanges"
					><template #leading><i class="fas fa-save" aria-hidden="true"></i></template
					>{{ t('connections.batchEdit.saveMetadata') }}</UiButton
				>
			</footer>
		</form>
	</UiModal>
</template>
