<script setup lang="ts">
	import { computed, onMounted } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import { useConnections } from '@/features/connections/public';
	import { AGENT_INTEGRATION_MAX_ITEMS } from '@nexus-terminal/shared/agent/integrations/values';
	import { useAppIntegrations } from '../composables/use-app-integrations';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';

	const props = defineProps<{ appId: string }>();
	const { t } = useI18n();
	const {
		items,
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
	} = useAppIntegrations(props.appId);
	const connections = useConnections();
	const directoryOperation = useAgentManagementOperation();
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

	onMounted(() => void loadTargets());
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
		<UiButton type="button" :disabled="operation.busy.value" @click="load">{{
			t('agent.settings.integrationManagement.reload')
		}}</UiButton>
		<fieldset :disabled="blocked || pendingCreate || original !== null" class="space-y-3">
			<p v-if="items.length === 0" class="text-sm">{{ t('agent.settings.integrationManagement.empty') }}</p>
			<article v-for="item in items" :key="item.id" class="space-y-2 rounded border border-border p-3">
				<h4>
					{{ item.configuration.name }} · {{ item.configuration.kind.toUpperCase() }} · v{{ item.version }}
				</h4>
				<p class="break-all text-xs">
					{{ item.id }} ·
					{{
						t(item.enabled ? 'agent.settings.appManagement.enable' : 'agent.settings.appManagement.disable')
					}}
				</p>
				<p class="text-xs">
					{{
						t('agent.settings.integrationManagement.credentialState', {
							present: item.hasCredential,
							revision: item.credentialRevision,
						})
					}}
				</p>
				<p v-if="item.schemaHash" class="break-all text-xs">
					{{ t('agent.settings.integrationManagement.schemaHash') }}: {{ item.schemaHash }}
				</p>
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
		<form class="space-y-3 rounded border border-border p-3" @submit.prevent="save">
			<h4>
				{{
					original
						? t('common.edit') + ' · v' + original.version
						: t('agent.settings.integrationManagement.create')
				}}
			</h4>
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
					<UiButton type="button" :disabled="directoryOperation.busy.value" @click="loadTargets">{{
						t('agent.settings.appManagement.readTargets')
					}}</UiButton>
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
			<div class="flex flex-wrap gap-2">
				<UiButton
					type="submit"
					:disabled="blocked || (!original && !pendingCreate && items.length >= AGENT_INTEGRATION_MAX_ITEMS)"
					>{{
						pendingCreate ? t('agent.settings.integrationManagement.retryCreation') : t('common.save')
					}}</UiButton
				>
				<UiButton type="button" :disabled="blocked || pendingCreate" @click="resetDraft">{{
					t('agent.settings.integrationManagement.newDraft')
				}}</UiButton>
			</div>
		</form>
		<article v-if="discovery" class="space-y-2 rounded border border-border p-3">
			<h4>{{ discovery.serverName }} · {{ discovery.serverVersion }} · {{ discovery.protocolVersion }}</h4>
			<p class="break-all text-xs">{{ discovery.integration.id }} · v{{ discovery.integration.version }}</p>
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
</template>
