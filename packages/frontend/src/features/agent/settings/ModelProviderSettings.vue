<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiModal, UiInfoHint, UiEmptyState, UiResizeHandle } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { AGENT_PROVIDER_MODEL_LIMIT } from '@nexus-terminal/shared/agent/providers/values';
	import { useResizeHandle } from '@/foundation/interaction';
	import { useProviderManagement } from '../composables/use-provider-management';
	import type { DiscoveredProviderModel, Provider, ProviderModelDraft } from '../model/provider-types';
	import { formatAgentDate } from '../locale-format';
	import ProviderModelEditor from './ProviderModelEditor.vue';

	const { t, locale } = useI18n();
	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const {
		providers,
		draft,
		discovered,
		testResult,
		busy,
		blocked,
		refreshRequired,
		notice,
		edit,
		cancel,
		load,
		save,
		remove,
		discover,
		test,
		lookup,
	} = useProviderManagement({ available: () => props.active });
	const deleting = ref<Provider | null>(null);
	const testingProviderId = ref<string | null>(null);
	const testingProvider = computed(
		() => providers.value.find((provider) => provider.id === testingProviderId.value) ?? null,
	);
	const modelCount = computed(() => providers.value.reduce((total, provider) => total + provider.models.length, 0));
	const showApiKey = ref(false);
	const panelWidth = ref(576);
	const panelHeight = ref(600);
	const resized = ref(false);
	const panelStyle = computed(() =>
		resized.value ? { width: panelWidth.value + 'px', height: panelHeight.value + 'px' } : undefined,
	);
	const resize = useResizeHandle({
		width: panelWidth,
		height: panelHeight,

		minWidth: () => Math.min(512, window.innerWidth - 32),

		minHeight: () => Math.min(480, window.innerHeight - 32),

		maxWidth: () => window.innerWidth - 32,

		maxHeight: () => window.innerHeight - 32,

		widthMultiplier: 2,
		heightMultiplier: 2,
	});
	const query = ref('');
	const selected = ref<string[]>([]);
	watch(
		draft,
		() => {
			selected.value = [];
			query.value = '';
			showApiKey.value = false;
			resized.value = false;
		},
		{ flush: 'sync' },
	);
	useAuthenticatedViewScope({
		available: () => props.active,

		onRevoke() {
			deleting.value = null;
			testingProviderId.value = null;
			showApiKey.value = false;
			query.value = '';
			selected.value = [];
		},
	});
	const visibleDiscovered = computed(() =>
		discovered.value.filter((item) => item.id.toLowerCase().includes(query.value.toLowerCase())),
	);
	const currentProvider = computed(() => providers.value.find((provider) => provider.id === draft.value?.id));

	function addModel(found?: DiscoveredProviderModel): void {
		if (!draft.value || blocked.value || draft.value.models.length >= AGENT_PROVIDER_MODEL_LIMIT) {
			return;
		}
		if (found && draft.value.models.some((model) => model.id === found.id)) {
			return;
		}
		const cap = found?.capabilities;
		// Zero keeps unadvertised required limits visibly incomplete until the user configures them.
		const value: ProviderModelDraft = {
			id: found?.id ?? '',
			contextWindow: cap?.contextWindow ?? 0,
			maxOutputTokens: cap?.maxOutputTokens ?? 0,
			supportsTools: cap?.supportsTools ?? false,
			supportsImageInput: cap?.supportsImageInput,
			supportsFileInput: cap?.supportsFileInput,
			supportsPromptCacheKey: cap?.supportsPromptCacheKey,
			reasoningEfforts: cap?.reasoningEfforts?.map((effort) => effort),
			defaultReasoningEffort: cap?.defaultReasoningEffort,
			reasoningMandatory: cap?.reasoningMandatory,
		};
		draft.value.models.push(value);
	}

	function addSelected(): void {
		if (!draft.value) {
			return;
		}
		const additions = discovered.value.filter(
			(found) => selected.value.includes(found.id) && !draft.value?.models.some((model) => model.id === found.id),
		);
		if (draft.value.models.length + additions.length > AGENT_PROVIDER_MODEL_LIMIT) {
			notice.value = 'capacity';
			return;
		}
		for (const found of discovered.value) {
			if (selected.value.includes(found.id)) {
				addModel(found);
			}
		}
		selected.value = [];
	}

	function applyObservation(model: ProviderModelDraft): void {
		const observation = currentProvider.value?.models.find((item) => item.id === model.id)?.observation;
		if (!observation || blocked.value) {
			return;
		}
		const cap = observation.capabilities;
		if (cap.contextWindow !== undefined) {
			model.contextWindow = cap.contextWindow;
		}
		if (cap.maxOutputTokens !== undefined) {
			model.maxOutputTokens = cap.maxOutputTokens;
		}
		if (cap.supportsTools !== undefined) {
			model.supportsTools = cap.supportsTools;
		}
		if (cap.supportsImageInput !== undefined) {
			model.supportsImageInput = cap.supportsImageInput;
		}
		if (cap.supportsFileInput !== undefined) {
			model.supportsFileInput = cap.supportsFileInput;
		}
		if (cap.supportsPromptCacheKey !== undefined) {
			model.supportsPromptCacheKey = cap.supportsPromptCacheKey;
		}
		if (cap.reasoningEfforts !== undefined) {
			model.reasoningEfforts = cap.reasoningEfforts.map((effort) => effort);
			if (!model.reasoningEfforts.includes(model.defaultReasoningEffort ?? 'none')) {
				model.defaultReasoningEffort = undefined;
			}
		}
		if (cap.defaultReasoningEffort !== undefined) {
			model.defaultReasoningEffort = cap.defaultReasoningEffort;
		}
		if (cap.reasoningMandatory !== undefined) {
			model.reasoningMandatory = cap.reasoningMandatory;
		}
	}

	function setProtocol(event: Event): void {
		if (!draft.value || !(event.target instanceof HTMLSelectElement)) {
			return;
		}
		const value = event.target.value;
		if (value === 'chat-completions' || value === 'responses') {
			draft.value.protocol = value;
		}
	}

	function setCredential(event: Event): void {
		if (!draft.value || !(event.target instanceof HTMLSelectElement)) {
			return;
		}
		const value = event.target.value;
		showApiKey.value = false;
		if (value === 'replace') {
			draft.value.credential = { action: 'replace', value: '' };
		} else if (value === 'clear') {
			draft.value.credential = { action: 'clear' };
		} else {
			draft.value.credential = { action: 'keep' };
		}
	}

	function startResize(event: PointerEvent): void {
		if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
			return;
		}
		const panel = event.currentTarget.closest('.provider-add-panel');
		if (!(panel instanceof HTMLElement)) {
			return;
		}
		const bounds = panel.getBoundingClientRect();
		panelWidth.value = bounds.width;
		panelHeight.value = bounds.height;
		resized.value = true;
		resize.startResize(event);
	}

	function openTests(provider: Provider): void {
		testResult.value = null;
		testingProviderId.value = provider.id;
	}

	async function confirmDelete(): Promise<void> {
		const provider = deleting.value;
		deleting.value = null;
		if (provider) {
			await remove(provider);
		}
	}
</script>

<template>
	<section
		class="relative rounded-2xl border border-border bg-card shadow-xs transition-all"
		:aria-label="t('agent.settings.providerManagement.title')"
	>
		<div
			class="agent-settings-head flex items-center justify-between gap-3 rounded-t-2xl border-b border-border bg-header/50 px-4 py-3 sm:px-5 sm:py-3.5"
		>
			<div class="flex min-w-0 items-center gap-2">
				<h3 class="whitespace-nowrap text-sm font-semibold text-foreground">
					{{ t('agent.settings.providers.title') }}
				</h3>
				<span
					class="whitespace-nowrap rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] text-text-secondary"
					>{{
						t('agent.settings.providers.counts', { providers: providers.length, models: modelCount })
					}}</span
				>
				<UiInfoHint :text="t('agent.settings.providers.description')" />
			</div>
			<UiButton type="button" appearance="soft" :disabled="blocked || draft !== null" @click="edit(null)">
				<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>{{ t('agent.settings.providers.add') }}
			</UiButton>
		</div>
		<div class="space-y-4 p-4 sm:p-5">
			<p v-if="notice && !draft" role="status" class="text-sm">
				{{ t('agent.settings.providerManagement.' + notice) }}
			</p>
			<div v-if="refreshRequired" role="alert" class="space-y-2 text-sm text-warning">
				<p>{{ t('agent.settings.providerManagement.refreshRequired') }}</p>
				<UiButton type="button" :disabled="busy" @click="load">{{
					t('agent.settings.providerManagement.read')
				}}</UiButton>
			</div>
			<UiEmptyState
				v-if="!providers.length && !refreshRequired && !busy"
				:title="t('agent.settings.providers.empty')"
			/>
			<article
				v-for="provider in providers"
				:key="provider.id"
				class="space-y-3 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/60"
			>
				<h4 class="font-medium">
					{{ provider.name }}
				</h4>
				<p class="break-all text-xs">
					{{ provider.baseUrl }} · {{ provider.protocol }} ·
					{{
						t(
							provider.enabled
								? 'agent.settings.providerManagement.enabled'
								: 'agent.settings.providerManagement.disabled',
						)
					}}
				</p>
				<p class="text-xs text-text-secondary">
					{{
						t(
							provider.hasCredential
								? 'agent.settings.providerManagement.hasCredential'
								: 'agent.settings.providerManagement.noCredential',
						)
					}}
				</p>
				<div class="flex flex-wrap gap-2">
					<UiButton
						type="button"
						appearance="soft"
						:disabled="blocked || draft !== null"
						@click="openTests(provider)"
						>{{ t('agent.settings.providers.testModalBtn', { count: provider.models.length }) }}</UiButton
					>
					<UiButton type="button" :disabled="blocked || draft !== null" @click="edit(provider)">{{
						t('common.edit')
					}}</UiButton>
					<UiButton type="button" :disabled="blocked || draft !== null" @click="discover(provider)">{{
						t('agent.settings.providerManagement.discover')
					}}</UiButton>
					<UiButton type="button" :disabled="blocked || draft !== null" @click="deleting = provider">{{
						t('common.delete')
					}}</UiButton>
				</div>
			</article>
		</div>
		<UiModal
			:visible="testingProvider !== null"
			:title="t('agent.settings.providers.testModalTitle')"
			:close-on-escape="!busy"
			:close-on-backdrop="!busy"
			focus-on-open
			restore-focus
			panel-class="max-w-2xl rounded-2xl p-5 sm:p-6"
			@close="testingProviderId = busy ? testingProviderId : null"
		>
			<div v-if="testingProvider" class="space-y-4">
				<p class="text-sm font-medium">{{ testingProvider.name }}</p>
				<p v-if="notice" role="status" class="text-sm">
					{{ t('agent.settings.providerManagement.' + notice) }}
				</p>
				<div v-if="refreshRequired" class="space-y-2 text-sm text-warning">
					<p>{{ t('agent.settings.providerManagement.refreshRequired') }}</p>
					<UiButton type="button" :disabled="busy" @click="load">{{
						t('agent.settings.providerManagement.read')
					}}</UiButton>
				</div>
				<div v-if="testResult" role="status" class="text-sm">
					{{
						t(
							testResult.ok
								? 'agent.settings.providerManagement.testOk'
								: 'agent.settings.providerManagement.testFailed',
							{ ms: testResult.latencyMs },
						)
					}}
					<span v-if="!testResult.ok">{{ testResult.errorCode }}</span>
					<span v-else-if="testResult.usage">{{
						t('agent.settings.providerManagement.usage', {
							input: testResult.usage.inputTokens,
							output: testResult.usage.outputTokens,
						})
					}}</span>
				</div>
				<div
					v-for="model in testingProvider.models"
					:key="model.id"
					class="space-y-1 border-t border-border pt-2 text-xs"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="break-all font-mono">{{ model.id }}</span>
						<UiButton
							type="button"
							:disabled="blocked || draft !== null || !testingProvider.enabled"
							@click="test(testingProvider, model.id)"
							>{{ t('agent.settings.providerManagement.test') }}</UiButton
						>
					</div>
					<div>
						{{ t('agent.settings.providers.contextWindow') }}: {{ model.contextWindow }} ·
						{{ t('agent.settings.providers.maxOutputTokens') }}: {{ model.maxOutputTokens }}
					</div>
					<details class="text-text-secondary">
						<summary class="cursor-pointer">
							{{ t('agent.settings.providerManagement.capabilityDetails') }}
						</summary>
						<div v-for="(source, field) in model.sources" :key="field">
							<template v-if="source">{{ field }}: {{ source }}</template>
						</div>
						<div v-if="model.observation">
							{{ model.observation.source }} · {{ model.observation.revision }} ·
							{{ formatAgentDate(locale, new Date(model.observation.observedAt)) }}
							<div v-for="(value, field) in model.observation.capabilities" :key="field">
								<template v-if="value !== undefined">{{ field }}: {{ value }}</template>
							</div>
						</div>
					</details>
					<p v-if="model.conflicts.length" class="text-warning">
						{{ t('agent.settings.providers.capabilityConflict', { fields: model.conflicts.join(', ') }) }}
					</p>
				</div>
			</div>
			<template #footer
				><div class="flex justify-end">
					<UiButton type="button" :disabled="busy" @click="testingProviderId = null">{{
						t('common.close')
					}}</UiButton>
				</div></template
			>
		</UiModal>
		<UiModal
			:visible="draft !== null"
			:title="draft?.id ? t('common.edit') : t('agent.settings.providers.modalTitle')"
			:panel-style="panelStyle"
			:close-on-backdrop="!busy"
			:close-on-escape="!busy"
			focus-on-open
			restore-focus
			panel-class="ui-form-surface provider-add-panel max-w-xl rounded-2xl p-5 sm:p-6"
			@close="cancel"
		>
			<template #panel-overlay>
				<UiResizeHandle
					class="provider-add-resize-handle absolute bottom-0 right-0 z-40"
					:title="t('agent.settings.providers.resize')"
					:aria-label="t('agent.settings.providers.resize')"
					@pointerdown.stop="startResize"
				/>
			</template>
			<form v-if="draft" id="provider-editor" class="space-y-4" @submit.prevent="save">
				<p v-if="notice" role="status" class="text-sm">
					{{ t('agent.settings.providerManagement.' + notice) }}
				</p>
				<div v-if="refreshRequired" role="alert" class="space-y-2 text-sm text-warning">
					<p>{{ t('agent.settings.providerManagement.refreshRequired') }}</p>
					<UiButton type="button" :disabled="busy" @click="load">{{
						t('agent.settings.providerManagement.read')
					}}</UiButton>
				</div>
				<fieldset :disabled="blocked" class="space-y-3">
					<label class="block text-sm"
						>{{ t('agent.settings.providerManagement.name')
						}}<input
							required
							v-model="draft.name"
							class="provider-modal-input mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
					/></label>
					<label class="block text-sm"
						>{{ t('agent.settings.providerManagement.endpoint')
						}}<input
							required
							v-model="draft.baseUrl"
							type="url"
							class="provider-modal-input mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
					/></label>
					<label class="block text-sm"
						>{{ t('agent.settings.providers.protocol') }}
						<select
							:value="draft.protocol"
							class="ml-2 rounded border border-border bg-background p-2"
							@change="setProtocol"
						>
							<option value="chat-completions">Chat Completions</option>
							<option value="responses">Responses</option>
						</select>
					</label>
					<label class="flex items-center gap-2 text-sm"
						><input v-model="draft.enabled" type="checkbox" />{{
							t('agent.settings.providerManagement.enabled')
						}}</label
					>
					<label class="block text-sm"
						>{{ t('agent.settings.providerManagement.credential') }}
						<select
							:value="draft.credential.action"
							class="ml-2 rounded border border-border bg-background p-2"
							@change="setCredential"
						>
							<option value="keep">{{ t('agent.settings.providerManagement.keep') }}</option>
							<option value="replace">{{ t('agent.settings.providerManagement.replace') }}</option>
							<option v-if="draft.id" value="clear">
								{{ t('agent.settings.providerManagement.clear') }}
							</option>
						</select>
						<input
							v-if="draft.credential.action === 'replace'"
							v-model="draft.credential.value"
							:type="showApiKey ? 'text' : 'password'"
							autocomplete="new-password"
							:aria-label="t('agent.settings.providerManagement.credential')"
							class="mt-2 w-full rounded border border-border bg-background p-2"
						/>
					</label>
					<UiButton
						v-if="draft.credential.action === 'replace'"
						type="button"
						appearance="ghost"
						@click="showApiKey = !showApiKey"
						>{{
							t(
								showApiKey
									? 'agent.settings.providers.hideCredential'
									: 'agent.settings.providers.showCredential',
							)
						}}</UiButton
					>
					<p class="text-xs text-text-secondary">{{ t('agent.settings.providerManagement.secretHelp') }}</p>
					<UiButton v-if="draft.id === null" type="button" @click="discover(null)">{{
						t('agent.settings.providerManagement.discoverEndpoint')
					}}</UiButton>
					<div
						v-for="(model, index) in draft.models"
						:key="index"
						class="space-y-3 rounded border border-border p-3"
					>
						<ProviderModelEditor
							:model-value="model"
							@update:model-value="(value) => draft?.models.splice(index, 1, value)"
						/>
						<div
							v-if="currentProvider?.models.find((item) => item.id === model.id)?.observation"
							class="space-y-2 text-xs text-text-secondary"
						>
							<p>{{ t('agent.settings.providerManagement.observationHelp') }}</p>
							<UiButton type="button" @click="applyObservation(model)">{{
								t('agent.settings.providerManagement.applyObservation')
							}}</UiButton>
						</div>
						<div class="flex flex-wrap gap-2">
							<UiButton type="button" @click="lookup(model)">{{
								t('agent.settings.providerManagement.registry')
							}}</UiButton
							><UiButton type="button" @click="draft.models.splice(index, 1)">{{
								t('common.delete')
							}}</UiButton>
						</div>
					</div>
					<p class="text-xs text-text-secondary">
						{{ t('agent.settings.providerManagement.modelHelp', { max: AGENT_PROVIDER_MODEL_LIMIT }) }}
					</p>
					<UiButton
						type="button"
						:disabled="draft.models.length >= AGENT_PROVIDER_MODEL_LIMIT"
						@click="addModel()"
						>{{ t('agent.settings.providerManagement.addModel') }}</UiButton
					>
				</fieldset>
			</form>
			<div v-if="draft && discovered.length" class="space-y-3 rounded border border-border p-3">
				<label class="block text-sm"
					>{{ t('agent.settings.providerManagement.filter')
					}}<input
						v-model="query"
						class="provider-modal-input mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
				/></label>
				<label v-for="found in visibleDiscovered" :key="found.id" class="flex items-center gap-2 text-sm"
					><input
						v-model="selected"
						type="checkbox"
						:value="found.id"
						:disabled="blocked || !draft || draft.models.some((model) => model.id === found.id)"
					/><span class="break-all">{{ found.id }}</span></label
				>
				<UiButton
					type="button"
					:disabled="
						blocked || !draft || selected.length === 0 || draft.models.length >= AGENT_PROVIDER_MODEL_LIMIT
					"
					@click="addSelected"
					>{{ t('agent.settings.providerManagement.addSelected') }}</UiButton
				>
			</div>
			<template #footer>
				<div class="flex justify-end gap-2">
					<UiButton type="button" :disabled="busy" @click="cancel">{{ t('common.cancel') }}</UiButton>
					<UiButton type="submit" form="provider-editor" :disabled="blocked">{{ t('common.save') }}</UiButton>
				</div>
			</template>
		</UiModal>
		<UiModal
			:visible="deleting !== null"
			:title="t('agent.settings.providerManagement.deleteTitle')"
			@close="deleting = null"
		>
			<p>{{ t('agent.settings.providerManagement.deleteConfirm', { name: deleting?.name }) }}</p>
			<template #footer
				><UiButton type="button" @click="deleting = null">{{ t('common.cancel') }}</UiButton
				><UiButton type="button" :disabled="blocked" @click="confirmDelete">{{
					t('common.delete')
				}}</UiButton></template
			>
		</UiModal>
	</section>
</template>

<style scoped src="./ModelProviderSettings.css"></style>
