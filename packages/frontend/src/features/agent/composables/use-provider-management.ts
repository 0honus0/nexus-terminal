import { computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
import {
	deleteManagedProvider,
	discoverManagedProvider,
	discoverProviderEndpoint,
	listManagedProviders,
	saveManagedProvider,
	testManagedProvider,
} from '../api/provider-management-api';
import { resolveModelRegistry } from '../api/registry-api';
import { AgentManagementFailure } from '../model/management-failure';
import { createProviderDraft } from '../model/provider-mapper';
import type {
	DiscoveredProviderModel,
	Provider,
	ProviderDraft,
	ProviderModelDraft,
	ProviderTestResult,
} from '../model/provider-types';
import { agentHostEvents } from '../events/agent-host-events';

export function useProviderManagement(options: { available?: () => boolean } = {}) {
	const providers = ref<Provider[]>([]);
	const draft = ref<ProviderDraft | null>(null);
	const discovered = ref<DiscoveredProviderModel[]>([]);
	const testResult = ref<ProviderTestResult | null>(null);
	const busy = ref(false);
	const refreshRequired = ref(true);
	const notice = ref('');
	const loaded = ref(false);
	let generation = 0;
	const scope = useAuthenticatedViewScope({
		available: options.available,

		onRevoke() {
			generation += 1;
			providers.value = [];
			draft.value = null;
			discovered.value = [];
			testResult.value = null;
			busy.value = false;
			loaded.value = false;
			refreshRequired.value = true;
			notice.value = '';
		},
	});
	const blocked = computed(() => busy.value || refreshRequired.value);

	function edit(provider: Provider | null): void {
		if (blocked.value) {
			return;
		}
		draft.value = createProviderDraft(provider);
		discovered.value = [];
		testResult.value = null;
		notice.value = '';
	}

	function cancel(): void {
		if (busy.value) {
			return;
		}
		draft.value = null;
		discovered.value = [];
		testResult.value = null;
	}

	async function perform<T>(
		action: (signal: AbortSignal) => Promise<T>,
		accept: (value: T) => void,
		mutation: boolean,
	): Promise<void> {
		if (busy.value || (mutation && refreshRequired.value)) {
			return;
		}
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++generation;
		busy.value = true;
		notice.value = '';
		testResult.value = null;
		try {
			const value = await action(signal);
			if (generation !== current || !scope.isCurrent(signal)) {
				return;
			}
			accept(value);
		} catch (cause) {
			if (generation !== current || !scope.isCurrent(signal)) {
				return;
			}
			const failure = cause instanceof AgentManagementFailure ? cause : null;
			if (failure?.code === 'version_conflict' || failure?.code === 'provider_configuration_stale') {
				notice.value = 'conflict';
			} else if (failure?.code === 'invalid_input') {
				notice.value = 'invalid';
			} else if (failure?.code === 'provider_in_use') {
				notice.value = 'inUse';
			} else {
				notice.value = mutation && (!failure || failure.outcome === 'unknown') ? 'unknown' : 'failed';
			}
			if (mutation && (!failure || failure.outcome !== 'not_dispatched')) {
				refreshRequired.value = true;
			}
		} finally {
			if (generation === current && scope.isCurrent(signal)) {
				busy.value = false;
			}
		}
	}

	async function load(): Promise<void> {
		await perform(
			listManagedProviders,
			(value) => {
				providers.value = value;
				draft.value = null;
				discovered.value = [];
				loaded.value = true;
				refreshRequired.value = false;
			},
			false,
		);
	}

	async function save(): Promise<void> {
		if (!draft.value || blocked.value) {
			return;
		}
		const original = draft.value;
		const input = structuredClone(toRaw(draft.value));
		await perform(
			(signal) => saveManagedProvider(input, signal),
			(value) => {
				providers.value = [value, ...providers.value.filter((item) => item.id !== value.id)];
				draft.value = null;
				discovered.value = [];
				notice.value = 'saved';
				agentHostEvents.emit('configuration-changed', { origin: 'local' });
			},
			true,
		);
		// A dispatched credential is never retained for an accidental second submission.
		if (draft.value === original) {
			draft.value.credential = { action: 'keep' };
		}
	}

	async function setEnabled(provider: Provider, enabled: boolean): Promise<void> {
		if (blocked.value || draft.value !== null || provider.enabled === enabled) {
			return;
		}
		const input = createProviderDraft(provider);
		input.enabled = enabled;
		await perform(
			(signal) => saveManagedProvider(input, signal),
			(value) => {
				providers.value = providers.value.map((item) => (item.id === value.id ? value : item));
				notice.value = 'saved';
				agentHostEvents.emit('configuration-changed', { origin: 'local' });
			},
			true,
		);
	}

	async function remove(provider: Provider): Promise<void> {
		if (draft.value !== null) {
			return;
		}
		await perform(
			(signal) => deleteManagedProvider(provider, signal),
			() => {
				providers.value = providers.value.filter((item) => item.id !== provider.id);
				notice.value = 'deleted';
				agentHostEvents.emit('configuration-changed', { origin: 'local' });
			},
			true,
		);
	}

	async function discover(provider: Provider | null): Promise<void> {
		if (blocked.value || (provider !== null && draft.value !== null)) {
			return;
		}
		const input = draft.value === null ? null : structuredClone(toRaw(draft.value));
		if (!provider && (!input || input.id !== null)) {
			return;
		}
		discovered.value = [];
		await perform(
			async (signal) => {
				if (provider) {
					const found = await discoverManagedProvider(provider.id, signal);
					const updated = await listManagedProviders(signal);
					return { found, updated };
				}
				if (!input) {
					throw new AgentManagementFailure('invalid_input', 'not_dispatched');
				}
				const found = await discoverProviderEndpoint(
					input.baseUrl,
					input.credential.action === 'replace' ? input.credential.value : undefined,
					signal,
				);
				return { found, updated: null };
			},
			(value) => {
				discovered.value = value.found;
				if (provider && value.updated) {
					providers.value = value.updated;
					const selected = value.updated.find((item) => item.id === provider.id);
					draft.value = selected ? createProviderDraft(selected) : null;
					agentHostEvents.emit('configuration-changed', { origin: 'local' });
				}
				notice.value = value.found.length === 0 ? 'noModels' : 'discovered';
			},
			true,
		);
	}

	async function test(provider: Provider, modelId: string): Promise<void> {
		if (draft.value !== null) {
			return;
		}
		await perform(
			(signal) => testManagedProvider(provider.id, modelId, signal),
			(value) => {
				testResult.value = value;
			},
			true,
		);
	}

	async function lookup(model: ProviderModelDraft): Promise<void> {
		if (!draft.value || blocked.value) {
			return;
		}
		const currentDraft = draft.value;
		const id = model.id;
		await perform(
			(signal) => resolveModelRegistry(id, signal),
			(value) => {
				if (draft.value !== currentDraft || model.id !== id) {
					return;
				}
				if (!value) {
					notice.value = 'noRegistry';
					return;
				}
				model.contextWindow = value.contextWindow;
				model.maxOutputTokens = value.maxOutputTokens;
				if (value.supportsTools !== undefined) {
					model.supportsTools = value.supportsTools;
				}
				model.supportsImageInput = value.supportsImageInput;
				model.supportsFileInput = value.supportsFileInput;
				model.reasoningEfforts = value.reasoningEfforts?.map((effort) => effort);
				model.defaultReasoningEffort = undefined;
				model.reasoningMandatory = undefined;
				notice.value = 'registryApplied';
			},
			false,
		);
	}

	function loadInitial(): void {
		if (!loaded.value && (options.available?.() ?? true)) {
			void load();
		}
	}

	watch(() => options.available?.() ?? true, loadInitial);
	onMounted(loadInitial);
	onActivated(loadInitial);
	return {
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
	};
}
