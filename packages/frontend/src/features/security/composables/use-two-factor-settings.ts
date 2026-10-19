import { onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { authErrorKey, AuthRequestFailure, createAccessApi, useAuthSession } from '@/features/auth/public';
import type { TotpSetup, TwoFactorSettingsController } from '../model/security-types';

export function useTwoFactorSettings(enabled: () => boolean, changed: () => void): TwoFactorSettingsController {
	const { t } = useI18n();
	const setup = ref<TotpSetup | null>(null);
	const verificationCode = ref('');
	const disablePassword = ref('');
	const loading = ref(false);
	const message = ref('');
	const success = ref(false);
	const api = createAccessApi();
	const auth = useAuthSession();
	const needsRefresh = ref(false);
	let generation = 0;
	let disposed = false;
	let active = true;
	let controller: AbortController | null = null;

	function reset(): void {
		generation += 1;
		controller?.abort();
		controller = null;
		setup.value = null;
		verificationCode.value = '';
		disablePassword.value = '';
		loading.value = false;
	}

	async function execute(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
		if (loading.value || disposed || !active || needsRefresh.value) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		success.value = false;
		try {
			await operation(signal);
		} catch (cause) {
			if (current === generation && !disposed) {
				message.value = t(authErrorKey(cause));
				if (!(cause instanceof AuthRequestFailure) || cause.outcome === 'unknown') {
					needsRefresh.value = true;
					setup.value = null;
					verificationCode.value = '';
					disablePassword.value = '';
				}
			}
		} finally {
			if (current === generation && !disposed) {
				loading.value = false;
				controller = null;
			}
		}
	}

	function begin(): Promise<void> {
		return execute(async (signal) => {
			const result = await api.beginTotpSetup(signal);
			if (signal.aborted || disposed) {
				return;
			}
			setup.value = { secret: result.secret, qrCodeUrl: result.qrCodeUrl };
		});
	}

	function activate(): Promise<void> {
		const token = verificationCode.value;
		return execute(async (signal) => {
			await api.activateTotp(token, signal);
			if (signal.aborted || disposed) {
				return;
			}
			setup.value = null;
			verificationCode.value = '';
			message.value = t('settings.twoFactor.success.activated');
			success.value = true;
			changed();
		});
	}

	function disable(): Promise<void> {
		const password = disablePassword.value;
		return execute(async (signal) => {
			await api.disableTotp(password, signal);
			if (signal.aborted || disposed) {
				return;
			}
			disablePassword.value = '';
			message.value = t('settings.twoFactor.success.disabled');
			success.value = true;
			changed();
		});
	}

	async function refresh(): Promise<void> {
		if (loading.value || disposed || !active) {
			return;
		}
		const current = ++generation;
		loading.value = true;
		const state = await auth.refreshSession();
		if (current !== generation || disposed) {
			return;
		}
		loading.value = false;
		if (state === 'authenticated') {
			needsRefresh.value = false;
			reset();
			message.value = '';
		} else {
			message.value = t(state === 'anonymous' ? 'auth.errors.expired' : 'auth.errors.unknown');
		}
	}

	watch(enabled, () => {
		// Recovery owns its generation until the authoritative status probe returns.
		if (!needsRefresh.value) {
			reset();
		}
	});
	onActivated(() => {
		active = true;
	});
	onDeactivated(() => {
		active = false;
		if (loading.value) {
			needsRefresh.value = true;
		}
		reset();
	});
	onBeforeUnmount(() => {
		disposed = true;
		reset();
	});

	return {
		setup,
		verificationCode,
		disablePassword,
		loading,
		message,
		success,
		needsRefresh,
		begin,
		activate,
		disable,
		refresh,
		cancel: reset,
	};
}
