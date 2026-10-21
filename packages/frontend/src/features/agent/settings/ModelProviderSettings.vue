<script setup lang="ts">
	import { computed, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiModal, UiInfoHint, UiEmptyState, UiResizeHandle } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import {
		AGENT_MODEL_CAPABILITY_FIELDS,
		AGENT_PROVIDER_MODEL_LIMIT,
	} from '@nexus-terminal/shared/agent/providers/values';
	import type {
		AgentModelCapabilityField,
		AgentModelCapabilitySource,
	} from '@nexus-terminal/shared/agent/providers/values';
	import { useResizeHandle } from '@/foundation/interaction';
	import { useProviderManagement } from '../composables/use-provider-management';
	import type { DiscoveredProviderModel, Provider, ProviderModelDraft } from '../model/provider-types';
	import { formatAgentDate } from '../locale-format';
	import ProviderModelEditor from './ProviderModelEditor.vue';
	import ModelRegistrySettings from './ModelRegistrySettings.vue';

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
		setEnabled,
		remove,
		discover,
		test,
		lookup,
	} = useProviderManagement({ available: () => props.active });
	const deleting = ref<Provider | null>(null);
	const testingProviderId = ref<string | null>(null);
	const testingModelId = ref<string | null>(null);
	const testingProvider = computed(
		() => providers.value.find((provider) => provider.id === testingProviderId.value) ?? null,
	);
	const modelCount = computed(() => providers.value.reduce((total, provider) => total + provider.models.length, 0));
	const showApiKey = ref(false);
	const copiedUrl = ref<string | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
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

	onBeforeUnmount(() => {
		if (copiedTimer !== undefined) clearTimeout(copiedTimer);
	});

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
		testingModelId.value = null;
		testingProviderId.value = provider.id;
	}

	async function testModel(provider: Provider, modelId: string): Promise<void> {
		testingModelId.value = modelId;
		await test(provider, modelId);
	}

	function closeTests(): void {
		if (!busy.value) {
			testingProviderId.value = null;
			testingModelId.value = null;
			testResult.value = null;
		}
	}

	function providerUpdatedAt(provider: Provider): string {
		return formatAgentDate(locale.value, new Date(provider.updatedAt), { dateStyle: 'medium' });
	}

	function protocolLabel(protocol: Provider['protocol']): string {
		return t(
			protocol === 'responses'
				? 'agent.settings.providers.protocolResponses'
				: 'agent.settings.providers.protocolChat',
		);
	}

	function capabilityFieldLabel(field: AgentModelCapabilityField): string {
		const keys: Partial<Record<AgentModelCapabilityField, string>> = {
			contextWindow: 'agent.settings.providers.contextWindow',
			maxOutputTokens: 'agent.settings.providers.maxOutputTokens',
			supportsTools: 'agent.settings.providers.tools',
			supportsImageInput: 'agent.settings.providerManagement.supportsImageInput',
			supportsFileInput: 'agent.settings.providerManagement.supportsFileInput',
			supportsPromptCacheKey: 'agent.settings.providerManagement.supportsPromptCacheKey',
			reasoningEfforts: 'agent.settings.providers.reasoningCapability',
			defaultReasoningEffort: 'agent.settings.providers.reasoningDefault',
			reasoningMandatory: 'agent.settings.providerManagement.reasoningMandatory',
		};
		return keys[field] ? t(keys[field]) : t('agent.settings.providerManagement.capabilityDetails');
	}

	function capabilitySourceLabel(source: AgentModelCapabilitySource): string {
		if (source === 'manual') return t('agent.settings.providers.manualOverride');
		if (source === 'provider') return t('agent.settings.providers.providerLive');
		return t('agent.settings.providers.registryDefault');
	}

	function capabilitySourceEntries(
		sources: Provider['models'][number]['sources'],
	): Array<{ field: AgentModelCapabilityField; source: AgentModelCapabilitySource }> {
		return AGENT_MODEL_CAPABILITY_FIELDS.flatMap((field) => {
			const source = sources[field];
			return source === undefined ? [] : [{ field, source }];
		});
	}

	function capabilityValue(value: unknown): string {
		if (Array.isArray(value)) return value.join(', ');
		if (typeof value === 'boolean') {
			return t(value ? 'agent.settings.providerManagement.yes' : 'agent.settings.providerManagement.no');
		}
		return String(value);
	}

	function testFailureMessage(code: string): string {
		if (code.startsWith('PROVIDER_HTTP_')) return t('agent.apiErrors.providerUpstream');
		const key: Record<string, string> = {
			PROVIDER_DNS_FAILED: 'providerDns',
			PROVIDER_TLS_FAILED: 'providerTls',
			PROVIDER_NETWORK_TIMEOUT: 'providerNetwork',
			PROVIDER_NETWORK_FAILED: 'providerNetwork',
			PROVIDER_STREAM_CLEANUP_FAILED: 'providerNetwork',
			PROVIDER_RESPONSE_INVALID: 'providerResponse',
			PROVIDER_RESPONSE_TOO_LARGE: 'providerResponse',
			PROVIDER_RESPONSE_EMPTY: 'providerResponse',
			PROVIDER_STREAM_TRUNCATED: 'providerResponse',
			PROVIDER_OUTPUT_TRUNCATED: 'providerResponse',
			PROVIDER_CONTENT_FILTERED: 'providerRejected',
			PROVIDER_HTTP_ERROR: 'providerUpstream',
		};
		return t('agent.apiErrors.' + (key[code] ?? 'providerRequest'));
	}

	async function copyBaseUrl(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
			copiedUrl.value = url;
			if (copiedTimer !== undefined) clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => {
				if (copiedUrl.value === url) copiedUrl.value = null;
			}, 1600);
		} catch {
			copiedUrl.value = null;
		}
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
		class="relative z-20 rounded-2xl border border-border bg-card shadow-xs transition-all"
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
					class="whitespace-nowrap rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary sm:px-2.5"
				>
					<span class="hidden sm:inline">{{
						t('agent.settings.providers.counts', { providers: providers.length, models: modelCount })
					}}</span>
					<span class="sm:hidden">{{ providers.length }} / {{ modelCount }}</span>
				</span>
				<UiInfoHint :text="t('agent.settings.providers.description')" class="shrink-0" />
			</div>
			<UiButton
				type="button"
				appearance="soft"
				tone="neutral"
				:disabled="blocked || draft !== null"
				class="w-auto shrink-0 whitespace-nowrap px-3.5"
				@click="edit(null)"
			>
				<span class="inline-flex items-center gap-1.5 text-xs"
					><i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
					<span>{{ t('agent.settings.providers.add') }}</span></span
				>
			</UiButton>
		</div>
		<div class="space-y-4 p-4 sm:p-5">
			<ModelRegistrySettings />
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
				icon="fa-solid fa-server"
				:title="t('agent.settings.providers.empty')"
			/>
			<article
				v-for="provider in providers"
				:key="provider.id"
				class="group overflow-hidden rounded-2xl border border-border/80 bg-card/80 shadow-2xs transition-all hover:border-primary/45 hover:bg-card/95"
			>
				<div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
					<div class="flex min-w-0 flex-1 items-start gap-3.5">
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/10 to-transparent text-primary shadow-xs"
						>
							<i class="fa-solid fa-server text-lg" aria-hidden="true"></i>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<h4 class="text-sm font-bold tracking-tight text-foreground">{{ provider.name }}</h4>
								<span
									class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
									:class="
										provider.enabled
											? 'border-success/30 bg-success/10 text-success'
											: 'border-border bg-header text-text-secondary'
									"
								>
									<span
										class="h-1.5 w-1.5 rounded-full"
										:class="provider.enabled ? 'bg-success' : 'bg-text-secondary/60'"
									></span>
									{{
										t(
											provider.enabled
												? 'agent.settings.providerManagement.enabled'
												: 'agent.settings.providerManagement.disabled',
										)
									}}
								</span>
								<span
									class="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] text-text-secondary"
									><i class="fa-solid fa-key text-[9px] text-primary/75" aria-hidden="true"></i
									>{{
										t(
											provider.hasCredential
												? 'agent.settings.providers.credentialStored'
												: 'agent.settings.providers.noCredential',
										)
									}}</span
								>
							</div>
							<button
								type="button"
								class="group/url mt-1.5 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-left text-xs text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
								:title="
									copiedUrl === provider.baseUrl
										? t('agent.settings.providers.copyUrlSuccess')
										: provider.baseUrl + ' · ' + t('agent.settings.providers.copyUrl')
								"
								:aria-label="t('agent.settings.providers.copyUrl')"
								@click="copyBaseUrl(provider.baseUrl)"
							>
								<i
									class="fa-solid fa-link shrink-0 text-[9px] text-text-secondary/60 group-hover/url:text-primary"
									aria-hidden="true"
								></i>
								<span class="truncate font-mono">{{ provider.baseUrl }}</span>
								<i
									:class="
										copiedUrl === provider.baseUrl
											? 'fa-solid fa-check text-success'
											: 'fa-regular fa-copy text-text-secondary/45 group-hover/url:text-primary'
									"
									class="shrink-0 text-[10px]"
									aria-hidden="true"
								></i>
							</button>
							<div
								class="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-secondary"
							>
								<span>{{ protocolLabel(provider.protocol) }}</span>
								<span class="text-text-secondary/35">·</span>
								<span>{{
									t('agent.settings.providers.modelCount', { count: provider.models.length })
								}}</span>
							</div>
						</div>
					</div>
					<div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
						<UiButton
							type="button"
							appearance="soft"
							:density="'compact'"
							:icon-only="true"
							:tone="provider.enabled ? 'danger' : 'success'"
							:disabled="blocked || draft !== null"
							:title="
								provider.enabled
									? t('agent.settings.providers.disable')
									: t('agent.settings.providers.enable')
							"
							:aria-label="
								provider.enabled
									? t('agent.settings.providers.disable')
									: t('agent.settings.providers.enable')
							"
							@click="setEnabled(provider, !provider.enabled)"
						>
							<i
								:class="provider.enabled ? 'fa-solid fa-power-off' : 'fa-solid fa-play'"
								class="text-xs"
								aria-hidden="true"
							></i>
						</UiButton>
						<UiButton
							type="button"
							appearance="soft"
							tone="neutral"
							:disabled="blocked || draft !== null"
							@click="openTests(provider)"
						>
							<i class="fa-solid fa-vial text-[10px]" aria-hidden="true"></i>
							{{ t('agent.settings.providers.testModalBtn', { count: provider.models.length }) }}
						</UiButton>
						<UiButton
							type="button"
							appearance="soft"
							tone="neutral"
							icon-only
							:disabled="blocked || draft !== null"
							:title="t('agent.settings.providerManagement.discover')"
							:aria-label="t('agent.settings.providerManagement.discover')"
							@click="discover(provider)"
						>
							<i class="fa-solid fa-arrows-rotate text-xs" aria-hidden="true"></i>
						</UiButton>
						<UiButton
							type="button"
							appearance="soft"
							tone="neutral"
							icon-only
							:disabled="blocked || draft !== null"
							:title="t('common.edit')"
							:aria-label="t('common.edit')"
							@click="edit(provider)"
						>
							<i class="fa-solid fa-pen text-xs" aria-hidden="true"></i>
						</UiButton>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							icon-only
							:disabled="blocked || draft !== null"
							:title="t('common.delete')"
							:aria-label="t('common.delete')"
							@click="deleting = provider"
						>
							<i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
						</UiButton>
					</div>
				</div>
				<details class="group border-t border-border/45 bg-header/15 text-[11px] text-text-secondary">
					<summary
						class="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-medium transition-colors hover:text-foreground sm:px-5 [&::-webkit-details-marker]:hidden"
					>
						<i class="fa-solid fa-layer-group text-[10px] text-text-secondary/65" aria-hidden="true"></i>
						<span>{{ t('agent.settings.providers.configuredModels') }}</span>
						<span class="rounded-full border border-border/60 bg-card px-2 py-0.5 font-mono text-[10px]">{{
							provider.models.length
						}}</span>
						<i
							class="fa-solid fa-chevron-down ml-auto text-[9px] transition-transform group-open:rotate-180"
							aria-hidden="true"
						></i>
					</summary>
					<div class="flex flex-wrap items-center gap-1.5 px-4 pb-3 sm:px-5">
						<span
							v-for="model in provider.models"
							:key="model.id"
							class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] shadow-2xs"
						>
							<span class="truncate font-mono text-foreground">{{ model.id }}</span>
							<span class="shrink-0 font-mono text-[10px] text-text-secondary">{{
								t('agent.settings.providers.contextShort', { value: model.contextWindow })
							}}</span>
						</span>
						<span v-if="!provider.models.length">{{ t('agent.settings.providers.empty') }}</span>
					</div>
				</details>
				<details class="border-t border-border/45 px-4 py-2.5 text-[11px] text-text-secondary sm:px-5">
					<summary class="cursor-pointer font-medium">
						{{ t('agent.settings.providerManagement.technicalDetails') }}
					</summary>
					<dl class="mt-2 grid gap-x-4 gap-y-1 font-mono text-[10px] sm:grid-cols-2">
						<div class="flex gap-2">
							<dt class="shrink-0 text-text-secondary/70">ID</dt>
							<dd class="break-all">{{ provider.id }}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="shrink-0 text-text-secondary/70">v</dt>
							<dd>{{ provider.version }}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="shrink-0 text-text-secondary/70">credential</dt>
							<dd>{{ provider.credentialRevision }}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="shrink-0 text-text-secondary/70">protocol</dt>
							<dd>{{ provider.protocol }}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="shrink-0 text-text-secondary/70">created</dt>
							<dd>{{ formatAgentDate(locale, new Date(provider.createdAt)) }}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="shrink-0 text-text-secondary/70">updated</dt>
							<dd>{{ providerUpdatedAt(provider) }}</dd>
						</div>
					</dl>
				</details>
			</article>
		</div>
		<UiModal
			:visible="testingProvider !== null"
			:title="t('agent.settings.providers.testModalTitle')"
			:close-on-escape="!busy"
			:close-on-backdrop="!busy"
			focus-on-open
			restore-focus
			panel-class="max-w-3xl rounded-2xl p-5 sm:p-6"
			@close="closeTests"
		>
			<div v-if="testingProvider" class="space-y-4">
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-header/25 p-3.5">
					<div class="flex min-w-0 items-center gap-3">
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"
						>
							<i class="fa-solid fa-server text-sm" aria-hidden="true"></i>
						</div>
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold text-foreground">{{ testingProvider.name }}</p>
							<p class="mt-0.5 break-all font-mono text-[11px] text-text-secondary">
								{{ testingProvider.baseUrl }}
							</p>
						</div>
					</div>
					<p class="text-xs text-text-secondary">{{ t('agent.settings.providers.testModalDesc') }}</p>
				</div>
				<p v-if="notice" role="status" class="text-sm">
					{{ t('agent.settings.providerManagement.' + notice) }}
				</p>
				<div
					v-if="refreshRequired"
					class="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
				>
					<p>{{ t('agent.settings.providerManagement.refreshRequired') }}</p>
					<UiButton type="button" :disabled="busy" @click="load">{{
						t('agent.settings.providerManagement.read')
					}}</UiButton>
				</div>
				<div
					v-if="testResult && testingModelId"
					role="status"
					class="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs"
					:class="
						testResult.ok
							? 'border-success/25 bg-success/10 text-success'
							: 'border-error/25 bg-error/10 text-error'
					"
				>
					<i
						:class="testResult.ok ? 'fa-solid fa-check' : 'fa-solid fa-circle-exclamation'"
						aria-hidden="true"
					></i>
					<span
						>{{ testingModelId }} ·
						{{
							t(
								testResult.ok
									? 'agent.settings.providerManagement.testOk'
									: 'agent.settings.providerManagement.testFailed',
								{ ms: testResult.latencyMs },
							)
						}}</span
					>
					<span v-if="!testResult.ok">{{ testFailureMessage(testResult.errorCode) }}</span>
					<span v-else-if="testResult.usage">{{
						t('agent.settings.providerManagement.usage', {
							input: testResult.usage.inputTokens,
							output: testResult.usage.outputTokens,
						})
					}}</span>
					<details v-if="!testResult.ok" class="w-full text-[10px] text-text-secondary">
						<summary class="cursor-pointer">
							{{ t('agent.settings.providerManagement.technicalDetails') }}
						</summary>
						<code class="mt-1 block break-all rounded bg-error/5 px-2 py-1">{{
							testResult.errorCode
						}}</code>
					</details>
				</div>
				<div class="configured-models-pane space-y-3">
					<article
						v-for="model in testingProvider.models"
						:key="model.id"
						class="rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs"
					>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<span class="min-w-0 break-all font-mono text-xs font-medium text-foreground">{{
								model.id
							}}</span>
							<UiButton
								type="button"
								appearance="soft"
								density="compact"
								:disabled="blocked || draft !== null || !testingProvider.enabled"
								@click="testModel(testingProvider, model.id)"
								><i
									:class="
										busy && testingModelId === model.id
											? 'fa-solid fa-circle-notch fa-spin'
											: 'fa-solid fa-vial'
									"
									class="text-[10px]"
									aria-hidden="true"
								></i
								>{{ t('agent.settings.providerManagement.test') }}</UiButton
							>
						</div>
						<div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
							<span
								class="rounded-md border border-border/60 bg-header/35 px-2 py-0.5 font-mono text-text-secondary"
								>{{ t('agent.settings.providers.contextShort', { value: model.contextWindow }) }}</span
							>
							<span
								class="rounded-md border border-border/60 bg-header/35 px-2 py-0.5 font-mono text-text-secondary"
								>{{ t('agent.settings.providers.outputShort', { value: model.maxOutputTokens }) }}</span
							>
							<span
								v-if="model.supportsTools"
								class="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-primary"
								>{{ t('agent.settings.providers.toolCapable') }}</span
							>
						</div>
						<details class="mt-2 text-[11px] text-text-secondary">
							<summary class="cursor-pointer">
								{{ t('agent.settings.providerManagement.capabilityDetails') }}
							</summary>
							<div class="mt-2 space-y-1.5 rounded-lg bg-header/20 p-2.5">
								<div class="space-y-1">
									<div
										v-for="entry in capabilitySourceEntries(model.sources)"
										:key="entry.field"
										class="flex items-center justify-between gap-3"
									>
										<span>{{ capabilityFieldLabel(entry.field) }}</span>
										<span class="shrink-0 text-foreground/70">{{
											capabilitySourceLabel(entry.source)
										}}</span>
									</div>
								</div>
								<details v-if="model.observation" class="border-t border-border/40 pt-2">
									<summary class="cursor-pointer font-medium text-foreground/75">
										{{ t('agent.settings.providerManagement.technicalDetails') }}
									</summary>
									<div class="mt-1.5 space-y-1 font-mono text-[10px]">
										<div class="break-all">
											{{ model.observation.source }} · {{ model.observation.revision }}
										</div>
										<div>{{ formatAgentDate(locale, new Date(model.observation.observedAt)) }}</div>
										<div v-for="field in AGENT_MODEL_CAPABILITY_FIELDS" :key="field">
											<template v-if="model.observation.capabilities[field] !== undefined">
												{{ capabilityFieldLabel(field) }}:
												{{ capabilityValue(model.observation.capabilities[field]) }}
											</template>
										</div>
									</div>
								</details>
							</div>
						</details>
						<p v-if="model.conflicts.length" class="mt-2 text-[11px] text-warning">
							{{
								t('agent.settings.providers.capabilityConflict', {
									fields: model.conflicts.map(capabilityFieldLabel).join('、'),
								})
							}}
						</p>
					</article>
				</div>
			</div>
			<template #footer
				><div class="flex justify-end">
					<UiButton type="button" appearance="soft" tone="neutral" :disabled="busy" @click="closeTests">{{
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
			<p class="mb-4 text-xs leading-relaxed text-text-secondary">
				{{ t('agent.settings.providers.modalDescription') }}
			</p>
			<p v-if="notice" role="status" class="mb-3 text-sm">
				{{ t('agent.settings.providerManagement.' + notice) }}
			</p>
			<div
				v-if="refreshRequired"
				role="alert"
				class="mb-3 space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
			>
				<p>{{ t('agent.settings.providerManagement.refreshRequired') }}</p>
				<UiButton type="button" :disabled="busy" @click="load">{{
					t('agent.settings.providerManagement.read')
				}}</UiButton>
			</div>
			<form v-if="draft" id="provider-editor" class="space-y-4" @submit.prevent="save">
				<fieldset :disabled="blocked" class="space-y-4">
					<section class="space-y-3 rounded-xl border border-border/70 bg-header/15 p-3.5 sm:p-4">
						<h4 class="flex items-center gap-2 text-xs font-semibold text-foreground">
							<i class="fa-solid fa-server text-[11px] text-primary" aria-hidden="true"></i>
							{{ t('agent.settings.providers.title') }}
						</h4>
						<label class="block text-xs font-medium text-foreground"
							><span class="mb-1 block">{{ t('agent.settings.providerManagement.name') }}</span>
							<input
								required
								v-model="draft.name"
								class="provider-modal-input h-9 w-full rounded-lg px-3 text-sm outline-none"
							/>
						</label>
						<label class="block text-xs font-medium text-foreground"
							><span class="mb-1 block">{{ t('agent.settings.providerManagement.endpoint') }}</span>
							<input
								required
								v-model="draft.baseUrl"
								type="url"
								class="provider-modal-input h-9 w-full rounded-lg px-3 font-mono text-xs outline-none"
							/>
						</label>
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="block text-xs font-medium text-foreground"
								><span class="mb-1 block">{{ t('agent.settings.providers.protocol') }}</span>
								<select
									:value="draft.protocol"
									class="provider-modal-input h-9 w-full rounded-lg px-3 text-xs outline-none"
									@change="setProtocol"
								>
									<option value="chat-completions">Chat Completions</option>
									<option value="responses">Responses</option>
								</select>
							</label>
							<label
								class="flex items-center gap-2 self-end rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
							>
								<input v-model="draft.enabled" type="checkbox" />
								<span>{{ t('agent.settings.providerManagement.enabled') }}</span>
							</label>
						</div>
					</section>

					<section class="space-y-3 rounded-xl border border-border/70 bg-header/15 p-3.5 sm:p-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h4 class="flex items-center gap-2 text-xs font-semibold text-foreground">
								<i class="fa-solid fa-key text-[11px] text-primary" aria-hidden="true"></i>
								{{ t('agent.settings.providerManagement.credential') }}
							</h4>
							<select
								:value="draft.credential.action"
								class="provider-modal-input h-8 rounded-lg px-2.5 text-xs outline-none"
								@change="setCredential"
							>
								<option value="keep">{{ t('agent.settings.providerManagement.keep') }}</option>
								<option value="replace">{{ t('agent.settings.providerManagement.replace') }}</option>
								<option v-if="draft.id" value="clear">
									{{ t('agent.settings.providerManagement.clear') }}
								</option>
							</select>
						</div>
						<div v-if="draft.credential.action === 'replace'" class="flex gap-2">
							<input
								v-model="draft.credential.value"
								:type="showApiKey ? 'text' : 'password'"
								autocomplete="new-password"
								:aria-label="t('agent.settings.providerManagement.credential')"
								class="provider-modal-input h-9 min-w-0 flex-1 rounded-lg px-3 font-mono text-xs outline-none"
							/>
							<UiButton type="button" appearance="ghost" @click="showApiKey = !showApiKey">
								<i
									:class="showApiKey ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"
									class="text-[10px]"
									aria-hidden="true"
								></i
								>{{
									t(
										showApiKey
											? 'agent.settings.providers.hideCredential'
											: 'agent.settings.providers.showCredential',
									)
								}}
							</UiButton>
						</div>
						<p class="text-[11px] leading-relaxed text-text-secondary">
							{{ t('agent.settings.providerManagement.secretHelp') }}
						</p>
					</section>

					<section class="space-y-3 rounded-xl border border-border/70 bg-header/15 p-3.5 sm:p-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h4 class="flex items-center gap-2 text-xs font-semibold text-foreground">
								<i class="fa-solid fa-brain text-[11px] text-primary" aria-hidden="true"></i>
								{{ t('agent.settings.providers.configuredModels') }}
								<span
									class="rounded-full border border-border/60 bg-card px-2 py-0.5 font-mono text-[10px] text-text-secondary"
									>{{ draft.models.length }} / {{ AGENT_PROVIDER_MODEL_LIMIT }}</span
								>
							</h4>
							<UiButton
								v-if="draft.id === null"
								type="button"
								appearance="soft"
								density="compact"
								@click="discover(null)"
								><i class="fa-solid fa-magnifying-glass text-[10px]" aria-hidden="true"></i
								>{{ t('agent.settings.providerManagement.discoverEndpoint') }}</UiButton
							>
						</div>
						<div
							v-for="(model, index) in draft.models"
							:key="index"
							class="space-y-3 rounded-lg border border-border/60 bg-card p-3"
						>
							<div class="flex items-center justify-between gap-2">
								<span class="text-[11px] font-semibold text-foreground">{{
									model.id || t('agent.settings.providerManagement.modelId')
								}}</span>
								<UiButton
									type="button"
									appearance="ghost"
									tone="danger"
									icon-only
									:title="t('common.delete')"
									:aria-label="t('common.delete')"
									@click="draft.models.splice(index, 1)"
									><i class="fa-regular fa-trash-can text-[10px]" aria-hidden="true"></i
								></UiButton>
							</div>
							<ProviderModelEditor
								:model-value="model"
								@update:model-value="(value) => draft?.models.splice(index, 1, value)"
							/>
							<div
								v-if="currentProvider?.models.find((item) => item.id === model.id)?.observation"
								class="space-y-2 rounded-md bg-header/25 p-2.5 text-[11px] text-text-secondary"
							>
								<p>{{ t('agent.settings.providerManagement.observationHelp') }}</p>
								<div class="flex flex-wrap gap-2">
									<UiButton type="button" density="compact" @click="applyObservation(model)">{{
										t('agent.settings.providerManagement.applyObservation')
									}}</UiButton>
									<UiButton type="button" density="compact" @click="lookup(model)">{{
										t('agent.settings.providerManagement.registry')
									}}</UiButton>
								</div>
							</div>
							<UiButton v-else type="button" density="compact" @click="lookup(model)">{{
								t('agent.settings.providerManagement.registry')
							}}</UiButton>
						</div>
						<p class="text-[11px] leading-relaxed text-text-secondary">
							{{ t('agent.settings.providerManagement.modelHelp', { max: AGENT_PROVIDER_MODEL_LIMIT }) }}
						</p>
						<UiButton
							type="button"
							appearance="soft"
							:disabled="draft.models.length >= AGENT_PROVIDER_MODEL_LIMIT"
							@click="addModel()"
							><i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i
							>{{ t('agent.settings.providerManagement.addModel') }}</UiButton
						>
					</section>
				</fieldset>
			</form>
			<div
				v-if="draft && discovered.length"
				class="mt-4 space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h4 class="text-xs font-semibold text-foreground">
						{{ t('agent.settings.providers.discoveredModels') }}
					</h4>
					<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{{
						t('agent.settings.providers.discoveryCount', { count: discovered.length })
					}}</span>
				</div>
				<label class="block text-xs font-medium text-foreground"
					><span class="mb-1 block">{{ t('agent.settings.providerManagement.filter') }}</span>
					<input
						v-model="query"
						class="provider-modal-input h-9 w-full rounded-lg px-3 text-xs outline-none"
					/>
				</label>
				<div class="grid max-h-48 gap-1.5 overflow-auto sm:grid-cols-2">
					<label
						v-for="found in visibleDiscovered"
						:key="found.id"
						class="flex min-w-0 items-center gap-2 rounded-md bg-card/70 px-2.5 py-1.5 text-xs"
						><input
							v-model="selected"
							type="checkbox"
							:value="found.id"
							:disabled="blocked || !draft || draft.models.some((model) => model.id === found.id)"
						/><span class="truncate font-mono">{{ found.id }}</span></label
					>
				</div>
				<div class="flex justify-end">
					<UiButton
						type="button"
						appearance="solid"
						tone="primary"
						:disabled="
							blocked ||
							!draft ||
							selected.length === 0 ||
							draft.models.length >= AGENT_PROVIDER_MODEL_LIMIT
						"
						@click="addSelected"
						>{{ t('agent.settings.providers.addSelected', { count: selected.length }) }}</UiButton
					>
				</div>
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
			panel-class="max-w-md rounded-2xl p-5"
			@close="deleting = null"
		>
			<div class="flex items-start gap-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
					<i class="fa-solid fa-triangle-exclamation text-base" aria-hidden="true"></i>
				</div>
				<p class="text-sm leading-relaxed">
					{{ t('agent.settings.providerManagement.deleteConfirm', { name: deleting?.name }) }}
				</p>
			</div>
			<template #footer
				><div class="flex justify-end gap-2">
					<UiButton type="button" appearance="soft" tone="neutral" @click="deleting = null">{{
						t('common.cancel')
					}}</UiButton>
					<UiButton
						type="button"
						appearance="solid"
						tone="danger"
						:disabled="blocked"
						@click="confirmDelete"
						>{{ t('common.delete') }}</UiButton
					>
				</div></template
			>
		</UiModal>
	</section>
</template>

<style scoped src="./ModelProviderSettings.css"></style>
