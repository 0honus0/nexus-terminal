<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiModal, UiTextarea } from '@/foundation/ui';
	import { useSshKeyManagement } from '../composables/use-ssh-key-management';
	const visible = defineModel<boolean>({ default: false });
	const { t } = useI18n();
	const {
		keys,
		editing,
		showForm,
		form,
		message,
		loading,
		keyFileInput,
		reset,
		edit,
		submit,
		remove,
		refresh,
		chooseKeyFile,
		loadKeyFile,
	} = useSshKeyManagement(visible);
</script>
<template>
	<UiModal
		:visible="visible"
		:z-index="160"
		panel-class="w-[calc(100vw-2rem)] max-w-3xl max-h-[90dvh] sm:w-full"
		content-class="!overflow-hidden !py-0"
		@close="visible = false"
	>
		<div class="flex max-h-[68vh] min-h-0 flex-col">
			<template v-if="!showForm">
				<h3 class="mb-4 shrink-0 text-center text-xl font-semibold">{{ t('sshKeys.modal.title') }}</h3>
				<div class="mb-4 flex shrink-0 justify-end">
					<UiButton
						appearance="solid"
						tone="primary"
						:disabled="loading || keys.busy.value || keys.needsRefresh.value"
						@click="edit()"
						><template #leading><i class="fas fa-plus !text-white" aria-hidden="true" /></template
						>{{ t('sshKeys.modal.addKey') }}</UiButton
					>
				</div>
				<p
					v-if="message"
					role="alert"
					class="mb-3 shrink-0 break-words rounded-md border border-error/30 bg-error/10 p-3 text-sm font-medium text-error"
				>
					{{ message }}
				</p>
				<div
					v-if="keys.needsRefresh.value"
					class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
				>
					<p>{{ t('sshKeys.failures.recovery_required') }}</p>
					<UiButton :disabled="loading || keys.busy.value" @click="refresh">{{
						t('sshKeys.refresh')
					}}</UiButton>
				</div>
				<div class="max-h-[50vh] flex-grow overflow-y-auto rounded-md border border-border">
					<table class="w-full table-fixed divide-y divide-border">
						<thead class="sticky top-0 bg-header">
							<tr>
								<th
									class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-secondary"
								>
									{{ t('sshKeys.modal.keyName') }}
								</th>
								<th
									class="w-20 px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-secondary sm:px-6"
								>
									{{ t('sshKeys.modal.actions') }}
								</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border bg-background">
							<tr v-if="loading">
								<td colspan="2" class="px-6 py-4 text-center text-sm text-text-secondary">
									{{ t('sshKeys.modal.loading') }}
								</td>
							</tr>
							<tr v-else-if="keys.keys.value.length === 0">
								<td colspan="2" class="px-6 py-4 text-center text-sm text-text-secondary">
									{{ t('sshKeys.modal.noKeys') }}
								</td>
							</tr>
							<tr v-for="key in keys.keys.value" :key="key.id" :data-key-id="key.id">
								<td
									class="break-all px-3 py-4 text-sm font-medium text-foreground sm:break-words sm:px-6"
								>
									{{ key.name }}
								</td>
								<td class="space-x-2 px-3 py-4 text-right text-sm font-medium sm:px-6">
									<button
										type="button"
										class="text-primary hover:text-link-hover disabled:opacity-50"
										:disabled="loading || keys.busy.value || keys.needsRefresh.value"
										:title="t('sshKeys.modal.edit')"
										@click="edit(key)"
									>
										<i class="fas fa-pencil-alt" aria-hidden="true" /></button
									><button
										type="button"
										class="text-error hover:opacity-80 disabled:opacity-50"
										:disabled="loading || keys.busy.value || keys.needsRefresh.value"
										:title="t('sshKeys.modal.delete')"
										@click="remove(key)"
									>
										<i class="fas fa-trash-alt" aria-hidden="true" />
									</button>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div class="mt-6 shrink-0 text-right">
					<UiButton :disabled="loading" @click="visible = false">{{ t('sshKeys.modal.close') }}</UiButton>
				</div>
			</template>

			<template v-else>
				<h3 class="mb-6 shrink-0 text-center text-xl font-semibold">
					{{ editing ? t('sshKeys.modal.editTitle') : t('sshKeys.modal.addTitle') }}
				</h3>
				<p v-if="message" role="alert" class="mb-3 shrink-0 break-words text-sm text-error">{{ message }}</p>
				<div
					v-if="keys.needsRefresh.value"
					class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
				>
					<p>{{ t('sshKeys.failures.recovery_required') }}</p>
					<UiButton :disabled="loading || keys.busy.value" @click="refresh">{{
						t('sshKeys.refresh')
					}}</UiButton>
				</div>
				<form class="flex-grow overflow-y-auto pr-2" @submit.prevent="submit">
					<fieldset class="space-y-4" :disabled="loading || keys.busy.value || keys.needsRefresh.value">
						<UiFormField :label="t('sshKeys.modal.keyName')"
							><UiInput id="key-name" v-model="form.name" required
						/></UiFormField>
						<UiFormField :label="t('sshKeys.modal.privateKey')">
							<div class="mb-2 flex flex-wrap items-center gap-2">
								<input ref="keyFileInput" type="file" class="hidden" @change="loadKeyFile" />
								<UiButton type="button" :disabled="loading" @click="chooseKeyFile">
									<template #leading><i class="fas fa-upload" aria-hidden="true" /></template>
									{{ t('sshKeys.modal.chooseKeyFile') }}
								</UiButton>
								<span class="text-xs text-text-secondary">{{ t('sshKeys.modal.keyInputHint') }}</span>
							</div>
							<UiTextarea
								id="key-private"
								v-model="form.privateKey"
								:min-rows="8"
								:required="!editing"
								class="font-mono text-sm"
							/>
						</UiFormField>
						<UiFormField :label="`${t('sshKeys.modal.passphrase')} (${t('connections.form.optional')})`"
							><UiInput
								id="key-passphrase"
								v-model="form.passphrase"
								type="password"
								autocomplete="new-password"
						/></UiFormField>
						<p v-if="editing" class="text-xs text-text-secondary">
							{{ t('sshKeys.modal.keyUpdateNote') }} {{ t('sshKeys.modal.passphraseUpdateNote') }}
						</p>
						<label v-if="editing" class="flex items-center gap-2 text-sm"
							><UiCheckbox v-model="form.clearPassphrase" />{{
								t('sshKeys.modal.clearPassphrase')
							}}</label
						>
					</fieldset>
				</form>
				<div class="mt-4 flex shrink-0 justify-end space-x-3 border-t border-border/50 pt-5">
					<UiButton :disabled="loading" @click="reset">{{ t('sshKeys.modal.cancel') }}</UiButton
					><UiButton
						appearance="solid"
						tone="primary"
						:disabled="loading || keys.busy.value || keys.needsRefresh.value"
						@click="submit"
						>{{ editing ? t('sshKeys.modal.saveChanges') : t('sshKeys.modal.addKey') }}</UiButton
					>
				</div>
			</template>
		</div>
	</UiModal>
</template>
