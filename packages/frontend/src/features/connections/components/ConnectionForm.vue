<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput, UiSelect, UiTextarea } from '@/foundation/ui';
	import { useConnectionForm } from '../composables/use-connection-form';
	import type { ConnectionSummary, ConnectionSubmission, CredentialSummary } from '../model/connection-types';
	import type { TargetImportInput, TargetCredentialInput } from '@nexus-terminal/shared/targets/connections/http';
	const props = defineProps<{
		connection?: ConnectionSummary | null;
		credential?: CredentialSummary | null;
		loading?: boolean;
	}>();
	const emit = defineEmits<{
		submit: [value: ConnectionSubmission];
		submitMany: [values: TargetImportInput[]];
		credential: [value: TargetCredentialInput | null];
		cancel: [];
		delete: [];
	}>();
	const { t } = useI18n();
	const {
		form,
		remoteAppEnabled,
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
		saveCredential,
		clearCredential,
	} = useConnectionForm(props, emit);
</script>
<template>
	<form class="connection-form flex max-h-[82dvh] min-h-0 flex-col" @submit.prevent="submit">
		<h3 class="mb-5 shrink-0 text-lg font-semibold">
			{{ connection ? t('connections.form.titleEdit') : t('connections.form.title') }}
		</h3>

		<fieldset :disabled="loading || testing || parsing" class="flex-grow space-y-7 overflow-y-auto pr-1 sm:pr-3">
			<template v-if="!scriptMode">
				<section class="ui-form-section space-y-5">
					<h4 class="mb-3 text-sm font-semibold">
						{{ t('connections.form.sectionBasic') }}
					</h4>
					<UiFormField :label="`${t('connections.form.name')} (${t('connections.form.optional')})`">
						<UiInput id="conn-name" v-model="form.name" />
					</UiFormField>
					<div>
						<label class="mb-1 block text-sm font-medium text-text-secondary">{{
							t('connections.form.connectionType')
						}}</label>
						<div class="connection-form-segmented flex rounded-lg p-1">
							<button
								type="button"
								class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium focus:outline-none"
								:class="
									form.type === 'SSH'
										? 'bg-primary text-white'
										: 'bg-background text-foreground hover:bg-border'
								"
								@click="form.type = 'SSH'"
							>
								SSH
							</button>
							<button
								type="button"
								class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium focus:outline-none"
								:class="
									form.type === 'RDP'
										? 'bg-primary text-white'
										: 'bg-background text-foreground hover:bg-border'
								"
								@click="form.type = 'RDP'"
							>
								RDP
							</button>
							<button
								type="button"
								class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium focus:outline-none"
								:class="
									form.type === 'VNC'
										? 'bg-primary text-white'
										: 'bg-background text-foreground hover:bg-border'
								"
								@click="form.type = 'VNC'"
							>
								VNC
							</button>
						</div>
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

				<section class="ui-form-section space-y-5">
					<h4 class="mb-3 border-b border-border/50 pb-2 text-base font-semibold">
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
							<div class="connection-form-segmented flex rounded-lg p-1">
								<button
									type="button"
									class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium focus:outline-none"
									:class="
										form.authMethod === 'password'
											? 'bg-primary text-white'
											: 'bg-background text-foreground hover:bg-border'
									"
									@click="form.authMethod = 'password'"
								>
									{{ t('connections.form.authMethodPassword') }}
								</button>
								<button
									type="button"
									class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium focus:outline-none"
									:class="
										form.authMethod === 'key'
											? 'bg-primary text-white'
											: 'bg-background text-foreground hover:bg-border'
									"
									@click="form.authMethod = 'key'"
								>
									{{ t('connections.form.authMethodKey') }}
								</button>
							</div>
						</div>
						<UiFormField v-if="form.authMethod === 'password'" :label="t('connections.form.password')">
							<UiInput
								id="conn-password"
								v-model="form.password"
								type="password"
								autocomplete="new-password"
							/>
						</UiFormField>
						<UiFormField v-else :label="t('connections.form.sshKey')">
							<SshKeySelector v-model="form.sshKeyId" />
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
							type="password"
							autocomplete="new-password"
						/>
					</UiFormField>
					<div v-if="connection" class="flex flex-wrap gap-2">
						<UiButton type="button" @click="saveCredential">{{ t('connections.saveCredential') }}</UiButton
						><UiButton type="button" tone="danger" @click="clearCredential">{{
							t('connections.clearCredential')
						}}</UiButton>
						<p class="text-sm text-text-secondary">{{ t('connections.separateSaves') }}</p>
					</div>
				</section>

				<section class="ui-form-section space-y-5">
					<h4 class="mb-3 border-b border-border/50 pb-2 text-base font-semibold">
						{{ t('connections.form.sectionAdvanced') }}
					</h4>
					<template v-if="form.type === 'SSH'">
						<div>
							<label class="mb-1 block text-sm font-medium text-text-secondary">{{
								t('connections.form.connectionMode')
							}}</label>
							<div class="connection-form-segmented mb-4 flex rounded-lg p-1">
								<button
									type="button"
									class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium"
									:class="
										form.route === 'direct'
											? 'bg-primary text-white'
											: 'bg-background text-foreground hover:bg-border'
									"
									@click="form.route = 'direct'"
								>
									{{ t('connections.form.connectionModeDirect') }}
								</button>
								<button
									type="button"
									class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium"
									:class="
										form.route === 'proxy'
											? 'bg-primary text-white'
											: 'bg-background text-foreground hover:bg-border'
									"
									@click="form.route = 'proxy'"
								>
									{{ t('connections.form.connectionModeProxy') }}
								</button>
								<button
									type="button"
									class="connection-form-segment flex-1 px-3 py-2 text-sm font-medium"
									:class="
										form.route === 'jump'
											? 'bg-primary text-white'
											: 'bg-background text-foreground hover:bg-border'
									"
									@click="form.route = 'jump'"
								>
									{{ t('connections.form.connectionModeJumpHost') }}
								</button>
							</div>
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
						<div v-if="form.route === 'jump'" class="space-y-3">
							<label class="mb-1 block text-sm font-medium text-text-secondary">{{
								t('connections.form.jumpHostsTitle')
							}}</label>
							<div
								v-for="(jumpHostId, index) in form.jumpIds"
								:key="index"
								class="flex items-center space-x-2 rounded-md border border-border bg-background/50 p-2"
							>
								<span class="whitespace-nowrap text-sm font-medium text-text-secondary"
									>{{ t('connections.form.jumpHostLabel') }} {{ index + 1 }}:</span
								>
								<UiSelect v-model="form.jumpIds[index]" class="min-w-0 flex-1">
									<option v-for="host in jumpHostsForIndex(index)" :key="host.id" :value="host.id">
										{{ host.name || host.host }}
									</option>
								</UiSelect>
								<button
									type="button"
									class="rounded-md p-1.5 text-error hover:opacity-80"
									:title="t('connections.form.removeJumpHostTitle')"
									@click="removeJumpHost(index)"
								>
									<i class="fas fa-times" aria-hidden="true" />
								</button>
							</div>
							<button
								type="button"
								class="flex w-full items-center justify-center space-x-2 rounded-md border border-dashed border-primary px-3 py-2 text-primary hover:bg-primary/10 disabled:opacity-50"
								:disabled="form.jumpIds.length >= availableJumpHosts.length"
								@click="addJumpHost"
							>
								<i class="fas fa-plus" aria-hidden="true" /><span>{{
									t('connections.form.addJumpHost')
								}}</span>
							</button>
							<p
								v-if="availableJumpHosts.length === 0"
								class="rounded-md bg-warning/20 p-2 text-xs text-warning"
							>
								{{ t('connections.form.noAvailableSshConnectionsForJump') }}
							</p>
						</div>
					</template>

					<div
						v-if="form.type === 'RDP'"
						class="space-y-3 rounded-md border border-border/70 bg-background/50 p-3"
					>
						<button
							type="button"
							role="switch"
							:aria-checked="remoteAppEnabled"
							class="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm font-medium"
							@click="remoteAppEnabled = !remoteAppEnabled"
						>
							<span>{{ t('connections.form.remoteAppEnabled') }}</span>
							<span
								aria-hidden="true"
								class="relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors"
								:class="remoteAppEnabled ? 'bg-primary' : 'bg-border/60'"
								><span
									class="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
									:class="remoteAppEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'"
							/></span>
						</button>
						<div v-if="remoteAppEnabled" class="space-y-3">
							<UiFormField :label="t('connections.form.remoteAppAlias')"
								><UiInput v-model="form.remoteApp"
							/></UiFormField>
							<UiFormField
								:label="`${t('connections.form.remoteAppDir')} (${t('connections.form.optional')})`"
								><UiInput v-model="form.remoteAppDirectory"
							/></UiFormField>
							<UiFormField
								:label="`${t('connections.form.remoteAppArgs')} (${t('connections.form.optional')})`"
								><UiInput v-model="form.remoteAppArguments"
							/></UiFormField>
						</div>
					</div>

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

			<section v-if="!connection" class="ui-form-section mt-7 space-y-5">
				<div class="flex items-center justify-between">
					<h4 class="text-base font-semibold">{{ t('connections.form.sectionScriptMode') }}</h4>
					<button
						type="button"
						role="switch"
						:aria-label="t('connections.form.sectionScriptMode')"
						:aria-checked="scriptMode"
						class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
						:class="scriptMode ? 'bg-primary' : 'bg-gray-300'"
						@click="scriptMode = !scriptMode"
					>
						<span
							aria-hidden="true"
							class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
							:class="scriptMode ? 'translate-x-5' : 'translate-x-0'"
						/>
					</button>
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

			<p
				v-if="submitError"
				class="rounded-md border border-error/30 bg-error/10 p-3 text-center text-sm font-medium text-error"
			>
				{{ submitError }}
			</p>
		</fieldset>

		<footer class="mt-7 flex shrink-0 flex-wrap items-center gap-4 border-t border-border/50 pt-5">
			<div v-if="!scriptMode && form.type === 'SSH'" class="flex min-w-0 items-center gap-2">
				<UiButton type="button" density="compact" :loading="testing" @click="test">{{
					t('connections.form.testConnection')
				}}</UiButton>
				<span
					v-if="testResult"
					class="inline-flex min-w-0 items-center gap-1 text-xs font-medium"
					:class="testResult.success ? 'text-success' : 'text-error'"
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
				</span>
			</div>
			<div v-else class="flex-1" />
			<div class="ml-auto flex space-x-3">
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
			</div>
			<p v-if="!scriptMode && form.type === 'SSH'" class="w-full text-xs leading-relaxed text-text-secondary">
				<i class="fas fa-info-circle mr-1.5" aria-hidden="true"></i>{{ t('connections.test.latencyTooltip') }}
			</p>
		</footer>
	</form>
</template>

<style scoped>
	.connection-form-segmented {
		gap: 0.25rem;
		border: 1px solid color-mix(in srgb, var(--border-color) 56%, transparent);
		background: color-mix(in srgb, var(--header-bg-color) 56%, var(--app-bg-color));
		box-shadow: inset 0 1px 2px color-mix(in srgb, var(--text-color) 5%, transparent);
	}

	.connection-form-segment {
		margin: 0;
		border: 0 !important;
		border-radius: 0.5rem !important;
		background: transparent !important;
		color: var(--text-color-secondary) !important;
	}

	.connection-form-segment:hover {
		background: color-mix(in srgb, var(--card-bg-color) 76%, var(--app-bg-color)) !important;
		color: var(--text-color) !important;
	}

	.connection-form-segment.bg-primary {
		background: color-mix(in srgb, var(--link-active-color) 16%, var(--card-bg-color)) !important;
		color: var(--link-active-color) !important;
		box-shadow:
			0 1px 2px color-mix(in srgb, var(--text-color) 8%, transparent),
			inset 0 0 0 1px color-mix(in srgb, var(--link-active-color) 24%, transparent);
	}
</style>
