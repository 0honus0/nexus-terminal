<script setup lang="ts">
	import { computed, reactive, ref, watch } from 'vue';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { authErrorKey } from '../model/auth-errors';
	import { UiButton, UiCheckbox, UiFormField, UiInput } from '@/foundation/ui';
	import { useAuthSession } from '../composables/useAuthSession';
	import type { PasskeyLoginInput } from '../model/auth-types';

	import type { CaptchaStatus } from '@/features/security/public';

	const props = withDefaults(
		defineProps<{
			captchaRequired?: boolean;
			captchaToken?: string | null;
			captchaStatus?: CaptchaStatus;
			passkeyLoading?: boolean;
		}>(),
		{
			captchaRequired: false,
			captchaToken: null,
			captchaStatus: 'ready',
			passkeyLoading: false,
		},
	);
	const emit = defineEmits<{
		passkey: [input: PasskeyLoginInput];
		loginAttempted: [];
		securityChallengeFeedback: [message: string | null];
		securityChallengeConsumed: [];
	}>();

	const THEME_STORAGE_KEY = 'nexus-login-theme';

	const resolveInitialTheme = (): 'light' | 'dark' => {
		if (typeof window === 'undefined') return 'light';
		try {
			const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
			if (saved === 'light' || saved === 'dark') return saved;
		} catch {
			// Storage can be unavailable in hardened browser profiles.
		}
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	};

	const router = useRouter();
	const { t } = useI18n();
	const auth = useAuthSession();
	const pendingSecondFactor = auth.pendingSecondFactor;

	const credentials = reactive({ username: '', password: '' });
	const rememberMe = ref(false);
	const twoFactorToken = ref('');
	const isLoading = ref(false);
	const error = ref<string | null>(null);
	const showPassword = ref(false);
	const theme = ref<'light' | 'dark'>(resolveInitialTheme());
	const isDark = computed(() => theme.value === 'dark');
	const isBusy = computed(() => isLoading.value || props.passkeyLoading);
	const captchaBlocked = computed(() => !pendingSecondFactor.value && props.captchaStatus !== 'ready');
	const heading = computed(() =>
		pendingSecondFactor.value ? t('auth.login.twoFactorHeading') : t('auth.login.heading'),
	);

	watch(
		theme,
		(value) => {
			try {
				window.localStorage.setItem(THEME_STORAGE_KEY, value);
			} catch {
				// The visual toggle still works for the current visit.
			}
		},
		{ immediate: true },
	);

	watch(pendingSecondFactor, (pending) => {
		if (!pending) {
			twoFactorToken.value = '';
		}
	});

	const submit = async (): Promise<void> => {
		if (isBusy.value) {
			return;
		}
		const submittingSecondFactor = pendingSecondFactor.value;
		error.value = null;
		if (!submittingSecondFactor) {
			emit('loginAttempted');
			emit('securityChallengeFeedback', null);
		}
		isLoading.value = true;

		try {
			if (submittingSecondFactor) {
				await auth.verifyTwoFactor(twoFactorToken.value);
				await router.push({ name: 'Dashboard' });
				return;
			}

			if (props.captchaStatus !== 'ready') {
				return;
			}
			if (props.captchaRequired && !props.captchaToken) {
				emit('securityChallengeFeedback', t('auth.login.error.captchaRequired'));
				return;
			}
			try {
				const result = await auth.login({
					username: credentials.username,
					password: credentials.password,
					rememberMe: rememberMe.value,
					captchaToken: props.captchaToken ?? undefined,
				});

				if (result.status === 'authenticated') {
					await router.push({ name: 'Dashboard' });
				}
			} finally {
				if (props.captchaRequired) {
					emit('securityChallengeConsumed');
				}
			}
		} catch (cause) {
			error.value = t(authErrorKey(cause));
		} finally {
			isLoading.value = false;
		}
	};

	const startPasskey = (): void => {
		error.value = null;
		emit('passkey', { username: credentials.username || undefined, rememberMe: rememberMe.value });
	};
</script>

<template>
	<div class="auth-page" :data-auth-theme="theme">
		<main class="auth-stage">
			<section class="auth-hero" aria-labelledby="hero-title">
				<header class="auth-brand">
					<span class="auth-brand-mark">
						<img src="@/assets/logo-small.png" :alt="t('projectName')" />
					</span>
					<span class="auth-brand-name">
						<strong>{{ t('projectName') }}</strong>
						<span>NEXUS TERMINAL</span>
					</span>
				</header>

				<div class="auth-hero-main">
					<h1 id="hero-title">
						<span>{{ t('auth.login.heroLine1') }}</span>
						<span class="auth-hero-accent">{{ t('auth.login.heroLine2') }}</span>
					</h1>
				</div>
			</section>

			<section class="auth-panel" aria-labelledby="login-title">
				<button
					class="auth-theme-toggle"
					type="button"
					:aria-label="t(isDark ? 'auth.login.themeToLight' : 'auth.login.themeToDark')"
					@click="theme = isDark ? 'light' : 'dark'"
				>
					<svg class="auth-theme-icon auth-theme-sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6" />
						<path
							d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9 5.5 5.5"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
						/>
					</svg>
					<svg class="auth-theme-icon auth-theme-moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M20 15.1A8.2 8.2 0 0 1 8.9 4a8.2 8.2 0 1 0 11.1 11.1Z"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
				<div class="auth-card">
					<div class="auth-mobile-mark">
						<img src="@/assets/logo-small.png" :alt="t('projectName')" />
					</div>
					<header class="auth-heading">
						<h2 id="login-title">{{ heading }}</h2>
						<p v-if="pendingSecondFactor">{{ t('auth.login.twoFactorSubheading') }}</p>
					</header>

					<form id="login-form" class="login-form" novalidate @submit.prevent="submit">
						<template v-if="!pendingSecondFactor">
							<UiFormField class="login-field" :label="t('auth.login.username')" for-id="username">
								<UiInput
									id="username"
									v-model="credentials.username"
									class="login-input"
									name="username"
									autocomplete="username"
									:placeholder="t('auth.login.usernamePlaceholder')"
									required
									density="comfortable"
									:disabled="isBusy"
								>
									<template #leading>
										<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
											<circle cx="12" cy="8" r="3.6" stroke="currentColor" stroke-width="1.7" />
											<path
												d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"
												stroke="currentColor"
												stroke-width="1.7"
												stroke-linecap="round"
											/>
										</svg>
									</template>
								</UiInput>
							</UiFormField>

							<UiFormField class="login-field" :label="t('auth.login.password')" for-id="password">
								<div class="login-password-control">
									<UiInput
										id="password"
										v-model="credentials.password"
										class="login-input"
										name="password"
										:type="showPassword ? 'text' : 'password'"
										autocomplete="current-password"
										:placeholder="t('auth.login.passwordPlaceholder')"
										required
										density="comfortable"
										:disabled="isBusy"
									>
										<template #leading>
											<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
												<rect
													x="5"
													y="10"
													width="14"
													height="10"
													rx="2.5"
													stroke="currentColor"
													stroke-width="1.7"
												/>
												<path
													d="M8 10V8a4 4 0 0 1 8 0v2M12 14v2.2"
													stroke="currentColor"
													stroke-width="1.7"
													stroke-linecap="round"
												/>
											</svg>
										</template>
									</UiInput>
									<button
										class="login-password-toggle"
										type="button"
										:aria-label="
											t(showPassword ? 'auth.login.hidePassword' : 'auth.login.showPassword')
										"
										:aria-pressed="showPassword"
										@click="showPassword = !showPassword"
									>
										<svg v-if="showPassword" viewBox="0 0 24 24" fill="none" aria-hidden="true">
											<path
												d="M4 4l16 16M9.9 7.4A9.8 9.8 0 0 1 12 7c5.4 0 8.5 5 8.5 5a14 14 0 0 1-2.3 2.7M6.3 8.4A14.7 14.7 0 0 0 3.5 12s3.1 5 8.5 5c1 0 2-.2 2.8-.5M10 10a2.8 2.8 0 0 0 4 4"
												stroke="currentColor"
												stroke-width="1.6"
												stroke-linecap="round"
												stroke-linejoin="round"
											/>
										</svg>
										<svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
											<path
												d="M3.5 12s3.1-5 8.5-5 8.5 5 8.5 5-3.1 5-8.5 5-8.5-5-8.5-5Z"
												stroke="currentColor"
												stroke-width="1.6"
											/>
											<circle cx="12" cy="12" r="2.3" stroke="currentColor" stroke-width="1.6" />
										</svg>
									</button>
								</div>
							</UiFormField>

							<div class="login-meta">
								<label class="login-remember" for="rememberMe">
									<UiCheckbox
										id="rememberMe"
										v-model="rememberMe"
										name="rememberMe"
										density="comfortable"
										:disabled="isBusy"
									/>
									<span>{{ t('auth.login.rememberMe') }}</span>
								</label>
							</div>
						</template>

						<UiFormField
							v-else
							class="login-field"
							:label="t('auth.login.twoFactorPrompt')"
							for-id="twoFactorToken"
						>
							<UiInput
								id="twoFactorToken"
								v-model="twoFactorToken"
								class="login-input login-input--plain"
								name="twoFactorToken"
								inputmode="numeric"
								autocomplete="one-time-code"
								pattern="[0-9]{6}"
								required
								density="comfortable"
								:disabled="isBusy"
							/>
						</UiFormField>

						<slot v-if="!pendingSecondFactor" name="security" />

						<p v-if="error" class="login-error" role="alert">{{ error }}</p>

						<UiButton
							class="login-submit"
							type="submit"
							appearance="solid"
							tone="primary"
							density="comfortable"
							block
							:disabled="isBusy || captchaBlocked"
							:aria-busy="isBusy || undefined"
						>
							<span v-if="isBusy" class="login-button-spinner" aria-hidden="true"></span>
							<span>{{
								isBusy
									? t('auth.login.loggingIn')
									: pendingSecondFactor
										? t('auth.login.verifyButton')
										: t('auth.login.loginButton')
							}}</span>
						</UiButton>

						<template v-if="!pendingSecondFactor">
							<div class="login-divider">
								<span>{{ t('auth.login.or') }}</span>
							</div>
							<UiButton
								class="login-passkey"
								type="button"
								density="comfortable"
								block
								:disabled="isBusy"
								@click="startPasskey"
							>
								<template #leading>
									<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
										<circle cx="8.5" cy="12" r="3.5" stroke="currentColor" stroke-width="1.7" />
										<path
											d="M12 12h8M17 12v2.7M19.5 12v2M8.5 12h.01"
											stroke="currentColor"
											stroke-width="1.7"
											stroke-linecap="round"
										/>
									</svg>
								</template>
								{{ isBusy ? t('auth.login.loggingIn') : t('auth.login.loginWithPasskey') }}
							</UiButton>
						</template>
					</form>
				</div>
			</section>
		</main>
	</div>
</template>

<style scoped>
	.auth-page {
		--auth-page: #eaedf7;
		--auth-frame: #f8f9fd;
		--auth-surface: #ffffff;
		--auth-surface-soft: #f4f6fb;
		--auth-field: #f8f9fd;
		--auth-field-focus: #ffffff;
		--auth-ink: #17182b;
		--auth-ink-soft: #41445a;
		--auth-muted: #73768a;
		--auth-line: rgb(30 31 64 / 10%);
		--auth-line-strong: rgb(30 31 64 / 16%);
		--auth-accent: #8b5cf6;
		--auth-accent-soft: rgb(139 92 246 / 9%);
		--auth-action: #ab4fbe;
		--auth-action-hover: #9f4bb7;
		--auth-action-active: #9441a8;
		--auth-danger: #c84260;
		--auth-frame-shadow: 0 38px 100px -54px rgb(31 32 78 / 48%), 0 8px 30px -18px rgb(31 32 78 / 22%);
		--auth-card-shadow: 0 28px 70px -52px rgb(31 32 78 / 48%);
		position: relative;
		display: flex;
		min-height: 100dvh;
		align-items: center;
		justify-content: center;
		padding: 20px;
		overflow-x: hidden;
		color: var(--auth-ink);
		background:
			radial-gradient(58rem 38rem at 5% 0%, rgb(118 151 255 / 18%), transparent 68%),
			radial-gradient(48rem 38rem at 100% 100%, rgb(218 103 155 / 14%), transparent 66%), var(--auth-page);
		isolation: isolate;
	}

	.auth-page::before {
		position: fixed;
		inset: 0;
		z-index: -1;
		content: '';
		pointer-events: none;
		background-image:
			linear-gradient(rgb(255 255 255 / 12%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 12%) 1px, transparent 1px);
		background-size: 48px 48px;
		mask-image: radial-gradient(circle at 50% 40%, black, transparent 78%);
		opacity: 0.36;
	}

	.auth-page[data-auth-theme='dark'] {
		--auth-page: #080910;
		--auth-frame: #0d0e16;
		--auth-surface: #13141f;
		--auth-surface-soft: #0f1019;
		--auth-field: #10111b;
		--auth-field-focus: #171825;
		--auth-ink: #f4f1ff;
		--auth-ink-soft: #d4d0e3;
		--auth-muted: #9293a7;
		--auth-line: rgb(255 255 255 / 9%);
		--auth-line-strong: rgb(255 255 255 / 16%);
		--auth-accent: #a483ff;
		--auth-accent-soft: rgb(164 131 255 / 12%);
		--auth-action: #a84fc1;
		--auth-action-hover: #9c4ab4;
		--auth-action-active: #8e43a6;
		--auth-danger: #ff7f98;
		--auth-frame-shadow: 0 44px 120px -48px rgb(0 0 0 / 86%), 0 0 0 1px rgb(255 255 255 / 3%);
		--auth-card-shadow: 0 28px 80px -48px rgb(0 0 0 / 82%);
		--app-bg-color: #080910;
		--text-color: #f4f1ff;
		--text-color-secondary: #9293a7;
		--border-color: rgb(255 255 255 / 16%);
		--input-bg-color: #10111b;
		--input-text-color: #f4f1ff;
		--input-placeholder-color: #9293a7;
		--status-error-color: #ff7f98;
		color-scheme: dark;
	}

	.auth-stage {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1.14fr) minmax(430px, 0.86fr);
		width: min(1360px, 100%);
		height: min(800px, calc(100svh - 56px));
		margin: 0;
		overflow: hidden;
		background: var(--auth-frame);
		border: 1px solid var(--auth-line-strong);
		border-radius: 32px;
		box-shadow: var(--auth-frame-shadow);
		isolation: isolate;
	}

	.auth-hero {
		position: relative;
		display: flex;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
		padding: clamp(30px, 3.15vw, 46px);
		color: #fff;
		background:
			radial-gradient(40rem 32rem at 92% 5%, rgb(224 102 164 / 34%), transparent 62%),
			radial-gradient(38rem 34rem at 4% 96%, rgb(100 126 255 / 32%), transparent 64%),
			linear-gradient(145deg, #2b2354 0%, #19172e 48%, #241831 100%);
		user-select: none;
	}

	.auth-hero::before {
		position: absolute;
		inset: 0;
		content: '';
		pointer-events: none;
		background-image:
			linear-gradient(rgb(255 255 255 / 5.5%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 5.5%) 1px, transparent 1px);
		background-size: 52px 52px;
		mask-image: linear-gradient(90deg, transparent 0%, black 45%, black 100%);
	}

	.auth-hero::after {
		position: absolute;
		top: 8%;
		right: -18%;
		width: 68%;
		aspect-ratio: 1;
		content: '';
		pointer-events: none;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 50%;
		box-shadow:
			0 0 0 5.5rem rgb(255 255 255 / 1.8%),
			0 0 0 11rem rgb(255 255 255 / 1.2%);
	}

	.auth-brand {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 15px;
	}

	.auth-brand-mark {
		display: grid;
		width: 50px;
		height: 50px;
		flex: 0 0 auto;
		place-items: center;
		background: rgb(255 255 255 / 10%);
		border: 1px solid rgb(255 255 255 / 15%);
		border-radius: 18px;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 17%),
			0 14px 30px -20px rgb(0 0 0 / 70%);
		-webkit-backdrop-filter: blur(16px);
		backdrop-filter: blur(16px);
	}

	.auth-brand-mark img {
		width: 35px;
		height: auto;
		filter: drop-shadow(0 5px 12px rgb(0 0 0 / 26%));
	}

	.auth-brand-name {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 2px;
	}

	.auth-brand-name strong {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0.06em;
	}

	.auth-brand-name span {
		color: rgb(255 255 255 / 48%);
		font-size: 8.5px;
		font-weight: 650;
		letter-spacing: 0.2em;
	}

	.auth-hero-main {
		position: relative;
		z-index: 1;
		width: min(100%, 640px);
		margin-block: auto;
		padding-block: clamp(24px, 4vh, 48px);
	}

	.auth-hero h1 {
		margin: 0;
		font-size: clamp(2.55rem, 3.45vw, 3.65rem);
		font-weight: 680;
		line-height: 1.12;
		letter-spacing: -0.045em;
	}

	.auth-hero h1 span {
		display: block;
	}

	.auth-hero-accent {
		width: fit-content;
		color: transparent;
		background: linear-gradient(90deg, #d9c8ff 4%, #ffb1ca 58%, #ffd5b8 100%);
		background-clip: text;
		-webkit-background-clip: text;
	}

	.auth-panel {
		position: relative;
		display: grid;
		padding: clamp(24px, 3.4vw, 50px);
		place-items: center;
		background:
			radial-gradient(32rem 24rem at 100% 0%, var(--auth-accent-soft), transparent 70%), var(--auth-surface-soft);
		border-left: 1px solid var(--auth-line);
	}

	.auth-card {
		width: min(100%, 430px);
		padding: clamp(26px, 3vw, 38px);
		background: transparent;
		border: 0;
		box-shadow: none;
	}

	.auth-mobile-mark {
		display: none;
	}

	.auth-theme-toggle {
		position: absolute;
		top: clamp(24px, 3.4vw, 50px);
		right: clamp(24px, 3.4vw, 50px);
		z-index: 2;
		display: grid;
		width: 36px;
		height: 36px;
		padding: 0;
		place-items: center;
		color: var(--auth-muted);
		background: var(--auth-surface-soft);
		border: 1px solid var(--auth-line);
		border-radius: 11px;
		cursor: pointer;
		transition:
			color 160ms ease,
			border-color 160ms ease,
			background 160ms ease;
	}

	.auth-theme-toggle:hover {
		color: var(--auth-ink);
		background: var(--auth-field);
		border-color: var(--auth-line-strong);
	}

	.auth-theme-icon {
		width: 16px;
		height: 16px;
	}

	.auth-page[data-auth-theme='light'] .auth-theme-moon,
	.auth-page[data-auth-theme='dark'] .auth-theme-sun {
		display: none;
	}

	.auth-heading {
		margin: clamp(26px, 3.4vh, 34px) 0 0;
	}

	.auth-heading h2 {
		margin: 0;
		color: var(--auth-ink);
		font-size: clamp(28px, 2.4vw, 36px);
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.035em;
	}

	.auth-heading p {
		margin: 9px 0 0;
		color: var(--auth-muted);
		font-size: 13px;
		line-height: 1.7;
	}

	.login-form {
		display: grid;
		gap: 14px;
		margin-top: 28px;
	}

	.login-field {
		gap: 7px;
	}

	.login-field :deep(.ui-form-field__label) {
		margin-bottom: 0;
		color: var(--auth-ink-soft);
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.02em;
		line-height: 1.3;
	}

	.login-input.ui-input {
		height: 52px;
		padding-inline: 15px;
		background: var(--auth-field);
		border: 1px solid var(--auth-line-strong);
		border-radius: 14px;
		box-shadow: none;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
		--input-bg-color: var(--auth-field);
		--input-text-color: var(--auth-ink);
		--input-placeholder-color: color-mix(in srgb, var(--auth-muted) 72%, transparent);
		transition:
			background 160ms ease,
			border-color 160ms ease,
			box-shadow 160ms ease;
	}

	.login-input:not(.ui-input--disabled):hover {
		background: var(--auth-field);
		border-color: var(--auth-line-strong);
	}

	.login-input:not(.ui-input--disabled):focus-within {
		background: var(--auth-field-focus);
		border-color: color-mix(in srgb, var(--auth-accent) 72%, var(--auth-line-strong));
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--auth-accent) 13%, transparent);
	}

	.login-input :deep(.ui-input__adornment) {
		width: 17px;
		height: 17px;
		color: var(--auth-muted);
		transition: color 160ms ease;
	}

	.login-input :deep(.ui-input__adornment svg) {
		display: block;
		width: 17px;
		height: 17px;
	}

	.login-input:focus-within :deep(.ui-input__adornment) {
		color: var(--auth-accent);
	}

	.login-input :deep(.ui-input__control) {
		font-size: 14px;
	}

	.login-password-control {
		position: relative;
	}

	.login-password-control .login-input {
		padding-inline-end: 48px;
	}

	.login-password-toggle {
		position: absolute;
		top: 50%;
		right: 8px;
		display: grid;
		width: 36px;
		height: 36px;
		padding: 0;
		place-items: center;
		color: var(--auth-muted);
		background: transparent;
		border: 0;
		border-radius: 10px;
		cursor: pointer;
		transform: translateY(-50%);
	}

	.login-password-toggle:hover {
		color: var(--auth-ink);
		background: var(--auth-surface-soft);
	}

	.login-password-toggle svg {
		width: 17px;
		height: 17px;
	}

	.login-meta {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 16px;
		margin-top: -1px;
	}

	.login-remember {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: var(--auth-muted);
		font-size: 12px;
		cursor: pointer;
		user-select: none;
	}

	.login-remember :deep(.ui-checkbox) {
		width: 17px;
		height: 17px;
		padding: 0;
		background: var(--auth-field);
		border-color: var(--auth-line-strong);
		border-radius: 5px;
		box-shadow: none;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}

	.login-remember :deep(.ui-checkbox[data-state='checked']) {
		color: #fff;
		background: var(--auth-accent);
		border-color: var(--auth-accent);
	}

	.login-security {
		display: grid;
		gap: 8px;
	}

	.login-error {
		margin: -4px 0 0;
		padding: 9px 11px;
		color: var(--auth-danger);
		font-size: 11px;
		line-height: 1.55;
		text-align: left;
		background: color-mix(in srgb, var(--auth-danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--auth-danger) 22%, transparent);
		border-radius: 10px;
	}

	.login-submit.ui-button.ui-button--solid[data-tone='primary'] {
		width: 100%;
		height: 52px;
		margin-top: 2px;
		padding: 0 20px;
		color: #fff;
		font-size: 13px;
		font-weight: 650;
		letter-spacing: 0.01em;
		background: var(--auth-action);
		border: 1px solid color-mix(in srgb, var(--auth-action) 84%, black);
		border-radius: 14px;
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
		transition:
			background 150ms ease,
			border-color 150ms ease;
	}

	.login-submit.ui-button.ui-button--solid[data-tone='primary']:not(:disabled):hover {
		background: var(--auth-action-hover);
		border-color: color-mix(in srgb, var(--auth-action-hover) 88%, black);
	}

	.login-submit.ui-button.ui-button--solid[data-tone='primary']:not(:disabled):active {
		background: var(--auth-action-active);
	}

	.login-submit.ui-button.ui-button--solid[data-tone='primary']:disabled {
		cursor: wait;
		opacity: 0.66;
	}

	.login-button-spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgb(255 255 255 / 35%);
		border-top-color: #fff;
		border-radius: 50%;
		animation: login-spin 700ms linear infinite;
	}

	@keyframes login-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.login-divider {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 1px 0;
		color: var(--auth-muted);
		font-size: 10px;
	}

	.login-divider::before,
	.login-divider::after {
		height: 1px;
		flex: 1;
		content: '';
		background: var(--auth-line);
	}

	.login-passkey.ui-button {
		width: 100%;
		height: 52px;
		color: var(--auth-ink-soft);
		font-size: 12px;
		font-weight: 600;
		background: var(--auth-surface);
		border: 1px solid var(--auth-line-strong);
		border-radius: 14px;
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 3%);
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}

	.login-passkey.ui-button:not(:disabled):hover {
		color: var(--auth-ink);
		background: var(--auth-field);
		border-color: color-mix(in srgb, var(--auth-accent) 36%, var(--auth-line-strong));
	}

	.login-passkey :deep(.ui-button__icon),
	.login-passkey :deep(svg) {
		width: 17px;
		height: 17px;
		color: var(--auth-accent);
	}

	.auth-theme-toggle:focus-visible,
	.login-password-toggle:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--auth-accent) 68%, transparent);
		outline-offset: 2px;
	}

	@media (max-width: 1100px) {
		.auth-stage {
			grid-template-columns: minmax(0, 0.95fr) minmax(410px, 1.05fr);
		}

		.auth-hero {
			padding: 38px;
		}
	}

	@media (max-width: 900px) {
		.auth-page {
			padding: 16px;
		}

		.auth-stage {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
			width: min(760px, 100%);
			height: min(780px, calc(100svh - 32px));
		}

		.auth-hero {
			padding: 24px 28px 20px;
		}

		.auth-hero-main {
			width: 100%;
			margin: 0;
			padding: 28px 0 0;
		}

		.auth-hero h1 {
			font-size: clamp(2rem, 5.8vw, 2.75rem);
		}

		.auth-panel {
			display: flex;
			align-items: center;
			flex-direction: column;
			justify-content: flex-start;
			padding: clamp(20px, 8vh, 76px) 24px 24px;
			border-top: 1px solid var(--auth-line);
			border-left: 0;
		}

		.auth-card {
			padding: 0 28px 24px;
			border-radius: 22px;
		}

		.auth-theme-toggle {
			top: clamp(20px, 8vh, 76px);
		}

		.auth-heading {
			margin-top: 0;
			padding-right: 48px;
		}

		.auth-heading h2 {
			font-size: 29px;
		}

		.login-form {
			gap: 11px;
			margin-top: 20px;
		}

		.login-input.ui-input,
		.login-submit.ui-button,
		.login-passkey.ui-button {
			height: 48px;
		}
	}

	@media (min-width: 561px) and (max-width: 900px) and (max-height: 820px) {
		.auth-hero {
			padding: 18px 24px 16px;
		}

		.auth-hero-main {
			padding-top: 18px;
		}

		.auth-hero h1 {
			font-size: clamp(1.9rem, 4.5vw, 2.25rem);
		}

		.auth-panel {
			padding: clamp(16px, 5vh, 40px) 20px 16px;
		}

		.auth-card {
			padding: 0 24px 18px;
		}

		.auth-theme-toggle {
			top: clamp(16px, 5vh, 40px);
		}

		.auth-heading {
			margin-top: 0;
		}

		.login-form {
			gap: 9px;
			margin-top: 16px;
		}

		.login-input.ui-input,
		.login-submit.ui-button,
		.login-passkey.ui-button {
			height: 44px;
		}
	}

	@media (min-width: 561px) and (max-width: 900px) and (max-height: 720px) {
		.auth-stage {
			height: auto;
			min-height: calc(100svh - 32px);
		}
	}

	@media (min-width: 650px) and (max-width: 900px) and (max-height: 560px) {
		.auth-page {
			padding: 10px;
		}

		.auth-stage {
			grid-template-columns: minmax(210px, 0.72fr) minmax(0, 1.28fr);
			grid-template-rows: minmax(0, 1fr);
			width: min(900px, 100%);
			height: calc(100svh - 20px);
			min-height: 0;
		}

		.auth-hero {
			padding: 18px 20px;
		}

		.auth-brand {
			gap: 11px;
		}

		.auth-brand-mark {
			width: 38px;
			height: 38px;
			border-radius: 12px;
		}

		.auth-brand-mark img {
			width: 27px;
		}

		.auth-brand-name strong {
			font-size: 14px;
		}

		.auth-brand-name span {
			font-size: 7px;
		}

		.auth-hero-main {
			width: 100%;
			margin: 0;
			padding: 18px 0 0;
		}

		.auth-hero h1 {
			font-size: clamp(1.55rem, 3.2vw, 1.9rem);
			line-height: 1.1;
		}

		.auth-panel {
			padding: 10px 14px;
			justify-content: center;
			border-top: 0;
			border-left: 1px solid var(--auth-line);
		}

		.auth-card {
			width: min(100%, 430px);
			padding: 12px 18px;
			border-radius: 18px;
		}

		.auth-theme-toggle {
			top: 12px;
			right: 12px;
			width: 30px;
			height: 30px;
			border-radius: 9px;
		}

		.auth-theme-icon {
			width: 14px;
			height: 14px;
		}

		.auth-heading {
			margin-top: 5px;
			padding-right: 0;
		}

		.auth-heading h2 {
			font-size: 25px;
		}

		.auth-heading p {
			display: none;
		}

		.login-form {
			gap: 7px;
			margin-top: 10px;
		}

		.login-field {
			gap: 4px;
		}

		.login-field :deep(.ui-form-field__label) {
			font-size: 10px;
		}

		.login-input.ui-input,
		.login-submit.ui-button,
		.login-passkey.ui-button {
			height: 40px;
		}

		.login-password-toggle {
			width: 30px;
			height: 30px;
		}

		.login-passkey.ui-button {
			border-radius: 12px;
		}
	}

	@media (max-width: 560px) {
		.auth-page {
			align-items: flex-start;
			padding: 0;
		}

		.auth-page::before {
			background-size: 36px 36px;
		}

		.auth-stage {
			grid-template-rows: minmax(0, 1fr);
			width: 100%;
			height: auto;
			min-height: 100svh;
			margin: 0;
			border: 0;
			border-radius: 0;
		}

		.auth-hero {
			display: none;
		}

		.auth-panel {
			padding: 20px 14px calc(20px + env(safe-area-inset-bottom));
			border-top: 0;
		}

		.auth-card {
			margin-block: auto;
			padding: 0 18px 20px;
			border-radius: 20px;
		}

		.auth-mobile-mark {
			display: flex;
			justify-content: center;
			margin-bottom: 14px;
		}

		.auth-mobile-mark img {
			width: auto;
			height: 64px;
			filter: drop-shadow(0 10px 18px rgb(51 31 85 / 18%));
		}

		.auth-theme-toggle {
			top: 16px;
			right: 14px;
		}

		.auth-heading {
			margin-top: 0;
		}

		.auth-heading h2 {
			font-size: 28px;
		}

		.login-form {
			margin-top: 18px;
		}
	}

	@media (min-width: 901px) and (max-height: 840px) {
		.auth-hero {
			padding-block: 28px;
		}

		.auth-hero-main {
			padding-block: 20px;
		}

		.auth-panel {
			padding-block: 14px;
		}

		.auth-card {
			padding: 28px 30px;
		}

		.auth-heading {
			margin-top: 22px;
		}

		.login-form {
			gap: 11px;
			margin-top: 20px;
		}

		.login-input.ui-input,
		.login-submit.ui-button,
		.login-passkey.ui-button {
			height: 48px;
		}
	}

	@media (max-width: 360px) {
		.auth-panel {
			padding: 16px 10px calc(16px + env(safe-area-inset-bottom));
		}

		.auth-card {
			padding: 0 15px 18px;
		}

		.auth-theme-toggle {
			top: 16px;
		}

		.auth-heading {
			margin-top: 0;
		}

		.login-form {
			gap: 10px;
			margin-top: 16px;
		}
	}

	@media (max-width: 560px) and (max-height: 760px) {
		.auth-panel {
			padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
		}

		.auth-card {
			padding: 0 16px 14px;
		}

		.auth-theme-toggle {
			top: 12px;
		}

		.auth-heading {
			margin-top: 0;
		}

		.auth-heading h2 {
			font-size: 26px;
		}

		.auth-heading p {
			margin-top: 6px;
			font-size: 12px;
		}

		.login-form {
			gap: 9px;
			margin-top: 14px;
		}

		.login-field :deep(.ui-form-field__label) {
			font-size: 10px;
		}

		.login-input.ui-input,
		.login-submit.ui-button,
		.login-passkey.ui-button {
			height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.login-button-spinner {
			animation-duration: 1.4s;
		}
	}
</style>
