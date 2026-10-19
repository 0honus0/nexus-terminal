<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiModal } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { AGENT_PROVIDER_MODEL_LIMIT } from '@nexus-terminal/shared/agent/providers/values';
	import { useProviderManagement } from '../composables/use-provider-management';
	import type { DiscoveredProviderModel, Provider, ProviderModelDraft } from '../model/provider-types';
	import { formatAgentDate } from '../locale-format';
	import ProviderModelEditor from './ProviderModelEditor.vue';

	const { t, locale } = useI18n();
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
	} = useProviderManagement();
	const deleting = ref<Provider | null>(null);
	const query = ref('');
	const selected = ref<string[]>([]);
	useAuthenticatedViewScope({
		onRevoke() {
			deleting.value = null;
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
		if (value === 'replace') {
			draft.value.credential = { action: 'replace', value: '' };
		} else if (value === 'clear') {
			draft.value.credential = { action: 'clear' };
		} else {
			draft.value.credential = { action: 'keep' };
		}
	}

	function openEditor(provider: Provider | null): void {
		selected.value = [];
		query.value = '';
		edit(provider);
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
		class="space-y-4 rounded-xl border border-border bg-card p-4"
		:aria-label="t('agent.settings.providerManagement.title')"
	>
		<h3 class="font-medium">{{ t('agent.settings.providerManagement.title') }}</h3>
		<p class="text-sm text-text-secondary">{{ t('agent.settings.providerManagement.description') }}</p>
		<p v-if="notice" role="status" class="text-sm">{{ t('agent.settings.providerManagement.' + notice) }}</p>
		<p v-if="refreshRequired" role="alert" class="text-sm text-warning">
			{{ t('agent.settings.providerManagement.refreshRequired') }}
		</p>
		<div class="flex flex-wrap gap-2">
			<UiButton type="button" :disabled="busy" @click="load">{{
				t('agent.settings.providerManagement.read')
			}}</UiButton>
			<UiButton type="button" :disabled="blocked || draft !== null" @click="openEditor(null)">{{
				t('agent.settings.providerManagement.create')
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
		<article v-for="provider in providers" :key="provider.id" class="space-y-2 rounded border border-border p-3">
			<h4 class="font-medium">
				{{ provider.name }} <span class="text-xs text-text-secondary">v{{ provider.version }}</span>
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
				<UiButton type="button" :disabled="blocked || draft !== null" @click="openEditor(provider)">{{
					t('common.edit')
				}}</UiButton>
				<UiButton type="button" :disabled="blocked || draft !== null" @click="discover(provider)">{{
					t('agent.settings.providerManagement.discover')
				}}</UiButton>
				<UiButton type="button" :disabled="blocked || draft !== null" @click="deleting = provider">{{
					t('common.delete')
				}}</UiButton>
			</div>
			<div v-for="model in provider.models" :key="model.id" class="space-y-1 border-t border-border pt-2 text-xs">
				<div class="flex items-center justify-between gap-2">
					<span class="break-all font-mono">{{ model.id }}</span>
					<UiButton
						type="button"
						:disabled="blocked || draft !== null || !provider.enabled"
						@click="test(provider, model.id)"
						>{{ t('agent.settings.providerManagement.test') }}</UiButton
					>
				</div>
				<div>
					{{ t('agent.settings.providers.contextWindow') }}: {{ model.contextWindow }} ·
					{{ t('agent.settings.providers.maxOutputTokens') }}: {{ model.maxOutputTokens }}
				</div>
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
				<p v-if="model.conflicts.length" class="text-warning">
					{{ t('agent.settings.providers.capabilityConflict', { fields: model.conflicts.join(', ') }) }}
				</p>
			</div>
		</article>
		<form v-if="draft" class="space-y-4 rounded border border-border p-3" @submit.prevent="save">
			<h4 class="font-medium">
				{{ draft.id ? t('common.edit') : t('agent.settings.providerManagement.create') }}
				<span v-if="draft.version !== null">v{{ draft.version }}</span>
			</h4>
			<fieldset :disabled="blocked" class="space-y-3">
				<label class="block text-sm"
					>{{ t('agent.settings.providerManagement.name')
					}}<input v-model="draft.name" class="mt-1 w-full rounded border border-border bg-background p-2"
				/></label>
				<label class="block text-sm"
					>{{ t('agent.settings.providerManagement.endpoint')
					}}<input
						v-model="draft.baseUrl"
						type="url"
						class="mt-1 w-full rounded border border-border bg-background p-2"
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
						type="password"
						autocomplete="new-password"
						:aria-label="t('agent.settings.providerManagement.credential')"
						class="mt-2 w-full rounded border border-border bg-background p-2"
					/>
				</label>
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
				<div class="flex flex-wrap gap-2">
					<UiButton type="submit">{{ t('common.save') }}</UiButton>
				</div>
			</fieldset>
			<UiButton type="button" :disabled="busy" @click="cancel">{{ t('common.cancel') }}</UiButton>
		</form>
		<div v-if="discovered.length" class="space-y-3 rounded border border-border p-3">
			<label class="block text-sm"
				>{{ t('agent.settings.providerManagement.filter')
				}}<input v-model="query" class="mt-1 w-full rounded border border-border bg-background p-2"
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
