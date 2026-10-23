<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiEmptyState,
		UiFormActions,
		UiFormField,
		UiInfoHint,
		UiInlineNotice,
		UiInput,
		UiModal,
		UiResizeHandle,
		UiSelect,
		UiSwitch,
	} from '@/foundation/ui';
	import type { UiSelectOption, UiSelectValue } from '@/foundation/ui';
	import { useDeviceCapabilities } from '@/foundation/browser';
	import { useFeedback, useFeedbackMessage } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import {
		AGENT_PROVIDER_MAX_MODEL_ID_BYTES,
		AGENT_PROVIDER_MAX_NAME_BYTES,
		AGENT_PROVIDER_MAX_SECRET_BYTES,
		AGENT_PROVIDER_MAX_URL_BYTES,
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
	const feedback = useFeedback();
	const device = useDeviceCapabilities();
	const canResizePanel = computed(
		() => !device.isMobile.value && !device.isNarrowViewport.value && !device.hasCoarsePointer.value,
	);
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
		save: saveDraft,
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
	const validationAttempted = ref(false);
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

		canStart: () => canResizePanel.value,
	});
	watch(canResizePanel, (canResize) => {
		if (canResize) return;
		resize.stopResize();
		resized.value = false;
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
			validationAttempted.value = false;
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
	const isNewProvider = computed(() => draft.value !== null && draft.value.id === null);
	const credentialValue = computed({
		get: () => (draft.value?.credential.action === 'replace' ? draft.value.credential.value : ''),

		set: (value: string) => {
			if (draft.value?.credential.action === 'replace') draft.value.credential.value = value;
		},
	});
	const protocolOptions = computed<UiSelectOption[]>(() => [
		{ value: 'chat-completions', label: t('agent.settings.providers.protocolChat') },
		{ value: 'responses', label: t('agent.settings.providers.protocolResponses') },
	]);
	const credentialOptions = computed<UiSelectOption[]>(() => [
		{ value: 'keep', label: t('agent.settings.providerManagement.keep') },
		{ value: 'replace', label: t('agent.settings.providerManagement.replace') },
		{ value: 'clear', label: t('agent.settings.providerManagement.clear') },
	]);

	interface ModelValidation {
		id?: string;
		contextWindow?: string;
		maxOutputTokens?: string;
	}

	interface ProviderValidation {
		name?: string;
		baseUrl?: string;
		credential?: string;
		models: ModelValidation[];
		messages: string[];
	}

	function utf8Bytes(value: string): number {
		return new TextEncoder().encode(value).length;
	}

	function endpointError(value: string): string | undefined {
		const trimmed = value.trim();
		if (!trimmed) return t('agent.settings.providerManagement.validation.endpointRequired');
		if (utf8Bytes(trimmed) > AGENT_PROVIDER_MAX_URL_BYTES) {
			return t('agent.settings.providerManagement.validation.endpointTooLong', {
				max: AGENT_PROVIDER_MAX_URL_BYTES,
			});
		}
		try {
			const url = new URL(trimmed);
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
				return t('agent.settings.providerManagement.validation.endpointInvalid');
			}
		} catch {
			return t('agent.settings.providerManagement.validation.endpointInvalid');
		}
		return undefined;
	}

	const validation = computed<ProviderValidation>(() => {
		const value = draft.value;
		if (!value) return { models: [], messages: [] };
		const messages = new Set<string>();
		const result: ProviderValidation = { models: [], messages: [] };

		const name = value.name.trim();
		if (!name) result.name = t('agent.settings.providerManagement.validation.nameRequired');
		else if (utf8Bytes(name) > AGENT_PROVIDER_MAX_NAME_BYTES) {
			result.name = t('agent.settings.providerManagement.validation.nameTooLong', {
				max: AGENT_PROVIDER_MAX_NAME_BYTES,
			});
		}
		if (result.name) messages.add(result.name);

		result.baseUrl = endpointError(value.baseUrl);
		if (result.baseUrl) messages.add(result.baseUrl);

		if (value.credential.action === 'replace') {
			if (!value.credential.value) {
				result.credential = t('agent.settings.providerManagement.validation.credentialRequired');
			} else if (utf8Bytes(value.credential.value) > AGENT_PROVIDER_MAX_SECRET_BYTES) {
				result.credential = t('agent.settings.providerManagement.validation.credentialTooLong', {
					max: AGENT_PROVIDER_MAX_SECRET_BYTES,
				});
			}
		} else if (value.id === null) {
			result.credential = t('agent.settings.providerManagement.validation.credentialRequired');
		}
		if (result.credential) messages.add(result.credential);

		if (value.models.length === 0) {
			messages.add(t('agent.settings.providerManagement.validation.modelsRequired'));
		} else if (value.models.length > AGENT_PROVIDER_MODEL_LIMIT) {
			messages.add(
				t('agent.settings.providerManagement.validation.modelLimit', {
					max: AGENT_PROVIDER_MODEL_LIMIT,
				}),
			);
		}

		const idCounts = new Map<string, number>();
		for (const model of value.models) {
			const id = model.id.trim();
			if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
		}

		result.models = value.models.map((model) => {
			const errors: ModelValidation = {};
			const id = model.id.trim();
			if (!id) errors.id = t('agent.settings.providerManagement.validation.modelIdRequired');
			else if (utf8Bytes(id) > AGENT_PROVIDER_MAX_MODEL_ID_BYTES) {
				errors.id = t('agent.settings.providerManagement.validation.modelIdTooLong', {
					max: AGENT_PROVIDER_MAX_MODEL_ID_BYTES,
				});
			} else if ((idCounts.get(id) ?? 0) > 1) {
				errors.id = t('agent.settings.providerManagement.validation.modelIdDuplicate');
			}
			if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1) {
				errors.contextWindow = t('agent.settings.providerManagement.validation.contextWindowInvalid');
			}
			if (!Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens < 1) {
				errors.maxOutputTokens = t('agent.settings.providerManagement.validation.maxOutputTokensInvalid');
			} else if (
				Number.isSafeInteger(model.contextWindow) &&
				model.contextWindow > 0 &&
				model.maxOutputTokens > model.contextWindow
			) {
				errors.maxOutputTokens = t('agent.settings.providerManagement.validation.outputExceedsContext');
			}
			if (errors.id) messages.add(errors.id);
			if (errors.contextWindow) messages.add(errors.contextWindow);
			if (errors.maxOutputTokens) messages.add(errors.maxOutputTokens);
			return errors;
		});

		result.messages = [...messages];
		return result;
	});

	watch(notice, (value) => {
		if (!value) return;
		const message = t('agent.settings.providerManagement.' + value);
		if (['invalid', 'failed', 'unknown', 'conflict', 'inUse'].includes(value)) {
			feedback.notifyError(message);
		} else if (['saved', 'deleted', 'discovered', 'registryApplied'].includes(value)) {
			feedback.notifySuccess(message);
		} else {
			feedback.notifyInfo(message);
		}
	});

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

	function setProtocol(value: UiSelectValue): void {
		if (!draft.value) return;
		if (value === 'chat-completions' || value === 'responses') {
			draft.value.protocol = value;
		}
	}

	function setCredential(value: UiSelectValue): void {
		if (!draft.value) return;
		showApiKey.value = false;
		if (value === 'replace') {
			draft.value.credential = { action: 'replace', value: '' };
		} else if (value === 'clear') {
			draft.value.credential = { action: 'clear' };
		} else {
			draft.value.credential = { action: 'keep' };
		}
	}

	function toggleSelected(id: string, checked: boolean): void {
		const next = new Set(selected.value);
		if (checked) next.add(id);
		else next.delete(id);
		selected.value = [...next];
	}

	async function saveProvider(): Promise<void> {
		if (!draft.value || blocked.value) return;
		draft.value.name = draft.value.name.trim();
		draft.value.baseUrl = draft.value.baseUrl.trim();
		for (const model of draft.value.models) model.id = model.id.trim();
		validationAttempted.value = true;
		if (validation.value.messages.length > 0) {
			feedback.notifyError(validation.value.messages.join(' '));
			await nextTick();
			document.querySelector<HTMLElement>('#provider-editor [aria-invalid="true"]')?.focus();
			return;
		}
		await saveDraft();
	}

	function startResize(event: PointerEvent): void {
		if (!canResizePanel.value || event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
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

	useFeedbackMessage(
		() => {
			const result = testResult.value;
			if (!result || !testingModelId.value) return '';
			const message = t(
				result.ok ? 'agent.settings.providerManagement.testOk' : 'agent.settings.providerManagement.testFailed',
				{ ms: result.latencyMs },
			);
			return (
				testingModelId.value + ' · ' + message + (result.ok ? '' : ' · ' + testFailureMessage(result.errorCode))
			);
		},
		() => (testResult.value?.ok ? 'success' : 'error'),
	);
</script>

<template>
	<section
		class="relative z-20 rounded-2xl border border-border bg-card shadow-xs transition-all"
		:aria-label="t('agent.settings.providerManagement.title')"
	>
		<div
			class="agent-settings-head flex items-center justify-between gap-2 rounded-t-2xl border-b border-border bg-header/50 px-4 py-3 sm:gap-3 sm:px-5 sm:py-3.5"
		>
			<div class="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
				<h3 class="min-w-0 truncate text-sm font-semibold text-foreground">
					{{ t('agent.settings.providers.title') }}
				</h3>
				<span
					class="shrink-0 whitespace-nowrap rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary sm:px-2.5"
				>
					<span class="hidden sm:inline">{{
						t('agent.settings.providers.counts', { providers: providers.length, models: modelCount })
					}}</span>
					<span class="sm:hidden">{{ providers.length }}/{{ modelCount }}</span>
				</span>
				<UiInfoHint :text="t('agent.settings.providers.description')" class="shrink-0" />
			</div>
			<UiButton
				type="button"
				appearance="soft"
				tone="neutral"
				:disabled="blocked || draft !== null"
				class="w-auto shrink-0 whitespace-nowrap px-3 sm:px-3.5"
				@click="edit(null)"
			>
				<span class="inline-flex items-center gap-1.5 text-xs"
					><i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
					<span class="provider-add-label provider-add-label--full">{{
						t('agent.settings.providers.add')
					}}</span>
					<span class="provider-add-label provider-add-label--short">{{
						t('agent.settings.providers.addShort')
					}}</span></span
				>
			</UiButton>
		</div>
		<div class="space-y-4 p-4 sm:p-5">
			<ModelRegistrySettings />
			<div v-if="refreshRequired && !busy" class="flex justify-end">
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
								<UiBadge :tone="provider.enabled ? 'success' : 'neutral'" density="compact" dot>
									{{
										t(
											provider.enabled
												? 'agent.settings.providerManagement.enabled'
												: 'agent.settings.providerManagement.disabled',
										)
									}}
								</UiBadge>
								<UiBadge appearance="ghost" density="compact"
									><i class="fa-solid fa-key text-[9px] text-primary/75" aria-hidden="true"></i
									>{{
										t(
											provider.hasCredential
												? 'agent.settings.providers.credentialStored'
												: 'agent.settings.providers.noCredential',
										)
									}}</UiBadge
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
						<UiBadge appearance="ghost" density="compact" class="font-mono">{{
							provider.models.length
						}}</UiBadge>
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
				<UiInlineNotice v-if="refreshRequired" tone="warning" compact>
					{{ t('agent.settings.providerManagement.refreshRequired') }}
					<template #actions>
						<UiButton type="button" density="compact" :disabled="busy" @click="load">{{
							t('agent.settings.providerManagement.read')
						}}</UiButton>
					</template>
				</UiInlineNotice>
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
								:loading="busy && testingModelId === model.id"
								:disabled="blocked || draft !== null || !testingProvider.enabled"
								@click="testModel(testingProvider, model.id)"
								><i class="fa-solid fa-vial text-[10px]" aria-hidden="true"></i
								>{{ t('agent.settings.providerManagement.test') }}</UiButton
							>
						</div>
						<div class="mt-2 flex flex-wrap gap-1.5">
							<UiBadge appearance="ghost" density="compact" class="font-mono">
								{{ t('agent.settings.providers.contextShort', { value: model.contextWindow }) }}
							</UiBadge>
							<UiBadge appearance="ghost" density="compact" class="font-mono">
								{{ t('agent.settings.providers.outputShort', { value: model.maxOutputTokens }) }}
							</UiBadge>
							<UiBadge v-if="model.supportsTools" tone="primary" density="compact">
								{{ t('agent.settings.providers.toolCapable') }}
							</UiBadge>
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
				><UiFormActions>
					<UiButton type="button" appearance="soft" tone="neutral" :disabled="busy" @click="closeTests">{{
						t('common.close')
					}}</UiButton>
				</UiFormActions></template
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
			content-class="provider-add-content"
			@close="cancel"
		>
			<template v-if="canResizePanel" #panel-overlay>
				<UiResizeHandle
					class="provider-add-resize-handle absolute bottom-0 right-0 z-40"
					:disabled="!canResizePanel"
					:title="t('agent.settings.providers.resize')"
					:aria-label="t('agent.settings.providers.resize')"
					@pointerdown.stop="startResize"
				/>
			</template>
			<p class="mb-4 text-xs leading-relaxed text-text-secondary">
				{{ t('agent.settings.providers.modalDescription') }}
			</p>
			<UiInlineNotice v-if="refreshRequired" class="mb-3" tone="warning" compact>
				{{ t('agent.settings.providerManagement.refreshRequired') }}
				<template #actions>
					<UiButton type="button" density="compact" :disabled="busy" @click="load">{{
						t('agent.settings.providerManagement.read')
					}}</UiButton>
				</template>
			</UiInlineNotice>
			<form v-if="draft" id="provider-editor" class="space-y-4" @submit.prevent="saveProvider">
				<fieldset :disabled="blocked" class="min-w-0 space-y-4">
					<section class="space-y-3 rounded-xl bg-header/20 p-3.5 sm:p-4">
						<h4 class="flex items-center gap-2 text-xs font-semibold text-foreground">
							<i class="fa-solid fa-server text-[11px] text-primary" aria-hidden="true"></i>
							{{ t('agent.settings.providers.title') }}
						</h4>
						<UiFormField
							:label="t('agent.settings.providerManagement.name')"
							for-id="provider-name"
							:error="validationAttempted ? validation.name : undefined"
							required
						>
							<UiInput id="provider-name" v-model="draft.name" autocomplete="off" />
						</UiFormField>
						<UiFormField
							:label="t('agent.settings.providerManagement.endpoint')"
							for-id="provider-endpoint"
							:error="validationAttempted ? validation.baseUrl : undefined"
							required
						>
							<UiInput
								id="provider-endpoint"
								v-model="draft.baseUrl"
								type="url"
								autocomplete="off"
								spellcheck="false"
								class="font-mono"
							/>
						</UiFormField>
						<div class="grid gap-3 sm:grid-cols-2 sm:items-end">
							<UiFormField :label="t('agent.settings.providers.protocol')" for-id="provider-protocol">
								<UiSelect
									id="provider-protocol"
									:model-value="draft.protocol"
									:options="protocolOptions"
									@update:model-value="setProtocol"
								/>
							</UiFormField>
							<label
								for="provider-enabled"
								class="flex h-9 cursor-pointer items-center justify-between gap-3 rounded-xl bg-card px-3 text-xs text-foreground sm:h-8 sm:self-end"
							>
								<span>{{ t('agent.settings.providerManagement.enabled') }}</span>
								<UiSwitch id="provider-enabled" v-model="draft.enabled" />
							</label>
						</div>
					</section>

					<section class="space-y-3 rounded-xl bg-header/20 p-3.5 sm:p-4">
						<h4 class="flex items-center gap-2 text-xs font-semibold text-foreground">
							<i class="fa-solid fa-key text-[11px] text-primary" aria-hidden="true"></i>
							{{ t('agent.settings.providerManagement.credential') }}
						</h4>
						<UiFormField
							v-if="!isNewProvider"
							:label="t('agent.settings.providerManagement.credentialAction')"
							for-id="provider-credential-action"
						>
							<UiSelect
								id="provider-credential-action"
								:model-value="draft.credential.action"
								:options="credentialOptions"
								@update:model-value="setCredential"
							/>
						</UiFormField>
						<div v-if="isNewProvider || draft.credential.action === 'replace'" class="space-y-1">
							<label
								v-if="isNewProvider"
								for="provider-credential"
								class="block text-xs font-medium text-foreground"
							>
								{{ t('agent.settings.providerManagement.credential') }}
							</label>
							<div class="flex items-start gap-2">
								<div class="min-w-0 flex-1 space-y-1">
									<UiInput
										id="provider-credential"
										v-model="credentialValue"
										:type="showApiKey ? 'text' : 'password'"
										autocomplete="new-password"
										:aria-label="t('agent.settings.providerManagement.credential')"
										:invalid="validationAttempted && Boolean(validation.credential)"
										class="font-mono"
									/>
									<p
										v-if="validationAttempted && validation.credential"
										class="text-xs text-error"
										role="alert"
									>
										{{ validation.credential }}
									</p>
								</div>
								<UiButton type="button" appearance="ghost" @click="showApiKey = !showApiKey">
									<i
										:class="showApiKey ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"
										class="text-[10px]"
										aria-hidden="true"
									></i>
									{{
										t(
											showApiKey
												? 'agent.settings.providers.hideCredential'
												: 'agent.settings.providers.showCredential',
										)
									}}
								</UiButton>
							</div>
						</div>
						<p class="text-[11px] leading-relaxed text-text-secondary">
							{{ t('agent.settings.providerManagement.secretHelp') }}
						</p>
					</section>

					<section class="space-y-3 rounded-xl bg-header/20 p-3.5 sm:p-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h4 class="flex items-center gap-2 text-xs font-semibold text-foreground">
								<i class="fa-solid fa-brain text-[11px] text-primary" aria-hidden="true"></i>
								{{ t('agent.settings.providers.configuredModels') }}
								<UiBadge appearance="ghost" density="compact" class="font-mono"
									>{{ draft.models.length }} / {{ AGENT_PROVIDER_MODEL_LIMIT }}</UiBadge
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
							class="space-y-3 rounded-xl bg-card/65 p-3.5"
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
								:errors="validationAttempted ? validation.models[index] : undefined"
								@update:model-value="(value) => draft?.models.splice(index, 1, value)"
							/>
							<div
								v-if="currentProvider?.models.find((item) => item.id === model.id)?.observation"
								class="space-y-2 rounded-lg bg-header/25 p-2.5 text-[11px] text-text-secondary"
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
					<UiBadge tone="primary" appearance="ghost" density="compact">{{
						t('agent.settings.providers.discoveryCount', { count: discovered.length })
					}}</UiBadge>
				</div>
				<UiFormField :label="t('agent.settings.providerManagement.filter')" for-id="discovered-model-filter">
					<UiInput id="discovered-model-filter" v-model="query" autocomplete="off" />
				</UiFormField>
				<div class="grid max-h-48 gap-1.5 overflow-auto sm:grid-cols-2">
					<label
						v-for="found in visibleDiscovered"
						:key="found.id"
						class="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-card/70 px-2.5 py-1.5 text-xs"
						><UiCheckbox
							:model-value="selected.includes(found.id)"
							:disabled="blocked || !draft || draft.models.some((model) => model.id === found.id)"
							@update:model-value="toggleSelected(found.id, $event)"
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
				<UiFormActions>
					<UiButton
						type="submit"
						form="provider-editor"
						appearance="solid"
						tone="primary"
						:disabled="blocked"
						>{{ t('common.save') }}</UiButton
					>
					<UiButton type="button" appearance="soft" tone="neutral" :disabled="busy" @click="cancel">{{
						t('common.cancel')
					}}</UiButton>
				</UiFormActions>
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
				><UiFormActions>
					<UiButton
						type="button"
						appearance="solid"
						tone="danger"
						:disabled="blocked"
						@click="confirmDelete"
						>{{ t('common.delete') }}</UiButton
					>
					<UiButton type="button" appearance="soft" tone="neutral" @click="deleting = null">{{
						t('common.cancel')
					}}</UiButton>
				</UiFormActions></template
			>
		</UiModal>
	</section>
</template>

<style scoped src="./ModelProviderSettings.css"></style>
