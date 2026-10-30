<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { ConnectionRoute, ConnectionType } from '@nexus-terminal/shared/targets/connections/values';
	import {
		UiBadge,
		UiButton,
		UiFormActions,
		UiFormField,
		UiCheckbox,
		UiInfoHint,
		UiInput,
		UiInlineNotice,
		UiSegmentedControl,
		UiSelect,
		UiSwitch,
		UiTextarea,
	} from '@/foundation/ui';
	import type { UiSelectOption } from '@/foundation/ui';
	import { useConnectionForm } from '../composables/use-connection-form';
	import type { ConnectionSummary, ConnectionSubmission, CredentialSummary } from '../model/connection-types';
	import type { TargetImportInput } from '@nexus-terminal/shared/targets/connections/http';
	const props = defineProps<{
		connection?: ConnectionSummary | null;
		credential?: CredentialSummary | null;
		loading?: boolean;
	}>();
	const emit = defineEmits<{
		submit: [value: ConnectionSubmission];
		submitMany: [values: TargetImportInput[]];
		cancel: [];
		delete: [];
	}>();
	const { t } = useI18n();
	const {
		form,
		scriptMode,
		script,
		testing,
		parsing,
		testResult,
		submitError,
		proxies,
		ConnectionTagPicker,
		SshKeySelector,
		availableJumpHosts,
		jumpHostsForIndex,
		addJumpHost,
		removeJumpHost,
		submit,
		test,
		removeSavedCredential,
	} = useConnectionForm(props, emit);

	const jumpHostOptions = (index: number): UiSelectOption[] =>
		jumpHostsForIndex(index).map((host) => ({
			value: host.id,
			label: host.name || host.host,
			description: `${host.username ? `${host.username}@` : ''}${host.host}:${host.port}`,
		}));

	const connectionTypeOptions = computed<Array<{ value: ConnectionType; label: string }>>(() => [
		{ value: 'SSH', label: 'SSH' },
		{ value: 'RDP', label: 'RDP' },
		{ value: 'VNC', label: 'VNC' },
	]);

	const authMethodOptions = computed<Array<{ value: 'password' | 'key'; label: string }>>(() => [
		{ value: 'password', label: t('connections.form.authMethodPassword') },
		{ value: 'key', label: t('connections.form.authMethodKey') },
	]);

	const routeOptions = computed<Array<{ value: ConnectionRoute; label: string }>>(() => [
		{ value: 'direct', label: t('connections.form.connectionModeDirect') },
		{ value: 'proxy', label: t('connections.form.connectionModeProxy') },
		{ value: 'jump', label: t('connections.form.connectionModeJumpHost') },
	]);
</script>
<template>
	<form class="connection-form flex min-h-0 flex-1 flex-col" @submit.prevent="submit">
		<h3 class="mb-5 shrink-0 text-lg font-semibold">
			{{ connection ? t('connections.form.titleEdit') : t('connections.form.title') }}
		</h3>

		<fieldset
			:disabled="loading || testing || parsing"
			class="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain pr-1 sm:pr-3"
		>
			<template v-if="!scriptMode">
				<section class="ui-form-section connection-form__section space-y-5">
					<h4>
						{{ t('connections.form.sectionBasic') }}
					</h4>
					<UiFormField :label="`${t('connections.form.name')} (${t('connections.form.optional')})`">
						<UiInput id="conn-name" v-model="form.name" />
					</UiFormField>
					<div>
						<label class="mb-1 block text-sm font-medium text-text-secondary">{{
							t('connections.form.connectionType')
						}}</label>
						<UiSegmentedControl
							v-model="form.type"
							:options="connectionTypeOptions"
							:label="t('connections.form.connectionType')"
						/>
					</div>
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<UiFormField :label="t('connections.form.host')" class="md:col-span-2">
							<UiInput id="conn-host" v-model="form.host" required />
							<p v-if="!connection" class="mt-1 text-xs text-text-secondary">
								<i class="fas fa-exclamation-circle mr-1" aria-hidden="true" />{{
									t('connections.form.hostTooltip')
								}}
							</p>
						</UiFormField>
						<UiFormField :label="t('connections.form.port')">
							<UiInput id="conn-port" v-model="form.port" type="number" min="1" max="65535" required />
						</UiFormField>
					</div>
				</section>

				<section class="ui-form-section connection-form__section space-y-5">
					<h4>
						{{ t('connections.form.sectionAuth') }}
					</h4>
					<UiFormField :label="t('connections.form.username')">
						<UiInput id="conn-username" v-model="form.username" :required="form.type === 'SSH'" />
					</UiFormField>

					<p v-if="connection" class="text-sm text-text-secondary">
						{{
							t('connections.credentialState', {
								kind: t('connections.credentialKinds.' + (credential?.credential.kind ?? 'none')),
							})
						}}
					</p>
					<template v-if="form.type === 'SSH'">
						<div>
							<label class="mb-1 block text-sm font-medium text-text-secondary">{{
								t('connections.form.authMethod')
							}}</label>
							<UiSegmentedControl
								v-model="form.authMethod"
								:options="authMethodOptions"
								:label="t('connections.form.authMethod')"
							/>
						</div>
						<UiFormField v-if="form.authMethod === 'password'" :label="t('connections.form.password')">
							<UiInput
								id="conn-password"
								v-model="form.password"
								:disabled="removeSavedCredential"
								:placeholder="connection ? t('connections.form.keepPassword') : undefined"
								type="password"
								autocomplete="new-password"
							/>
						</UiFormField>
						<UiFormField v-else :label="t('connections.form.sshKey')">
							<SshKeySelector v-model="form.sshKeyId" :disabled="removeSavedCredential" />
							<p
								v-if="credential?.credential.kind === 'ssh_key'"
								class="mt-1 text-xs text-text-secondary"
							>
								{{ t('connections.form.keyUpdateNoteSelected') }}
							</p>
						</UiFormField>
					</template>
					<UiFormField
						v-else
						:label="
							form.type === 'RDP' ? t('connections.form.password') : t('connections.form.vncPassword')
						"
					>
						<UiInput
							:id="form.type === 'RDP' ? 'conn-password-rdp' : 'conn-password-vnc'"
							v-model="form.password"
							:disabled="removeSavedCredential"
							:placeholder="connection ? t('connections.form.keepPassword') : undefined"
							type="password"
							autocomplete="new-password"
						/>
					</UiFormField>
					<label
						v-if="connection && credential && credential.credential.kind !== 'none'"
						class="flex items-center gap-2 text-sm"
					>
						<UiCheckbox v-model="removeSavedCredential" />
						<span>{{ t('connections.clearCredential') }}</span>
					</label>
				</section>

				<section class="ui-form-section connection-form__section space-y-5">
					<h4>
						{{ t('connections.form.sectionAdvanced') }}
					</h4>
					<template v-if="form.type === 'SSH'">
						<div>
							<label class="mb-1 block text-sm font-medium text-text-secondary">{{
								t('connections.form.connectionMode')
							}}</label>
							<UiSegmentedControl
								v-model="form.route"
								class="mb-4"
								:options="routeOptions"
								:label="t('connections.form.connectionMode')"
							/>
						</div>
						<UiFormField
							v-if="form.route === 'proxy'"
							:label="`${t('connections.form.proxy')} (${t('connections.form.optional')})`"
						>
							<UiSelect v-model="form.proxyId">
								<option :value="null">{{ t('connections.form.noProxy') }}</option>
								<option v-for="proxy in proxies.items.value" :key="proxy.id" :value="proxy.id">
									{{ proxy.name }} ({{ proxy.type }} - {{ proxy.host }}:{{ proxy.port }})
								</option>
							</UiSelect>
						</UiFormField>
						<UiFormField v-if="form.route === 'jump'" :label="t('connections.form.jumpHostsTitle')">
							<div class="connection-jump-chain">
								<div v-if="form.jumpIds.length" class="connection-jump-chain__steps">
									<div
										v-for="(jumpHostId, index) in form.jumpIds"
										:key="jumpHostId"
										class="connection-jump-chain__step"
									>
										<span class="connection-jump-chain__index" aria-hidden="true">{{
											index + 1
										}}</span>
										<UiSelect
											v-model="form.jumpIds[index]"
											:options="jumpHostOptions(index)"
											density="comfortable"
											:aria-label="`${t('connections.form.jumpHostLabel')} ${index + 1}`"
											trigger-class="connection-jump-chain__select"
										/>
										<UiButton
											type="button"
											appearance="ghost"
											tone="danger"
											density="compact"
											icon-only
											class="connection-jump-chain__remove"
											:aria-label="t('connections.form.removeJumpHostTitle')"
											:title="t('connections.form.removeJumpHostTitle')"
											@click="removeJumpHost(index)"
										>
											<i class="fas fa-times" aria-hidden="true" />
										</UiButton>
									</div>
								</div>
								<UiButton
									type="button"
									appearance="soft"
									tone="primary"
									density="compact"
									block
									class="connection-jump-chain__add"
									:disabled="form.jumpIds.length >= availableJumpHosts.length"
									@click="addJumpHost"
								>
									<i class="fas fa-plus" aria-hidden="true" />
									{{ t('connections.form.addJumpHost') }}
								</UiButton>
								<p v-if="availableJumpHosts.length === 0" class="connection-jump-chain__empty">
									<i class="fas fa-circle-info" aria-hidden="true" />
									<span>{{ t('connections.form.noAvailableSshConnectionsForJump') }}</span>
								</p>
							</div>
						</UiFormField>
					</template>

					<UiFormField :label="`${t('connections.form.tags')} (${t('connections.form.optional')})`"
						><ConnectionTagPicker v-model="form.tagIds"
					/></UiFormField>
					<UiFormField :label="t('connections.form.notes')"
						><UiTextarea
							id="conn-notes"
							v-model="form.notes"
							:min-rows="3"
							:placeholder="t('connections.form.notesPlaceholder')"
					/></UiFormField>
				</section>
			</template>

			<section v-if="!connection" class="ui-form-section connection-form__section space-y-5">
				<div class="flex items-center justify-between">
					<h4 class="!mb-0">{{ t('connections.form.sectionScriptMode') }}</h4>
					<UiSwitch v-model="scriptMode" :aria-label="t('connections.form.sectionScriptMode')" />
				</div>
				<div v-if="scriptMode" class="mt-4">
					<UiTextarea
						id="conn-script-input"
						v-model="script"
						:min-rows="10"
						class="font-mono"
						:placeholder="t('connections.form.scriptModePlaceholder')"
					/>
					<p class="mt-1 whitespace-pre-line text-xs text-text-secondary">
						{{ t('connections.form.scriptModeFormatInfo') }}
					</p>
					<p class="mt-2 text-xs text-text-secondary">{{ t('connections.scriptHelp') }}</p>
				</div>
			</section>

			<UiInlineNotice v-if="submitError" tone="danger">{{ submitError }}</UiInlineNotice>
		</fieldset>

		<footer class="connection-form__footer">
			<div v-if="!scriptMode && form.type === 'SSH'" class="connection-form__test-row">
				<UiButton type="button" appearance="soft" :loading="testing" @click="test">{{
					t('connections.form.testConnection')
				}}</UiButton>
				<UiInfoHint :text="t('connections.test.latencyTooltip')" side="top" align="start" />
				<UiBadge
					v-if="testResult"
					class="min-w-0"
					:tone="testResult.success ? 'success' : 'danger'"
					density="compact"
					:title="testResult.message"
				>
					<i
						:class="['fas', testResult.success ? 'fa-check-circle' : 'fa-times-circle']"
						aria-hidden="true"
					/>
					<span>{{
						testResult.success ? t('connections.test.successShort') : t('connections.test.failedShort')
					}}</span>
					<span v-if="testResult.success && testResult.latencyMs != null" class="font-normal opacity-80">
						· {{ testResult.latencyMs }} ms
					</span>
					<span v-else-if="!testResult.success" class="max-w-64 truncate font-normal opacity-90">
						· {{ testResult.message }}
					</span>
				</UiBadge>
			</div>
			<div v-else class="flex-1" />
			<UiFormActions class="ml-auto">
				<UiButton
					v-if="connection && !scriptMode"
					type="button"
					appearance="solid"
					tone="danger"
					:disabled="loading || testing"
					@click="emit('delete')"
					>{{ t('connections.actions.delete') }}</UiButton
				>
				<UiButton
					type="submit"
					appearance="solid"
					tone="primary"
					:loading="loading"
					:disabled="testing || parsing"
					>{{ connection ? t('connections.form.confirmEdit') : t('connections.form.confirm') }}</UiButton
				>
				<UiButton type="button" :disabled="loading || testing" @click="emit('cancel')">{{
					t('connections.form.cancel')
				}}</UiButton>
			</UiFormActions>
		</footer>
	</form>
</template>

<style scoped>
	.connection-form__test-row {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.connection-form__footer {
		display: flex;
		flex: 0 0 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 16px;
		margin-top: 20px;
		padding-top: 18px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 48%, transparent);
	}

	.connection-form__section {
		padding-top: 1.125rem;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	.connection-form__section:first-of-type {
		padding-top: 0.125rem;
		border-top: 0;
	}

	.connection-form__section > h4 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.connection-form__section > h4::before {
		width: 2px;
		height: 0.85rem;
		flex: 0 0 auto;
		border-radius: 999px;
		background: color-mix(in srgb, var(--link-active-color) 72%, transparent);
		content: '';
	}

	.connection-jump-chain {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 8px;
	}

	.connection-jump-chain__steps {
		position: relative;
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 6px;
	}

	.connection-jump-chain__steps::before {
		position: absolute;
		top: 22px;
		bottom: 22px;
		left: 14px;
		width: 1px;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--link-active-color) 30%, transparent),
			color-mix(in srgb, var(--border-color) 48%, transparent)
		);
		content: '';
	}

	.connection-jump-chain__step {
		position: relative;
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) 28px;
		align-items: center;
		gap: 9px;
		min-width: 0;
		padding: 4px 4px 4px 1px;
	}

	.connection-jump-chain__index {
		position: relative;
		z-index: 1;
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border-radius: 999px;
		background: color-mix(in srgb, var(--link-active-color) 12%, var(--app-bg-color));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--link-active-color) 24%, transparent);
		color: var(--link-active-color);
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.connection-jump-chain__step :deep(.connection-jump-chain__select) {
		border-color: color-mix(in srgb, var(--border-color) 44%, transparent);
		background: color-mix(in srgb, var(--card-bg-color) 26%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-rim) 5%, transparent);
	}

	.connection-jump-chain__step :deep(.connection-jump-chain__select:hover) {
		border-color: color-mix(in srgb, var(--border-color) 66%, transparent);
	}

	.connection-jump-chain__remove {
		justify-self: end;
		opacity: 0.58;
	}

	.connection-jump-chain__step:hover .connection-jump-chain__remove,
	.connection-jump-chain__remove:focus-visible {
		opacity: 1;
	}

	.connection-jump-chain__add {
		justify-content: flex-start;
		color: var(--link-active-color);
	}

	.connection-jump-chain__empty {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		padding: 2px 4px 0;
		color: var(--text-color-secondary);
		font-size: 11px;
		line-height: 1.5;
	}

	.connection-jump-chain__empty i {
		margin-top: 2px;
		color: var(--status-warning-color);
	}

	@media (max-width: 639px) {
		.connection-form__test-row {
			width: 100%;
		}
	}
</style>
