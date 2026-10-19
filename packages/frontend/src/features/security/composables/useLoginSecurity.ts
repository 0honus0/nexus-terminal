import { computed, onScopeDispose, ref } from 'vue';
import { AuthRequestFailure, createAccessApi, useAuthSession, type PasskeyLoginInput } from '@/features/auth/public';
import type { LoginCaptchaConfig, CaptchaStatus, LoginSecurityController } from '../model/security-types';

const DEFAULT_CAPTCHA_CONFIG: LoginCaptchaConfig = { enabled: false, provider: 'none', siteKey: '' };

const hasValue = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const hasConfiguredCaptchaWidget = (config: LoginCaptchaConfig): boolean => {
	if (!config.enabled) {
		return true;
	}
	if (config.provider === 'hcaptcha') {
		return hasValue(config.siteKey);
	}
	if (config.provider === 'recaptcha') {
		return hasValue(config.siteKey);
	}
	return false;
};

export function useLoginSecurity(): LoginSecurityController {
	const captchaConfig = ref<LoginCaptchaConfig>(DEFAULT_CAPTCHA_CONFIG);
	const captchaLoading = ref(true);
	const captchaLoadError = ref(false);
	const hasPasskeys = ref(false);
	const passkeyLoadError = ref(false);
	let refreshController: AbortController | null = null;
	const loading = ref(false);
	const auth = useAuthSession();
	let generation = 0;
	let disposed = false;
	let loginController: AbortController | null = null;
	onScopeDispose(() => {
		generation += 1;
		disposed = true;
		loginController?.abort();
		refreshController?.abort();
	});

	const refresh = async (username?: string): Promise<void> => {
		if (disposed) {
			return;
		}
		const current = ++generation;
		refreshController?.abort();
		refreshController = new AbortController();
		const signal = refreshController.signal;
		passkeyLoadError.value = false;
		captchaLoading.value = true;
		captchaLoadError.value = false;
		const captcha = createAccessApi()
			.captchaConfig(signal)
			.then((config) => {
				if (current !== generation) {
					return;
				}
				captchaConfig.value = {
					enabled: config.enabled,
					provider: config.provider,
					siteKey: config.provider === 'hcaptcha' ? config.hcaptchaSiteKey : config.recaptchaSiteKey,
				};
			})
			.catch(() => {
				if (current !== generation) {
					return;
				}
				captchaConfig.value = DEFAULT_CAPTCHA_CONFIG;
				captchaLoadError.value = true;
			})
			.finally(() => {
				if (current === generation) {
					captchaLoading.value = false;
				}
			});
		const passkeys = createAccessApi()
			.passkeys.hasConfigured(username, signal)
			.catch(() => {
				if (current === generation) {
					passkeyLoadError.value = true;
				}
				return null;
			});
		const [, passkeyAvailable] = await Promise.all([captcha, passkeys]);
		if (current === generation) {
			if (passkeyAvailable !== null) {
				hasPasskeys.value = passkeyAvailable;
			}
		}
	};

	const loginWithPasskey = async (input: PasskeyLoginInput): Promise<void> => {
		if (loading.value || disposed) {
			throw new AuthRequestFailure('cancelled', 'not_dispatched');
		}
		const controller = new AbortController();
		loginController = controller;
		loading.value = true;
		try {
			await auth.loginWithPasskey(input, controller.signal);
			if (disposed || controller.signal.aborted) {
				throw new AuthRequestFailure('cancelled', 'unknown');
			}
		} finally {
			if (loginController === controller && !disposed) {
				loading.value = false;
				loginController = null;
			}
		}
	};

	return {
		captchaConfig: computed(() => captchaConfig.value),
		captchaStatus: computed<CaptchaStatus>(() => {
			if (captchaLoading.value) {
				return 'loading';
			}
			if (captchaLoadError.value) {
				return 'error';
			}
			if (!hasConfiguredCaptchaWidget(captchaConfig.value)) {
				return 'invalid';
			}
			return 'ready';
		}),
		hasPasskeys: computed(() => hasPasskeys.value && !passkeyLoadError.value),
		passkeyLoadError: computed(() => passkeyLoadError.value),
		loading: computed(() => loading.value),
		refresh,
		loginWithPasskey,
	};
}
