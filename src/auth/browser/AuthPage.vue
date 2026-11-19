<script setup lang="ts">
	import pTimeout from 'p-timeout';
	import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		ArrowRight,
		RefreshCw,
		LockKeyhole,
		UserRound,
		Eye,
		EyeOff,
		PanelsTopLeft,
		Puzzle,
		Terminal,
		ArrowUpRight,
	} from '@lucide/vue';
	import type { PluginContributionList, PluginLoginEntry } from '../../plugin/plugin-api.browser.js';
	import { UiButton, UiInput, UiField } from '../../ui/browser/ui-base-api.js';
	import { CodedError } from '../../utils/error.js';
	import type { AuthApi } from './auth-api.js';

	interface LoginButton {
		readonly entry: PluginLoginEntry;
		readonly baseURL: string;
	}

	const { auth, contributions } = defineProps<{ auth: AuthApi; contributions: PluginContributionList }>();
	const emit = defineEmits<{ signIn: [] }>();
	const { t } = useI18n({ useScope: 'global' });
	const { state, checking } = auth;
	const page = new AbortController();
	const loading = ref(false);
	const showPassword = ref(false);
	const registering = computed(() => state.value?.initialized === false);
	const username = ref('');
	const password = ref('');
	const active = shallowRef<LoginButton & { controller: AbortController }>();
	const buttons = computed<LoginButton[]>(() => {
		if (!state.value?.initialized) return [];
		return contributions.value.flatMap((entry) => {
			if (entry.kind !== 'login' || entry.lifetime.signal.aborted) return [];
			const method = state.value?.methods.find(
				({ pluginId, id }) => pluginId === entry.context.self.id && id === entry.id,
			);
			return method ? [{ entry, baseURL: method.baseURL }] : [];
		});
	});

	onScopeDispose(() => page.abort());

	watch(
		buttons,
		(current) => {
			const action = active.value;
			if (action && !current.some(({ entry, baseURL }) => entry === action.entry && baseURL === action.baseURL))
				action.controller.abort();
		},
		{ flush: 'sync' },
	);

	async function run(action: () => Promise<void>, signal = page.signal): Promise<void> {
		if (loading.value || signal.aborted) return;
		loading.value = true;
		try {
			await action();
		} catch (cause) {
			if (!signal.aborted) auth.reportFailure(cause);
		} finally {
			if (!page.signal.aborted) loading.value = false;
		}
	}

	async function submit(): Promise<void> {
		await run(async () => {
			emit('signIn');
			try {
				await auth.signIn({ username: username.value, password: password.value }, page.signal);
			} finally {
				password.value = '';
			}
		});
	}

	async function retry(): Promise<void> {
		await run(() => auth.refresh(page.signal));
	}

	async function startMethod(button: LoginButton): Promise<void> {
		if (loading.value || !buttons.value.includes(button)) return;
		const { entry, baseURL } = button;
		const url = URL.parse(baseURL, location.origin);
		if (!url || url.origin !== location.origin || !url.pathname.startsWith('/api/auth/plugins/')) {
			auth.reportFailure(new CodedError('AUTH_METHOD_UNAVAILABLE'));
			return;
		}
		const controller = new AbortController();
		const signal = AbortSignal.any([controller.signal, page.signal, entry.lifetime.signal]);
		active.value = { ...button, controller };
		try {
			await run(async () => {
				emit('signIn');
				const action = entry.start({
					baseURL,
					signal,

					async onComplete() {
						signal.throwIfAborted();
						await auth.refresh(signal);
					},
				});
				// 撤销即释放登录按钮，迟到的插件回调仍受本次信号限制。
				await pTimeout(Promise.resolve(action), { milliseconds: Infinity, signal });
			}, signal);
		} finally {
			controller.abort();
			active.value = undefined;
		}
	}
</script>

<template>
	<main class="auth-screen">
		<section class="auth-layout">
			<div class="auth-story">
				<div class="auth-brand">
					<span class="auth-brand__mark" aria-hidden="true">N</span
					><span>NEXUS<span class="auth-brand__suffix">TERMINAL</span></span>
				</div>
				<div class="auth-story__intro">
					<h2>{{ t('auth.heroTitle') }}</h2>
					<p>{{ t('auth.heroDescription') }}</p>
				</div>
				<div class="auth-preview" aria-hidden="true">
					<div class="auth-preview__bar"><span /><span /><span /><ArrowUpRight :size="17" /></div>
					<div class="auth-preview__tiles">
						<div class="auth-preview__tile auth-preview__tile--main">
							<PanelsTopLeft :size="30" :stroke-width="1.5" /><span>{{ t('auth.workspace') }}</span>
							<div class="auth-preview__lines"><i /><i /></div>
						</div>
						<div class="auth-preview__tile">
							<Puzzle :size="23" :stroke-width="1.5" /><span>{{ t('auth.extensions') }}</span>
						</div>
						<div class="auth-preview__tile">
							<Terminal :size="23" :stroke-width="1.5" /><span>{{ t('auth.terminal') }}</span>
						</div>
					</div>
				</div>
				<span class="auth-story__footer">NEXUS TERMINAL</span>
			</div>
			<div class="auth-panel">
				<form class="auth-card" :aria-busy="loading" @submit.prevent="submit">
					<header class="auth-card__header">
						<span v-if="registering" class="auth-card__badge"
							><LockKeyhole :size="18" aria-hidden="true" />{{ t('auth.setupLabel') }}</span
						>
						<h1>{{ t(registering ? 'auth.initialize' : 'auth.loginLabel') }}</h1>
						<p v-if="registering">{{ t('auth.setupHint') }}</p>
					</header>
					<UiField id="auth-username" :label="t('auth.username')" v-slot="field">
						<UiInput
							:id="field.id"
							v-model="username"
							density="comfortable"
							name="username"
							autocomplete="username"
							autocapitalize="none"
							:spellcheck="false"
							:placeholder="t('auth.usernamePlaceholder')"
							required
							:disabled="!state || loading"
						>
							<template #leading><UserRound :size="18" aria-hidden="true" /></template>
						</UiInput>
					</UiField>
					<UiField id="auth-password" :label="t('auth.password')" v-slot="field">
						<UiInput
							:id="field.id"
							v-model="password"
							density="comfortable"
							name="password"
							:type="showPassword ? 'text' : 'password'"
							:autocomplete="registering ? 'new-password' : 'current-password'"
							:placeholder="t('auth.passwordPlaceholder')"
							required
							:disabled="!state || loading"
						>
							<template #leading><LockKeyhole :size="18" aria-hidden="true" /></template>
							<template #trailing
								><UiButton
									type="button"
									density="compact"
									:aria-label="t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')"
									:aria-pressed="showPassword"
									:disabled="!state"
									@click="showPassword = !showPassword"
									><component :is="showPassword ? EyeOff : Eye" :size="18" /></UiButton
							></template>
						</UiInput>
					</UiField>
					<UiButton
						v-if="state"
						class="auth-submit"
						type="submit"
						tone="primary"
						appearance="solid"
						block
						:loading="loading && !active"
						:disabled="!!active"
						loading-animation="spinner"
						><template #trailing><ArrowRight :size="18" /></template
						>{{ t(registering ? 'auth.initialize' : 'auth.login') }}</UiButton
					>
					<UiButton
						v-else
						class="auth-submit"
						type="button"
						block
						:loading="checking"
						:disabled="loading || checking"
						@click="retry"
						><template #leading><RefreshCw :size="18" /></template
						>{{ t(checking ? 'auth.connect' : 'auth.retry') }}</UiButton
					>
					<div v-if="buttons.length" class="auth-alternatives">
						<div class="auth-divider">
							<span>{{ t('auth.otherMethods') }}</span>
						</div>
						<UiButton
							v-for="button in buttons"
							:key="button.entry.key"
							type="button"
							block
							:disabled="loading && active?.entry !== button.entry"
							:loading="active?.entry === button.entry"
							loading-animation="spinner"
							@click="startMethod(button)"
							><template v-if="button.entry.icon" #leading
								><component :is="button.entry.icon" :size="18" /></template
							>{{ toValue(button.entry.label) }}</UiButton
						>
					</div>
				</form>
			</div>
		</section>
	</main>
</template>

<style scoped>
	.auth-screen {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: clamp(20px, 5vw, 64px);
		background:
			radial-gradient(ellipse at 16% 8%, color-mix(in srgb, var(--ui-primary) 13%, transparent), transparent 52%),
			var(--ui-background);
	}
	.auth-layout {
		width: min(100%, 1040px);
		display: grid;
		grid-template-columns: 1fr 1fr;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--ui-border) 70%, transparent);
		border-radius: 28px;
		background: var(--ui-surface);
		box-shadow: 0 24px 80px color-mix(in srgb, var(--ui-text) 8%, transparent);
	}
	.auth-story {
		display: flex;
		flex-direction: column;
		gap: 36px;
		padding: 40px;
		background: linear-gradient(
			145deg,
			color-mix(in srgb, var(--ui-primary) 15%, var(--ui-surface)),
			color-mix(in srgb, var(--ui-primary) 5%, var(--ui-surface))
		);
		border-right: 1px solid color-mix(in srgb, var(--ui-border) 65%, transparent);
	}
	.auth-brand {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: 0.12em;
	}
	.auth-brand__mark {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: 12px;
		color: var(--ui-primary-text);
		background: var(--ui-primary);
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.08em;
	}
	.auth-brand__suffix {
		display: block;
		margin-top: 1px;
		color: var(--ui-muted);
		font-size: 8px;
		letter-spacing: 0.24em;
		font-weight: 450;
	}
	.auth-story__intro h2 {
		margin: 6px 0 18px;
		white-space: pre-line;
		font-size: clamp(32px, 3.4vw, 45px);
		font-weight: 550;
		line-height: 1.35;
		letter-spacing: -0.04em;
	}
	.auth-story__intro p {
		margin: 0;
		font-size: 14px;
		color: var(--ui-muted);
		line-height: 1.9;
	}
	.auth-preview {
		padding: 16px;
		border: 1px solid color-mix(in srgb, var(--ui-border) 65%, transparent);
		border-radius: 19px;
		background: color-mix(in srgb, var(--ui-surface) 75%, transparent);
		box-shadow: 0 12px 28px color-mix(in srgb, var(--ui-primary) 6%, transparent);
	}
	.auth-preview__bar {
		display: flex;
		align-items: center;
		gap: 5px;
		padding-bottom: 16px;
		color: var(--ui-muted);
	}
	.auth-preview__bar > span {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--ui-border);
	}
	.auth-preview__bar > svg {
		margin-left: auto;
	}
	.auth-preview__tiles {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 10px;
	}
	.auth-preview__tile {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 18px 12px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-surface));
		color: var(--ui-primary);
	}
	.auth-preview__tile span {
		color: var(--ui-text);
		font-size: 12px;
	}
	.auth-preview__tile--main {
		grid-row: span 2;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		padding: 20px;
		background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-surface));
	}
	.auth-preview__lines {
		display: grid;
		gap: 7px;
		width: 100%;
		margin-top: 6px;
	}
	.auth-preview__lines i {
		height: 4px;
		width: 80%;
		border-radius: 4px;
		background: color-mix(in srgb, var(--ui-primary) 18%, transparent);
	}
	.auth-preview__lines i:last-child {
		width: 50%;
	}
	.auth-story__footer {
		margin-top: auto;
		font-size: 9px;
		letter-spacing: 0.15em;
		color: var(--ui-muted);
	}
	.auth-panel {
		display: grid;
		align-content: center;
		padding: 48px;
		min-width: 0;
	}
	.auth-card {
		display: grid;
		gap: 22px;
		width: 100%;
		margin: 0;
	}
	.auth-card__header {
		margin-bottom: 8px;
	}
	.auth-card__badge {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ui-primary);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.08em;
	}
	.auth-card h1 {
		margin: 18px 0 10px;
		font-size: 30px;
		font-weight: 550;
		letter-spacing: -0.025em;
	}
	.auth-card__header p {
		margin: 0;
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.8;
	}
	.auth-submit {
		min-height: 48px;
		margin-top: 4px;
	}
	.auth-alternatives {
		display: grid;
		gap: 10px;
	}
	.auth-divider {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 4px;
		color: var(--ui-muted);
		font-size: 11px;
	}
	.auth-divider::before,
	.auth-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--ui-border);
	}
	@media (max-width: 760px) {
		.auth-screen {
			padding: max(28px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right))
				max(28px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
			background:
				radial-gradient(
					ellipse at 50% 12%,
					color-mix(in srgb, var(--ui-primary) 16%, transparent),
					transparent 60%
				),
				var(--ui-background);
		}
		.auth-layout {
			max-width: 420px;
			grid-template-columns: minmax(0, 1fr);
			border-radius: 28px;
			box-shadow: 0 20px 64px color-mix(in srgb, var(--ui-primary) 7%, transparent);
		}
		.auth-story {
			display: none;
		}
		.auth-brand__mark {
			width: 48px;
			height: 48px;
			border-radius: 16px;
			font-size: 27px;
			background: linear-gradient(
				145deg,
				color-mix(in srgb, var(--ui-primary) 78%, var(--ui-surface)),
				var(--ui-primary)
			);
			box-shadow: 0 7px 20px color-mix(in srgb, var(--ui-primary) 18%, transparent);
		}
		.auth-panel {
			padding: 32px clamp(22px, 6vw, 32px) 28px;
		}
		.auth-card {
			gap: 20px;
		}
		.auth-card__header {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			align-items: center;
			column-gap: 18px;
			row-gap: 5px;
			margin-bottom: 12px;
		}
		.auth-card h1 {
			grid-column: 1;
			grid-row: 1;
			margin: 0;
			font-size: 28px;
			text-align: center;
		}
		.auth-card__badge {
			grid-column: 1 / -1;
			grid-row: 2;
			justify-self: center;
			justify-content: center;
			width: fit-content;
			max-width: 100%;
			margin-top: 12px;
			padding: 6px 12px;
			border-radius: 999px;
			background: color-mix(in srgb, var(--ui-primary) 9%, transparent);
			font-size: 11px;
			font-weight: 500;
			color: var(--ui-primary);
			letter-spacing: 0.04em;
		}
		.auth-card__badge svg {
			width: 14px;
			height: 14px;
		}
		.auth-card__header p {
			grid-column: 1 / -1;
			margin-top: 12px;
		}
		.auth-submit {
			--ui-button-height: 46px;
			min-height: 46px;
			margin-top: 2px;
		}
	}
	@media (min-width: 761px) and (max-width: 1000px) {
		.auth-story {
			padding: 30px;
		}
		.auth-panel {
			padding: 34px;
		}
	}
</style>
