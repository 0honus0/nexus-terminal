<script setup lang="ts">
	import { computed, onActivated, onMounted, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiModal } from '@/foundation/ui';
	import { useConnections } from '@/features/connections/public';
	import { AGENT_INTEGRATION_MAX_ITEMS } from '@nexus-terminal/shared/agent/integrations/values';
	import { useAppIntegrations } from '../composables/use-app-integrations';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';

	const props = withDefaults(defineProps<{ appId: string; active?: boolean }>(), { active: true });
	const { t } = useI18n();
	const {
		items,
		editorOpen,
		closeEditor,
		original,
		draft,
		discovery,
		deleteId,
		pendingCreate,
		needsReload,
		operation,
		blocked,
		load,
		resetDraft,
		edit,
		save,
		remove,
		discover,
	} = useAppIntegrations(props.appId, () => props.active);
	const connections = useConnections();
	const directoryOperation = useAgentManagementOperation(undefined, () => props.active);
	const sshTargets = computed(() => connections.connections.value.filter((item) => item.type === 'SSH'));
	const missingTarget = computed(
		() => draft.value.connectionId > 0 && !sshTargets.value.some((item) => item.id === draft.value.connectionId),
	);

	async function loadTargets(): Promise<void> {
		await directoryOperation.execute(
			() => connections.load(),
			() => {},
			{ write: false },
		);
	}

	function initialTargets(): void {
		if (props.active && directoryOperation.refreshRequired.value) {
			void loadTargets();
		}
	}

	watch(() => props.active, initialTargets);
	onMounted(initialTargets);
	onActivated(initialTargets);
</script>
<template>
	<div class="space-y-4">
		<p class="text-sm text-text-secondary">{{ t('agent.settings.integrationManagement.help') }}</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="operation.refreshRequired.value || needsReload" class="text-sm text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<p v-if="pendingCreate" class="text-sm text-warning">{{ t('agent.settings.integrationManagement.pending') }}</p>
		<div class="flex justify-end gap-2">
			<UiButton v-if="pendingCreate" type="button" :disabled="operation.busy.value" @click="editorOpen = true">{{
				t('common.edit')
			}}</UiButton>
			<UiButton
				v-else
				type="button"
				appearance="soft"
				:disabled="blocked || items.length >= AGENT_INTEGRATION_MAX_ITEMS"
				@click="resetDraft"
				><i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i
				>{{ t('agent.settings.integrationManagement.create') }}</UiButton
			>
		</div>
		<UiButton
			v-if="operation.refreshRequired.value || needsReload || operation.notice.value === 'failed'"
			type="button"
			:disabled="operation.busy.value"
			@click="load"
			>{{ t('agent.settings.integrationManagement.reload') }}</UiButton
		>
		<fieldset :disabled="blocked || pendingCreate || original !== null" class="space-y-3">
			<p v-if="items.length === 0" class="text-sm">{{ t('agent.settings.integrationManagement.empty') }}</p>
			<article
				v-for="item in items"
				:key="item.id"
				class="space-y-3.5 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-2xs"
			>
				<div class="flex min-w-0 items-start gap-3 sm:items-center">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-2xs"
					>
						<i class="fa-solid fa-plug text-sm" aria-hidden="true"></i>
					</div>
					<div class="min-w-0 flex-1 space-y-1.5">
						<div class="flex flex-wrap items-center gap-2">
							<h4
								class="break-words rounded-xl border border-border/90 bg-background/90 px-3 py-1 text-sm font-bold text-foreground shadow-2xs sm:text-base"
							>
								{{ item.configuration.name }}
							</h4>
							<span
								class="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-text-secondary"
							>
								{{ item.configuration.kind.toUpperCase() }}
							</span>
							<span
								class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
								:class="
									item.enabled
										? 'border-success/30 bg-success/10 text-success'
										: 'border-border text-text-secondary'
								"
							>
								{{
									t(
										item.enabled
											? 'agent.settings.providers.enabled'
											: 'agent.settings.providers.disabled',
									)
								}}
							</span>
						</div>
						<p class="break-all font-mono text-[11px] text-text-secondary">
							{{
								item.configuration.kind === 'mcp' ? item.configuration.endpoint : item.configuration.cwd
							}}
						</p>
						<p v-if="item.configuration.kind === 'mcp'" class="text-xs text-text-secondary">
							{{
								t(
									item.hasCredential
										? 'agent.settings.providers.credentialStored'
										: 'agent.settings.providers.noCredential',
								)
							}}
						</p>
					</div>
				</div>
				<div class="flex flex-wrap gap-2">
					<UiButton type="button" @click="edit(item.id)">{{ t('common.edit') }}</UiButton>
					<UiButton v-if="item.configuration.kind === 'mcp'" type="button" @click="discover(item)">{{
						t('agent.settings.integrationManagement.discover')
					}}</UiButton>
					<UiButton type="button" @click="deleteId = item.id">{{ t('common.delete') }}</UiButton>
					<template v-if="deleteId === item.id">
						<UiButton type="button" @click="remove(item)">{{
							t('agent.settings.integrationManagement.confirmDelete')
						}}</UiButton>
						<UiButton type="button" @click="deleteId = null">{{ t('common.cancel') }}</UiButton>
					</template>
				</div>
			</article>
		</fieldset>

		<article v-if="discovery" class="space-y-2 rounded border border-border p-3">
			<h4>{{ discovery.serverName }} · {{ discovery.serverVersion }} · {{ discovery.protocolVersion }}</h4>
			<h5>{{ t('agent.settings.integrationManagement.tools') }} ({{ discovery.tools.length }})</h5>
			<details v-for="tool in discovery.tools" :key="tool.name">
				<summary>{{ tool.name }}</summary>
				<p class="whitespace-pre-wrap break-words text-sm">{{ tool.description }}</p>
				<pre class="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">{{
					tool.inputSchemaJson
				}}</pre>
			</details>
			<h5>{{ t('agent.settings.integrationManagement.resources') }} ({{ discovery.resources.length }})</h5>
			<p v-for="(resource, index) in discovery.resources" :key="index" class="break-all text-xs">
				{{ resource.name }} · {{ resource.uri }}
			</p>
			<h5>{{ t('agent.settings.integrationManagement.prompts') }} ({{ discovery.prompts.length }})</h5>
			<details v-for="(prompt, index) in discovery.prompts" :key="index">
				<summary>{{ prompt.name }}</summary>
				<p class="whitespace-pre-wrap break-words text-sm">{{ prompt.description }}</p>
			</details>
		</article>
	</div>
	<UiModal
		:visible="active && editorOpen"
		:title="original ? t('common.edit') : t('agent.settings.integrationManagement.create')"
		:close-on-backdrop="!operation.busy.value && !pendingCreate"
		:close-on-escape="!operation.busy.value && !pendingCreate"
		panel-class="max-w-xl p-5 sm:p-6 rounded-2xl"
		@close="closeEditor"
	>
		<form id="integration-editor" class="space-y-4" @submit.prevent="save">
			<p v-if="operation.notice.value" role="status" class="text-sm">
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<p v-if="pendingCreate" role="status" class="text-sm text-warning">
				{{ t('agent.settings.integrationManagement.pending') }}
			</p>
			<UiButton
				v-if="operation.refreshRequired.value || needsReload"
				type="button"
				:disabled="operation.busy.value"
				@click="load"
				>{{ t('agent.settings.integrationManagement.reload') }}</UiButton
			>
			<fieldset :disabled="blocked || pendingCreate" class="space-y-3">
				<label class="block text-sm"
					>{{ t('agent.settings.integrationManagement.kind')
					}}<select
						v-model="draft.kind"
						:disabled="original !== null"
						class="ml-2 rounded border border-border bg-background p-2"
					>
						<option value="mcp">MCP</option>
						<option value="acp">ACP</option>
					</select></label
				>
				<label class="block text-sm"
					>{{ t('agent.settings.appManagement.name')
					}}<input v-model="draft.name" class="mt-1 w-full rounded border border-border bg-background p-2"
				/></label>
				<label class="flex items-center gap-2 text-sm">
					<UiCheckbox
						v-model="draft.enabled"
						:aria-label="t('agent.settings.integrationManagement.enabled')"
					/>
					<span>{{ t('agent.settings.integrationManagement.enabled') }}</span>
				</label>
				<template v-if="draft.kind === 'mcp'">
					<label class="block text-sm"
						>{{ t('agent.settings.integrationManagement.endpoint')
						}}<input
							v-model="draft.endpoint"
							class="mt-1 w-full rounded border border-border bg-background p-2 font-mono"
					/></label>
					<label class="block text-sm"
						>{{ t('agent.settings.integrationManagement.privateHosts')
						}}<textarea
							v-model="draft.privateHostsText"
							rows="3"
							class="mt-1 w-full rounded border border-border bg-background p-2 font-mono"
						/>
					</label>
					<label class="block text-sm"
						>{{ t('agent.settings.integrationManagement.credential')
						}}<select
							v-model="draft.credentialAction"
							class="ml-2 rounded border border-border bg-background p-2"
						>
							<option v-if="original" value="keep">
								{{ t('agent.settings.integrationManagement.keep') }}
							</option>
							<option value="clear">{{ t('agent.settings.integrationManagement.clear') }}</option>
							<option value="replace">{{ t('agent.settings.integrationManagement.replace') }}</option>
						</select></label
					>
					<input
						v-if="draft.credentialAction === 'replace'"
						v-model="draft.credential"
						type="password"
						autocomplete="new-password"
						:aria-label="t('agent.settings.integrationManagement.credential')"
						class="w-full rounded border border-border bg-background p-2"
					/>
				</template>
				<template v-else>
					<UiButton
						v-if="directoryOperation.refreshRequired.value || directoryOperation.notice.value === 'failed'"
						type="button"
						:disabled="directoryOperation.busy.value"
						@click="loadTargets"
						>{{ t('agent.settings.appManagement.readTargets') }}</UiButton
					>
					<p v-if="directoryOperation.notice.value" role="alert">
						{{ t('agent.settings.appManagement.targetsFailed') }}
					</p>
					<label class="block text-sm"
						>{{ t('agent.settings.integrationManagement.connection')
						}}<select
							v-model.number="draft.connectionId"
							class="mt-1 w-full rounded border border-border bg-background p-2"
						>
							<option :value="0">{{ t('agent.settings.integrationManagement.chooseConnection') }}</option>
							<option v-if="missingTarget" :value="draft.connectionId">#{{ draft.connectionId }}</option>
							<option v-for="target in sshTargets" :key="target.id" :value="target.id">
								{{ target.name }} · #{{ target.id }}
							</option>
						</select></label
					>
					<label class="block text-sm"
						>{{ t('agent.settings.integrationManagement.argv')
						}}<textarea
							v-model="draft.argvJson"
							rows="3"
							class="mt-1 w-full rounded border border-border bg-background p-2 font-mono"
						/>
					</label>
					<label class="block text-sm"
						>{{ t('agent.settings.integrationManagement.cwd')
						}}<input
							v-model="draft.cwd"
							class="mt-1 w-full rounded border border-border bg-background p-2 font-mono"
					/></label>
				</template>
			</fieldset>
		</form>
		<template #footer>
			<div class="flex justify-end gap-2">
				<UiButton type="button" :disabled="operation.busy.value || pendingCreate" @click="closeEditor">{{
					t('common.cancel')
				}}</UiButton>
				<UiButton
					type="submit"
					form="integration-editor"
					appearance="solid"
					tone="primary"
					:disabled="blocked || (!original && !pendingCreate && items.length >= AGENT_INTEGRATION_MAX_ITEMS)"
					>{{
						pendingCreate ? t('agent.settings.integrationManagement.retryCreation') : t('common.save')
					}}</UiButton
				>
			</div>
		</template>
	</UiModal>
</template>
