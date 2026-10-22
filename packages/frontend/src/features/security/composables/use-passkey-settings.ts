import { useFeedbackMessage } from '@/shared/feedback/public';
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	authErrorKey,
	AuthRequestFailure,
	createAccessApi,
	createPasskeyCeremony,
	useAuthSession,
} from '@/features/auth/public';
import type { PasskeySettingsController, PasskeySummary } from '../model/security-types';
import { toPasskeySummary } from '../model/passkey-mapper';

export function usePasskeySettings(): PasskeySettingsController {
	const { t } = useI18n();
	const auth = useAuthSession();
	const api = createAccessApi().passkeys;
	const passkeys = ref<PasskeySummary[]>([]);
	const names = ref<Record<string, string>>({});
	const editing = ref<string | null>(null);
	const loading = ref(false);
	const needsRefresh = ref(true);
	const message = ref('');
	let failureCause: unknown;
	const success = ref(false);
	useFeedbackMessage(
		() => message.value,
		() => (success.value ? 'success' : 'error'),
		() => failureCause,
	);
	let generation = 0;
	let active = true;
	let disposed = false;
	let controller: AbortController | null = null;

	function reset(): void {
		generation += 1;
		controller?.abort();
		controller = null;
		passkeys.value = [];
		names.value = {};
		editing.value = null;
		loading.value = false;
		needsRefresh.value = true;
	}

	async function readList(signal: AbortSignal): Promise<void> {
		const result = await api.list(signal);
		if (signal.aborted || disposed || !active) {
			return;
		}
		passkeys.value = result.map(toPasskeySummary);
		const drafts: Record<string, string> = {};
		for (const entry of passkeys.value) {
			drafts[entry.credentialId] = entry.name ?? '';
		}
		names.value = drafts;
		editing.value = null;
		needsRefresh.value = false;
	}

	async function execute(work?: (signal: AbortSignal) => Promise<void>, successKey?: string): Promise<void> {
		if (loading.value || !active || disposed || (work !== undefined && needsRefresh.value)) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		failureCause = undefined;
		success.value = false;
		let committed = false;
		try {
			if (work) {
				await work(signal);
				committed = true;
			}
			if (current !== generation || signal.aborted || disposed) {
				return;
			}
			await readList(signal);
			if (current === generation && !signal.aborted && !disposed && successKey) {
				message.value = t(successKey);
				success.value = true;
			}
		} catch (cause) {
			if (current === generation && !disposed) {
				failureCause = cause;
				message.value = t(committed ? 'settings.passkey.error.refreshAfterChange' : authErrorKey(cause));
				if (
					committed ||
					!work ||
					!(cause instanceof AuthRequestFailure) ||
					cause.outcome === 'unknown' ||
					cause.code === 'unauthenticated'
				) {
					needsRefresh.value = true;
				}
			}
		} finally {
			if (current === generation && !disposed) {
				loading.value = false;
				controller = null;
			}
		}
	}

	function register(): Promise<void> {
		return execute(async (signal) => {
			const options = await api.registrationOptions(signal);
			const credential = await createPasskeyCeremony().register(options, signal);
			await api.register(credential, signal);
		}, 'settings.passkey.success.registered');
	}

	function saveName(key: PasskeySummary): Promise<void> {
		const name = names.value[key.credentialId]?.trim() ?? '';
		return execute(async (signal) => {
			await api.rename(key.credentialId, name, signal);
		}, 'settings.passkey.success.nameUpdated');
	}

	function remove(key: PasskeySummary): Promise<void> {
		return execute(async (signal) => {
			await api.remove(key.credentialId, signal);
		}, 'settings.passkey.success.deleted');
	}

	function refresh(): Promise<void> {
		return execute();
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset);
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
	return { passkeys, names, editing, loading, needsRefresh, message, success, refresh, register, saveName, remove };
}
