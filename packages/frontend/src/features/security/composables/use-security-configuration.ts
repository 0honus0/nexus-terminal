import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthSession } from '@/features/auth/public';
import {
	configurationApi,
	ConfigurationFailure,
	type CoreConfiguration,
	type CaptchaDraft,
	type NetworkPolicy,
} from '@/features/preferences/public';

import type { SecurityConfigurationController } from '../model/security-types';

function failureKey(cause: unknown, committed: boolean): string {
	if (committed) {
		return 'settings.configuration.refreshAfterChange';
	}
	if (!(cause instanceof ConfigurationFailure) || cause.outcome === 'unknown') {
		return 'settings.configuration.unknown';
	}
	if (cause.code === 'version_conflict') {
		return 'settings.configuration.conflict';
	}
	return cause.code === 'invalid_input' ? 'auth.errors.invalidInput' : 'auth.errors.generic';
}

export function useSecurityConfiguration(): SecurityConfigurationController {
	const { t } = useI18n();
	const auth = useAuthSession();
	const snapshot = ref<CoreConfiguration | null>(null);
	const network = ref<NetworkPolicy>({
		whitelist: '',
		blacklistEnabled: true,
		maxLoginAttempts: 5,
		loginBanDuration: 300,
	});
	const captcha = ref<CaptchaDraft>({
		enabled: false,
		provider: 'none',
		siteKey: '',
		hostname: '',
		secretAction: 'keep',
		secretValue: '',
	});
	const loading = ref(false);
	const needsRefresh = ref(true);
	const message = ref('');
	const success = ref(false);
	let generation = 0;
	let active = true;
	let disposed = false;
	let controller: AbortController | null = null;

	function reset(): void {
		generation += 1;
		controller?.abort();
		controller = null;
		snapshot.value = null;
		captcha.value = {
			enabled: false,
			provider: 'none',
			siteKey: '',
			hostname: '',
			secretAction: 'keep',
			secretValue: '',
		};
		network.value = { whitelist: '', blacklistEnabled: true, maxLoginAttempts: 5, loginBanDuration: 300 };
		loading.value = false;
		needsRefresh.value = true;
		message.value = '';
		success.value = false;
	}

	function publish(value: CoreConfiguration): void {
		snapshot.value = value;
		network.value = {
			whitelist: value.network.whitelist,
			blacklistEnabled: value.network.blacklistEnabled,
			maxLoginAttempts: value.network.maxLoginAttempts,
			loginBanDuration: value.network.loginBanDuration,
		};
		captcha.value = {
			enabled: value.captcha.enabled,
			provider: value.captcha.provider,
			siteKey: value.captcha.siteKey,
			hostname: value.captcha.hostname,
			secretAction: 'keep',
			secretValue: '',
		};
		needsRefresh.value = false;
	}

	async function execute(work?: (signal: AbortSignal) => Promise<CoreConfiguration | void>): Promise<void> {
		if (loading.value || disposed || !active || (work && (needsRefresh.value || !snapshot.value))) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		success.value = false;
		let committed = false;
		try {
			let result = work ? await work(signal) : await configurationApi.get(signal);
			committed = work !== undefined;
			if (!result && current === generation && !signal.aborted) {
				result = await configurationApi.get(signal);
			}
			if (current !== generation || signal.aborted || disposed || !result) {
				return;
			}
			publish(result);
			if (work) {
				message.value = t('settings.configuration.saved');
				success.value = true;
			}
		} catch (cause) {
			if (current !== generation || disposed) {
				return;
			}
			const conflict = cause instanceof ConfigurationFailure && cause.code === 'version_conflict';
			const unknown = !(cause instanceof ConfigurationFailure) || cause.outcome === 'unknown';
			message.value = t(failureKey(cause, committed));
			if (
				committed ||
				conflict ||
				unknown ||
				!work ||
				(cause instanceof ConfigurationFailure && cause.code === 'unauthenticated')
			) {
				needsRefresh.value = true;
			}
		} finally {
			if (current === generation && !disposed) {
				loading.value = false;
				controller = null;
				captcha.value.secretValue = '';
			}
		}
	}

	function refresh(): Promise<void> {
		return execute();
	}

	async function saveNetwork(changes?: Partial<NetworkPolicy>): Promise<void> {
		const original = snapshot.value;
		if (!original) {
			return;
		}
		const draft = network.value;
		const input: NetworkPolicy = {
			whitelist: changes ? (changes.whitelist ?? original.network.whitelist) : draft.whitelist,
			blacklistEnabled: changes
				? (changes.blacklistEnabled ?? original.network.blacklistEnabled)
				: draft.blacklistEnabled,
			maxLoginAttempts: changes
				? (changes.maxLoginAttempts ?? original.network.maxLoginAttempts)
				: draft.maxLoginAttempts,
			loginBanDuration: changes
				? (changes.loginBanDuration ?? original.network.loginBanDuration)
				: draft.loginBanDuration,
		};
		const current = generation;
		await execute((signal) => configurationApi.saveNetwork(original, input, signal));
		if (changes && generation === current + 1 && success.value) {
			// A switch saves its own field without submitting or clearing neighbouring drafts.
			network.value = {
				whitelist: changes.whitelist ?? draft.whitelist,
				blacklistEnabled: changes.blacklistEnabled ?? draft.blacklistEnabled,
				maxLoginAttempts: changes.maxLoginAttempts ?? draft.maxLoginAttempts,
				loginBanDuration: changes.loginBanDuration ?? draft.loginBanDuration,
			};
		}
	}

	function saveCaptcha(): Promise<void> {
		return execute((signal) => {
			const original = snapshot.value;
			if (!original) {
				throw new ConfigurationFailure('invalid_input', 'not_dispatched');
			}
			return configurationApi.saveCaptcha(original.revision, captcha.value, signal);
		});
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset);
	watch(
		() => captcha.value.secretAction,
		(action) => {
			if (action !== 'replace') {
				captcha.value.secretValue = '';
			}
		},
	);
	onMounted(refresh);
	onActivated(() => {
		active = true;
		if (needsRefresh.value) {
			void refresh();
		}
	});
	onDeactivated(() => {
		active = false;
		reset();
	});
	onBeforeUnmount(() => {
		disposed = true;
		reset();
	});
	return { snapshot, network, captcha, loading, needsRefresh, message, success, refresh, saveNetwork, saveCaptcha };
}
