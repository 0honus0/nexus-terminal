<script setup lang="ts">
	import { nextTick, computed, onActivated, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiEmptyState,
		UiFormActions,
		UiFormField,
		UiInfoHint,
		UiInlineNotice,
		UiInput,
		UiModal,
		UiSegmentedControl,
		UiSelect,
		UiSwitch,
		UiTextarea,
	} from '@/foundation/ui';
	import { useOperationFeedback } from '@/shared/feedback/public';
	import { useConnections } from '@/features/connections/public';
	import { AGENT_INTEGRATION_MAX_ITEMS } from '@nexus-terminal/shared/agent/integrations/values';
	import { useAppIntegrations } from '../composables/use-app-integrations';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';

	const props = withDefaults(defineProps<{ appId: string; active?: boolean; embedded?: boolean }>(), {
		active: true,
		embedded: false,
	});
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
		toggle,
	} = useAppIntegrations(props.appId, () => props.active);

	const integrationKindOptions = computed<Array<{ value: 'mcp' | 'acp'; label: string }>>(() => [
		{ value: 'mcp', label: 'MCP' },
		{ value: 'acp', label: 'ACP' },
	]);

	const copiedUrl = ref('');
	const discoveryOpen = ref(false);
	const feedback = useOperationFeedback('agent.settings.integrations');
	const itemToDelete = computed(() => items.value.find((item) => item.id === deleteId.value));
	watch(discovery, (value) => {
		discoveryOpen.value = value !== null;
	});
	watch(
		() => props.active,
		(active) => {
			if (!active) discoveryOpen.value = false;
		},
	);

	async function copyEndpoint(endpoint: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(endpoint);
			copiedUrl.value = endpoint;
		} catch (cause) {
			feedback.notifyError({
				operation: 'copy-endpoint',
				message: t('agent.settings.plugins.copyFailed'),
				cause,
			});
		}
	}

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
	onActivated(async () => {
		await nextTick();
		initialTargets();
	});
</script>
<template>
	<section
		:class="
			embedded ? 'min-w-0' : 'overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all'
		"
		:aria-label="t('agent.settings.integrationManagement.title')"
	>
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3"
			:class="
				embedded
					? 'justify-end pb-3'
					: [
							'rounded-t-2xl bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5',
							{ 'border-b border-border': items.length > 0 },
						]
			"
		>
			<div v-if="!embedded" class="flex items-center gap-2">
				<h3 class="text-sm font-semibold text-foreground">
					{{ t('agent.settings.integrationManagement.title') }}
				</h3>
				<span
					v-if="items.length"
					class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
					>{{ items.length }}</span
				>
				<UiInfoHint :text="t('agent.settings.integrationManagement.description')" />
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<slot name="app-selector" />
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					icon-only
					:loading="operation.busy.value"
					:disabled="operation.busy.value"
					:aria-label="t('agent.settings.integrationManagement.reload')"
					@click="load"
				>
					<i class="fa-solid fa-arrows-rotate text-xs" aria-hidden="true"></i>
				</UiButton>
				<UiButton
					v-if="pendingCreate"
					type="button"
					:disabled="operation.busy.value"
					@click="editorOpen = true"
					>{{ t('common.edit') }}</UiButton
				>
				<UiButton
					v-else
					type="button"
					appearance="solid"
					tone="primary"
					class="shrink-0"
					:disabled="blocked || items.length >= AGENT_INTEGRATION_MAX_ITEMS"
					@click="resetDraft"
				>
					<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i
					>{{ t('agent.settings.integrationManagement.create') }}
				</UiButton>
			</div>
		</div>
		<div
			v-if="items.length || needsReload || operation.refreshRequired.value || pendingCreate"
			:class="embedded ? 'space-y-1' : 'space-y-3 p-4 sm:p-5'"
		>
			<UiInlineNotice v-if="pendingCreate" tone="warning" compact>
				{{ t('agent.settings.integrationManagement.pending') }}
			</UiInlineNotice>
			<UiButton
				v-if="operation.refreshRequired.value || needsReload || operation.notice.value === 'failed'"
				type="button"
				:disabled="operation.busy.value"
				@click="load"
				>{{ t('agent.settings.integrationManagement.reload') }}</UiButton
			>
			<fieldset
				:disabled="blocked || pendingCreate || original !== null"
				:class="embedded ? 'space-y-0' : 'space-y-3'"
			>
				<article
					v-for="item in items"
					:key="item.id"
					class="border-b border-border/35 transition-colors last:border-b-0"
					:class="
						embedded
							? 'space-y-2 py-3.5 hover:bg-header/20'
							: 'space-y-3 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-2xs hover:bg-card/95'
					"
				>
					<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
						<div class="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 text-primary shadow-2xs"
							>
								<i class="fa-solid fa-plug text-sm" aria-hidden="true"></i>
							</div>
							<div class="min-w-0 flex-1 space-y-1.5">
								<div class="flex flex-wrap items-center gap-2">
									<h4 class="break-words text-sm font-semibold text-foreground">
										{{ item.configuration.name }}
									</h4>
									<UiBadge appearance="ghost" density="compact">
										{{ item.configuration.kind.toUpperCase() }}
									</UiBadge>
									<UiBadge :tone="item.enabled ? 'success' : 'neutral'" density="compact">
										{{
											t(
												item.enabled
													? 'agent.settings.providers.enabled'
													: 'agent.settings.providers.disabled',
											)
										}}
									</UiBadge>
								</div>

								<button
									type="button"
									class="group/url inline-flex max-w-full cursor-pointer items-center gap-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:text-foreground"
									:aria-label="t('agent.settings.plugins.copy')"
									@click="
										copyEndpoint(
											item.configuration.kind === 'mcp'
												? item.configuration.endpoint
												: item.configuration.cwd,
										)
									"
								>
									<i
										class="fa-solid fa-link shrink-0 text-[10px] text-text-secondary/60"
										aria-hidden="true"
									></i>
									<span class="max-w-[260px] truncate sm:max-w-[420px]">{{
										item.configuration.kind === 'mcp'
											? item.configuration.endpoint
											: item.configuration.cwd
									}}</span>
									<i
										:class="
											copiedUrl ===
											(item.configuration.kind === 'mcp'
												? item.configuration.endpoint
												: item.configuration.cwd)
												? 'fa-solid fa-check text-success'
												: 'fa-regular fa-copy'
										"
										aria-hidden="true"
									></i>
								</button>
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
						<div
							class="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/30 pt-2 sm:border-0 sm:pt-0"
						>
							<UiButton
								v-if="item.configuration.kind === 'mcp'"
								type="button"
								appearance="soft"
								tone="neutral"
								density="compact"
								icon-only
								:aria-label="t('agent.settings.integrationManagement.discover')"
								:disabled="!item.enabled"
								@click="discover(item)"
								><i class="fa-solid fa-arrows-rotate text-xs" aria-hidden="true"></i
							></UiButton>
							<UiButton
								type="button"
								appearance="soft"
								tone="neutral"
								density="compact"
								icon-only
								:aria-label="t('common.edit')"
								@click="edit(item.id)"
								><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i
							></UiButton>

							<UiButton
								type="button"
								appearance="soft"
								density="compact"
								icon-only
								:tone="item.enabled ? 'danger' : 'success'"
								:aria-label="
									t(
										item.enabled
											? 'agent.settings.providers.disable'
											: 'agent.settings.providers.enable',
									)
								"
								@click="toggle(item)"
							>
								<i
									:class="item.enabled ? 'fa-solid fa-power-off' : 'fa-solid fa-play'"
									class="text-xs"
									aria-hidden="true"
								></i>
							</UiButton>
							<UiButton
								type="button"
								appearance="soft"
								tone="danger"
								density="compact"
								icon-only
								:aria-label="t('common.delete')"
								@click="deleteId = item.id"
								><i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i
							></UiButton>
						</div>
					</div>
				</article>
			</fieldset>
		</div>
		<UiEmptyState
			v-else
			class="border-t border-border/30"
			compact
			:bordered="false"
			icon="fa-solid fa-plug"
			:title="t('agent.settings.integrationManagement.empty')"
		/>
	</section>
	<UiModal
		:visible="active && discoveryOpen && discovery !== null"
		:title="t('agent.settings.integrationManagement.discover')"
		panel-class="ui-form-surface !w-[calc(100vw-2rem)] !max-w-2xl !p-4 sm:!p-6"
		@close="discoveryOpen = false"
	>
		<article v-if="discovery" class="space-y-5">
			<div class="flex items-center gap-3 rounded-xl bg-header/25 p-3.5">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"
				>
					<i class="fa-solid fa-plug text-sm" aria-hidden="true"></i>
				</div>
				<div class="min-w-0">
					<h4 class="truncate text-sm font-semibold text-foreground">{{ discovery.serverName }}</h4>
					<p class="mt-0.5 text-xs text-text-secondary">
						{{ discovery.serverVersion }} · {{ discovery.protocolVersion }}
					</p>
				</div>
			</div>
			<section class="space-y-2">
				<h5 class="text-xs font-semibold text-foreground">
					{{ t('agent.settings.integrationManagement.tools') }} ({{ discovery.tools.length }})
				</h5>
				<details v-for="tool in discovery.tools" :key="tool.name" class="rounded-xl bg-header/20 px-3 py-2.5">
					<summary class="cursor-pointer text-sm font-medium">{{ tool.name }}</summary>
					<p class="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">
						{{ tool.description }}
					</p>
					<pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">{{
						tool.inputSchemaJson
					}}</pre>
				</details>
			</section>
			<section class="space-y-2">
				<h5 class="text-xs font-semibold text-foreground">
					{{ t('agent.settings.integrationManagement.resources') }} ({{ discovery.resources.length }})
				</h5>
				<p
					v-for="(resource, index) in discovery.resources"
					:key="index"
					class="break-all rounded-xl bg-header/20 px-3 py-2.5 text-xs text-text-secondary"
				>
					{{ resource.name }} · {{ resource.uri }}
				</p>
			</section>
			<section class="space-y-2">
				<h5 class="text-xs font-semibold text-foreground">
					{{ t('agent.settings.integrationManagement.prompts') }} ({{ discovery.prompts.length }})
				</h5>
				<details
					v-for="(prompt, index) in discovery.prompts"
					:key="index"
					class="rounded-xl bg-header/20 px-3 py-2.5"
				>
					<summary class="cursor-pointer text-sm font-medium">{{ prompt.name }}</summary>
					<p class="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">
						{{ prompt.description }}
					</p>
				</details>
			</section>
		</article>
		<template #footer>
			<UiFormActions>
				<UiButton type="button" appearance="soft" tone="neutral" @click="discoveryOpen = false">{{
					t('common.close')
				}}</UiButton>
			</UiFormActions>
		</template>
	</UiModal>
	<UiModal
		:visible="active && itemToDelete !== undefined"
		:title="t('agent.settings.integrationManagement.confirmDelete')"
		:close-on-backdrop="!operation.busy.value"
		:close-on-escape="!operation.busy.value"
		panel-class="ui-form-surface !w-[calc(100vw-2rem)] !max-w-lg !p-4 sm:!p-6"
		@close="deleteId = null"
	>
		<p class="text-sm leading-relaxed text-text-secondary">
			{{ t('agent.settings.integrationManagement.deletePrompt', { name: itemToDelete?.configuration.name }) }}
		</p>
		<template #footer>
			<UiFormActions>
				<UiButton
					type="button"
					appearance="solid"
					tone="danger"
					:disabled="blocked || !itemToDelete"
					@click="itemToDelete && remove(itemToDelete)"
					>{{ t('common.delete') }}</UiButton
				>
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					:disabled="operation.busy.value"
					@click="deleteId = null"
					>{{ t('common.cancel') }}</UiButton
				>
			</UiFormActions>
		</template>
	</UiModal>

	<UiModal
		:visible="active && editorOpen"
		:aria-label="original ? t('common.edit') : t('agent.settings.integrationManagement.create')"
		:close-on-backdrop="!operation.busy.value && !pendingCreate"
		:close-on-escape="!operation.busy.value && !pendingCreate"
		:panel-style="{ height: 'min(760px, calc(100dvh - 2rem))', maxHeight: 'calc(100dvh - 2rem)' }"
		panel-class="ui-form-surface !max-w-3xl !p-4 sm:!p-6 lg:!p-7"
		content-class="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !py-0"
		@close="closeEditor"
	>
		<form id="integration-editor" class="integration-form flex min-h-0 flex-1 flex-col" @submit.prevent="save">
			<h3 class="mb-5 shrink-0 text-lg font-semibold">
				{{ original ? t('common.edit') : t('agent.settings.integrationManagement.create') }}
			</h3>
			<UiInlineNotice v-if="pendingCreate" class="mb-4" tone="warning">
				{{ t('agent.settings.integrationManagement.pending') }}
			</UiInlineNotice>
			<UiInlineNotice v-if="operation.refreshRequired.value || needsReload" class="mb-4" tone="warning" compact>
				{{ t('agent.settings.integrationManagement.reload') }}
				<template #actions>
					<UiButton
						type="button"
						appearance="soft"
						tone="warning"
						density="compact"
						:disabled="operation.busy.value"
						@click="load"
					>
						{{ t('agent.settings.integrationManagement.reload') }}
					</UiButton>
				</template>
			</UiInlineNotice>
			<fieldset
				:disabled="blocked || pendingCreate"
				class="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain pr-1 sm:pr-3"
			>
				<section class="ui-form-section integration-form__section space-y-5">
					<h4>{{ t('agent.settings.integrationManagement.sectionBasic') }}</h4>
					<div>
						<label class="mb-1 block text-sm font-medium text-text-secondary">{{
							t('agent.settings.integrationManagement.kind')
						}}</label>
						<UiSegmentedControl
							v-model="draft.kind"
							:options="integrationKindOptions"
							:disabled="original !== null"
							:label="t('agent.settings.integrationManagement.kind')"
						/>
					</div>
					<UiFormField :label="t('agent.settings.appManagement.name')" for-id="integration-name">
						<UiInput id="integration-name" v-model="draft.name" autocomplete="off" />
					</UiFormField>
					<label
						for="integration-enabled"
						class="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-header/25 px-4 py-3 text-sm font-medium"
					>
						<span>{{ t('agent.settings.integrationManagement.enabled') }}</span>
						<UiSwitch
							id="integration-enabled"
							v-model="draft.enabled"
							:aria-label="t('agent.settings.integrationManagement.enabled')"
						/>
					</label>
				</section>
				<section class="ui-form-section integration-form__section space-y-5">
					<h4>
						{{
							t(
								draft.kind === 'mcp'
									? 'agent.settings.integrationManagement.sectionMcp'
									: 'agent.settings.integrationManagement.sectionAcp',
							)
						}}
					</h4>
					<template v-if="draft.kind === 'mcp'">
						<UiFormField
							:label="t('agent.settings.integrationManagement.endpoint')"
							for-id="integration-endpoint"
						>
							<UiInput
								id="integration-endpoint"
								v-model="draft.endpoint"
								autocomplete="off"
								spellcheck="false"
								class="font-mono"
							/>
						</UiFormField>
						<UiFormField
							:label="t('agent.settings.integrationManagement.privateHosts')"
							for-id="integration-private-hosts"
						>
							<UiTextarea
								id="integration-private-hosts"
								v-model="draft.privateHostsText"
								:min-rows="3"
								class="font-mono"
							/>
						</UiFormField>
						<UiFormField
							:label="t('agent.settings.integrationManagement.credential')"
							for-id="integration-credential-action"
						>
							<UiSelect id="integration-credential-action" v-model="draft.credentialAction">
								<option v-if="original" value="keep">
									{{ t('agent.settings.integrationManagement.keep') }}
								</option>
								<option value="clear">{{ t('agent.settings.integrationManagement.clear') }}</option>
								<option value="replace">{{ t('agent.settings.integrationManagement.replace') }}</option>
							</UiSelect>
						</UiFormField>
						<UiFormField
							v-if="draft.credentialAction === 'replace'"
							:label="t('agent.settings.integrationManagement.credential')"
							for-id="integration-credential"
						>
							<UiInput
								id="integration-credential"
								v-model="draft.credential"
								type="password"
								autocomplete="new-password"
							/>
						</UiFormField>
					</template>
					<template v-else>
						<UiButton
							v-if="
								directoryOperation.refreshRequired.value || directoryOperation.notice.value === 'failed'
							"
							type="button"
							:disabled="directoryOperation.busy.value"
							@click="loadTargets"
							>{{ t('agent.settings.appManagement.readTargets') }}</UiButton
						>
						<div class="grid gap-4 sm:grid-cols-2">
							<UiFormField
								:label="t('agent.settings.integrationManagement.connection')"
								for-id="integration-connection"
							>
								<UiSelect id="integration-connection" v-model="draft.connectionId">
									<option :value="0">
										{{ t('agent.settings.integrationManagement.chooseConnection') }}
									</option>
									<option v-if="missingTarget" :value="draft.connectionId">
										{{ t('agent.settings.integrationManagement.unavailableConnection') }}
									</option>
									<option v-for="target in sshTargets" :key="target.id" :value="target.id">
										{{ target.name }} · {{ target.host }}
									</option>
								</UiSelect>
							</UiFormField>
							<UiFormField
								:label="t('agent.settings.integrationManagement.cwd')"
								for-id="integration-cwd"
							>
								<UiInput id="integration-cwd" v-model="draft.cwd" class="font-mono" />
							</UiFormField>
						</div>
						<UiFormField :label="t('agent.settings.integrationManagement.argv')" for-id="integration-argv">
							<UiTextarea
								id="integration-argv"
								v-model="draft.argvJson"
								:min-rows="3"
								class="font-mono"
							/>
						</UiFormField>
					</template>
				</section>
			</fieldset>
			<footer class="integration-form__footer">
				<UiFormActions class="ml-auto">
					<UiButton
						type="submit"
						appearance="solid"
						tone="primary"
						:loading="operation.busy.value"
						:disabled="
							blocked || (!original && !pendingCreate && items.length >= AGENT_INTEGRATION_MAX_ITEMS)
						"
						>{{
							pendingCreate ? t('agent.settings.integrationManagement.retryCreation') : t('common.save')
						}}</UiButton
					>
					<UiButton
						type="button"
						appearance="soft"
						tone="neutral"
						:disabled="operation.busy.value || pendingCreate"
						@click="closeEditor"
						>{{ t('common.cancel') }}</UiButton
					>
				</UiFormActions>
			</footer>
		</form>
	</UiModal>
</template>

<style scoped>
	.integration-form__section {
		padding-top: 1.125rem;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	.integration-form__section:first-of-type {
		padding-top: 0.125rem;
		border-top: 0;
	}

	.integration-form__section > h4 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.integration-form__section > h4::before {
		width: 2px;
		height: 0.85rem;
		flex: 0 0 auto;
		border-radius: 999px;
		background: color-mix(in srgb, var(--link-active-color) 72%, transparent);
		content: '';
	}

	.integration-form__footer {
		display: flex;
		flex: 0 0 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 16px;
		margin-top: 20px;
		padding-top: 18px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 48%, transparent);
	}

	@media (max-width: 639px) {
		.integration-form__footer {
			margin-top: 16px;
			padding-top: 14px;
		}
	}
</style>
