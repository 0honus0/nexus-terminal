<script setup lang="ts">
	import { nextTick, onMounted, ref, watch } from 'vue';
	import { RouterLink, useRoute, useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { apiErrorMessage } from '@/client/http';
	import { logger } from '@/client/logging/logger';
	import { useAuthSession } from '@/features/auth/public';
	import { usePreferences } from '@/features/preferences/public';
	import { releaseRepository, releaseRepositoryUrl } from '@/app/config/release';
	import { useHorizontalDragScroll } from '@/foundation/interaction';
	import { useFeedback, useSettingsReloadStore } from '@/shared/feedback/public';

	const emit = defineEmits<{ customizeAppearance: [] }>();
	const router = useRouter();
	const route = useRoute();
	const { t } = useI18n();
	const auth = useAuthSession();
	const preferences = usePreferences();
	const feedback = useFeedback();
	const settingsReload = useSettingsReloadStore();
	const loggingOut = ref(false);
	const navigationLinks = ref<HTMLElement | null>(null);
	const navigationDrag = useHorizontalDragScroll();
	type NavigationItem = {
		path: string;
		label: string;
		iconPaths: string[];
		dividerBefore?: boolean;
	};
	const navigation: NavigationItem[] = [
		{
			path: '/',
			label: 'nav.dashboard',
			iconPaths: [
				'M5.4 4h3.2A1.4 1.4 0 0 1 10 5.4v3.2A1.4 1.4 0 0 1 8.6 10H5.4A1.4 1.4 0 0 1 4 8.6V5.4A1.4 1.4 0 0 1 5.4 4Z',
				'M15.4 4h3.2A1.4 1.4 0 0 1 20 5.4v3.2a1.4 1.4 0 0 1-1.4 1.4h-3.2A1.4 1.4 0 0 1 14 8.6V5.4A1.4 1.4 0 0 1 15.4 4Z',
				'M5.4 14h3.2a1.4 1.4 0 0 1 1.4 1.4v3.2A1.4 1.4 0 0 1 8.6 20H5.4A1.4 1.4 0 0 1 4 18.6v-3.2A1.4 1.4 0 0 1 5.4 14Z',
				'M15.4 14h3.2a1.4 1.4 0 0 1 1.4 1.4v3.2a1.4 1.4 0 0 1-1.4 1.4h-3.2a1.4 1.4 0 0 1-1.4-1.4v-3.2a1.4 1.4 0 0 1 1.4-1.4Z',
			],
		},
		{
			path: '/workspace',
			label: 'nav.terminal',
			iconPaths: [
				'M6.2 5h11.6a2.4 2.4 0 0 1 2.4 2.4v9.2a2.4 2.4 0 0 1-2.4 2.4H6.2a2.4 2.4 0 0 1-2.4-2.4V7.4A2.4 2.4 0 0 1 6.2 5Z',
				'M7.2 9.3l2.5 2.2-2.5 2.2M11.6 14h4.8',
			],
		},
		{
			path: '/connections',
			label: 'nav.connections',
			dividerBefore: true,
			iconPaths: ['M8.5 4v4M15.5 4v4', 'M6.5 8h11v2.5a5.5 5.5 0 0 1-11 0V8Z', 'M12 16v4'],
		},
		{
			path: '/proxies',
			label: 'nav.proxies',
			iconPaths: ['M5 8h12M14 5l3 3-3 3M19 16H7M10 13l-3 3 3 3'],
		},
		{
			path: '/notifications',
			label: 'nav.notifications',
			iconPaths: [
				'M6.8 10a5.2 5.2 0 1 1 10.4 0c0 4 1.8 5.2 1.8 5.2H5S6.8 14 6.8 10Z',
				'M10 18.2a2.1 2.1 0 0 0 4 0',
			],
		},
		{
			path: '/audit-logs',
			label: 'nav.auditLogs',
			iconPaths: ['M6 4.5h9l3 3v12H6V4.5Z', 'M9 8.5h5M9 11.5h6M9 14.5h6M9 17.5h3.8'],
		},
		{
			path: '/settings',
			label: 'nav.settings',
			dividerBefore: true,
			iconPaths: [
				'M4 7h8M17 7h3M4 17h3M12 17h8M4 12h5M14 12h6',
				'M16.7 7a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z',
				'M11.7 17a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z',
				'M13.7 12a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z',
			],
		},
	];

	const revealActivePage = async (): Promise<void> => {
		await nextTick();
		const strip = navigationLinks.value;
		const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
		if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
		// Scroll only the navigation strip, never the document or the terminal below it.
		strip.scrollTo({ left: active.offsetLeft - strip.clientWidth / 2 + active.offsetWidth / 2 });
	};

	watch(() => route.path, revealActivePage);

	onMounted(() => {
		void revealActivePage();
		if (auth.isAuthenticated.value)
			void preferences.load().catch((cause) => logger.error({ err: cause }, 'Failed to load header preferences'));
	});

	const logout = async (): Promise<void> => {
		if (loggingOut.value) return;
		loggingOut.value = true;
		try {
			await auth.logout();
			await router.push({ name: 'Login' });
		} catch (cause) {
			// beginAuthentication tears down this Header while draining Workspace
			// owners. A restored session mounts a new Header, so local error state
			// would disappear. The app-owned notification host survives both states.
			feedback.notifyError(apiErrorMessage(cause, t('common.errorOccurred')));
		} finally {
			loggingOut.value = false;
		}
	};
</script>

<template>
	<header
		v-if="route.name !== 'Workspace' || preferences.values.value.navBarVisible"
		class="app-header sticky top-0 z-30 shrink-0"
	>
		<nav class="app-navigation" :aria-label="t('common.primaryNavigation')">
			<RouterLink to="/" class="app-brand" :aria-label="t('nav.dashboard')">
				<img src="@/assets/logo-small.png" :alt="t('projectName')" class="h-7 w-auto shrink-0" />
			</RouterLink>
			<div
				ref="navigationLinks"
				class="app-nav-links"
				@pointerdown="navigationDrag.pointerdown"
				@pointermove="navigationDrag.pointermove"
				@pointerup="navigationDrag.pointerup"
				@pointercancel="navigationDrag.pointercancel"
				@lostpointercapture="navigationDrag.lostpointercapture"
				@click.capture="navigationDrag.click"
				@dragstart.prevent
			>
				<template v-for="item in navigation" :key="item.path">
					<span v-if="item.dividerBefore" class="nav-divider" aria-hidden="true"></span>
					<RouterLink class="nav-link" :to="item.path">
						<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
							<path v-for="path in item.iconPaths" :key="path" :d="path" />
						</svg>
						<span>{{ t(item.label) }}</span>
					</RouterLink>
				</template>
			</div>

			<div class="app-nav-tools flex shrink-0 items-center gap-1">
				<button
					v-if="settingsReload.pendingCount > 0"
					type="button"
					class="icon-link inline-flex settings-reload-indicator"
					:title="t('feedback.settingsReload.indicator', { count: settingsReload.pendingCount })"
					:aria-label="t('feedback.settingsReload.indicator', { count: settingsReload.pendingCount })"
					@click="settingsReload.open"
				>
					<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
					<span class="settings-reload-indicator__dot" aria-hidden="true"></span>
				</button>
				<a
					class="icon-link hidden md:inline-flex"
					:href="releaseRepositoryUrl"
					target="_blank"
					rel="noopener noreferrer"
					:title="releaseRepository"
					:aria-label="releaseRepository"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						fill="currentColor"
						viewBox="0 0 16 16"
					>
						<path
							d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
						/>
					</svg>
				</a>
				<button
					v-if="auth.isAuthenticated.value"
					type="button"
					class="icon-link inline-flex"
					:title="t('nav.customizeStyle')"
					:aria-label="t('nav.customizeStyle')"
					@click="emit('customizeAppearance')"
				>
					<i class="fas fa-paint-brush" aria-hidden="true"></i>
				</button>
				<RouterLink v-if="!auth.isAuthenticated.value" class="nav-link inline-flex" to="/login">{{
					t('nav.login')
				}}</RouterLink>
				<a
					v-else
					class="icon-link inline-flex"
					href="/login"
					:title="t('nav.logout')"
					:aria-label="t('nav.logout')"
					:aria-busy="loggingOut || undefined"
					@click.prevent="logout"
				>
					<i class="fas fa-sign-out-alt" aria-hidden="true"></i>
				</a>
			</div>
		</nav>
	</header>
</template>

<style scoped>
	.app-header {
		height: var(--app-header-height);
		padding: calc(6px + env(safe-area-inset-top, 0px)) 8px 6px;
		background: var(--app-bg-color);
	}
	.app-navigation {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 16px;
		width: 100%;
		height: 48px;
		margin-inline: auto;
		padding-inline: 16px;
		background: transparent;
	}
	.app-brand {
		display: inline-flex;
		justify-self: start;
		align-items: center;
		min-height: 44px;
	}
	.app-nav-links {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.nav-divider {
		width: 1px;
		height: 20px;
		flex: 0 0 auto;
		margin-inline: 3px;
		background: color-mix(in srgb, var(--border-color) 58%, transparent);
	}
	.app-nav-tools {
		justify-self: end;
	}

	.nav-link,
	.icon-link {
		align-items: center;
		justify-content: center;
		border-radius: 0.625rem;
		color: var(--text-color-secondary);
		text-decoration: none;
		transition:
			color 150ms ease,
			background-color 150ms ease;
	}

	.settings-reload-indicator {
		position: relative;
	}

	.settings-reload-indicator__dot {
		position: absolute;
		top: 7px;
		right: 7px;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--status-warning-color);
		box-shadow: 0 0 0 2px var(--app-bg-color);
	}

	.nav-link {
		display: inline-flex;
		min-height: 38px;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 0.375rem 0.6875rem;
		font-size: 0.8125rem;
		font-weight: 560;
		white-space: nowrap;
		border: 1px solid transparent;
	}

	.nav-icon {
		width: 16px;
		height: 16px;
		flex: 0 0 auto;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.78;
		transition: opacity 150ms ease;
	}

	.icon-link {
		border: 0;
		background: transparent;
		width: 36px;
		height: 36px;
		font-size: 0.9375rem;
		line-height: 1;
		color: var(--icon-color);
	}

	.nav-link:hover,
	.icon-link:hover {
		color: var(--text-color);
		background: color-mix(in srgb, var(--card-bg-color) 72%, transparent);
		border-color: color-mix(in srgb, var(--border-color) 70%, transparent);
	}

	.nav-link.router-link-exact-active {
		color: var(--link-active-color);
		border-color: transparent;
		background: color-mix(in srgb, var(--link-active-color) 13%, var(--app-bg-color));
	}

	.nav-link:hover .nav-icon,
	.nav-link.router-link-exact-active .nav-icon {
		opacity: 1;
	}

	.nav-link:focus-visible,
	.icon-link:focus-visible,
	.app-brand:focus-visible {
		outline: 2px solid var(--link-active-color);
		outline-offset: 2px;
	}
	@media (max-width: 1199px) {
		.app-navigation {
			grid-template-columns: auto minmax(0, 1fr) auto;
			gap: 6px;
			padding-inline: 8px;
		}
		.app-nav-links {
			position: relative;
			min-width: 0;
			overflow-x: auto;
			padding: 4px;
			gap: 4px;
			border-radius: 12px;
			background: transparent;
			cursor: grab;
			user-select: none;
			scrollbar-width: none;
		}
		.app-nav-links::-webkit-scrollbar {
			display: none;
		}
		.app-nav-links .nav-link {
			flex-shrink: 0;
			min-height: 38px;
			padding-inline: 11px;
			border-radius: 9px;
		}
		.app-nav-links .nav-link.router-link-exact-active {
			font-weight: 600;
		}
		.app-nav-links .nav-link:focus-visible {
			outline-offset: -2px;
		}
	}
	@media (max-width: 767px) {
		.app-header {
			padding-inline: 0;
		}
		.icon-link {
			width: 44px;
			height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.nav-link,
		.icon-link {
			transition: none;
		}
	}
</style>
