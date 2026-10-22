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
		panel-class="ui-form-surface !max-w-2xl !p-4 sm:!p-6 lg:!p-7"
		:panel-style="{ maxHeight: 'min(760px, calc(100dvh - 2rem))' }"
		content-class="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !py-0"
		@close="emit('close')"
	>
		<form id="batch-connection-editor" class="flex min-h-0 flex-1 flex-col" @submit.prevent="saveMetadata">
			<h3 class="mb-5 shrink-0 text-lg font-semibold">
				{{ t('connections.batchEdit.title') }} ({{ t('connections.batchEdit.selectedItems', { count }) }})
			</h3>
			<fieldset :disabled="loading" class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 sm:pr-3">
				<p class="connection-batch__hint">
					<i class="fas fa-circle-info" aria-hidden="true" />
					<span>{{ t('connections.separateSaves') }}</span>
				</p>
				<section class="ui-form-section connection-batch__section">
					<div class="connection-batch__section-title">
						<h4 class="!mb-0">{{ t('connections.table.port') }}</h4>
						<UiCheckbox v-model="editPort" :aria-label="t('connections.form.port')" />
					</div>
					<UiFormField v-if="editPort" :label="t('connections.form.port')"
						><UiInput v-model="port" type="number" min="1" max="65535"
					/></UiFormField>
				</section>
				<section class="ui-form-section connection-batch__section">
					<div class="connection-batch__section-title">
						<h4 class="!mb-0">{{ t('connections.form.sectionAuth') }}</h4>
						<UiCheckbox v-model="editUsername" :aria-label="t('connections.form.username')" />
					</div>
					<UiFormField v-if="editUsername" :label="t('connections.form.username')"
						><UiInput v-model="username" :placeholder="t('connections.batchEdit.leaveBlankNoChange')"
					/></UiFormField>
				</section>
				<section class="ui-form-section connection-batch__section">
					<div class="connection-batch__section-title">
						<h4 class="!mb-0">{{ t('connections.form.sectionAdvanced') }}</h4>
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
							<label class="connection-batch__toggle"
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
							<label class="connection-batch__toggle"
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
				<section class="ui-form-section connection-batch__section space-y-3">
					<h4>{{ t('connections.credentials') }}</h4>
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
				<p v-if="error" class="connection-batch__error" role="alert">
					{{ error }}
				</p>
			</fieldset>
			<footer class="connection-batch__footer">
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

<style scoped>
	.connection-batch__hint {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		margin-bottom: 4px;
		color: var(--text-color-secondary);
		font-size: 12px;
		line-height: 1.55;
	}

	.connection-batch__hint i {
		margin-top: 2px;
		flex: 0 0 auto;
		opacity: 0.72;
	}

	.connection-batch__section {
		padding-top: 18px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	.connection-batch__section:first-of-type {
		padding-top: 10px;
		border-top: 0;
	}

	.connection-batch__section-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 12px;
	}

	.connection-batch__section h4 {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.connection-batch__section h4::before {
		width: 2px;
		height: 0.85rem;
		flex: 0 0 auto;
		border-radius: 999px;
		background: color-mix(in srgb, var(--link-active-color) 72%, transparent);
		content: '';
	}

	.connection-batch__toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
		color: var(--text-color-secondary);
		font-size: 12px;
		font-weight: 500;
	}

	.connection-batch__error {
		margin-top: 12px;
		padding: 9px 12px;
		border-radius: 9px;
		background: color-mix(in srgb, var(--status-error-color) 10%, transparent);
		color: var(--status-error-color);
		font-size: 12px;
		line-height: 1.5;
		text-align: center;
	}

	.connection-batch__footer {
		display: flex;
		flex: 0 0 auto;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 12px;
		margin-top: 20px;
		padding-top: 20px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
	}

	@media (max-width: 640px) {
		.connection-batch__footer {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 8px;
		}

		.connection-batch__footer > :last-child {
			grid-column: 1 / -1;
		}

		.connection-batch__footer :deep(.ui-button) {
			width: 100%;
		}
	}
</style>
