<script setup lang="ts">
	import { computed, defineAsyncComponent, onActivated, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { useRoute, useRouter } from 'vue-router';
	import { loadAppearanceSettingsPanel, useAppearance } from '@/features/appearance/public';
	import { AgentSettingsPanel } from '@/features/agent/public';
	import { BackupSettingsPanel } from '@/features/backup/public';
	import { MutationRecoveryPanel } from '@/features/mutation-recovery/public';
	import { HostDiagnosticsPanel } from '@/features/system-overview/public';
	import { loadPreferencesSettingsPanel, loadWorkspacePreferencesPanel } from '@/features/preferences/public';
	import { SecuritySettingsPanel } from '@/features/security/public';
	import { useAuthSession } from '@/features/auth/public';
	import { supportedLocales } from '@/app/i18n';
	import { useHorizontalDragScroll } from '@/foundation/interaction';
	import { UiBadge } from '@/foundation/ui';
	import AboutPanel from './AboutPanel.vue';
	import packageJson from '../../../../package.json';

	const PreferencesSettingsPanel = defineAsyncComponent(loadPreferencesSettingsPanel);
	const WorkspacePreferencesPanel = defineAsyncComponent(loadWorkspacePreferencesPanel);
	const AppearanceSettingsPanel = defineAsyncComponent(loadAppearanceSettingsPanel);
	type SettingsTab = 'workspace' | 'system' | 'security' | 'ipControl' | 'data' | 'appearance' | 'agent' | 'about';

	const { t } = useI18n();
	const route = useRoute();
	const router = useRouter();
	const auth = useAuthSession();
	const appearance = useAppearance();
	const active = ref<SettingsTab>('workspace');

	const visited = reactive(new Set<SettingsTab>(['workspace']));
	const mobileView = ref<'menu' | 'detail'>('detail');
	const currentVersion = packageJson.version;
	const contentContainer = ref<HTMLElement | null>(null);
	const settingsTabsDrag = useHorizontalDragScroll();

	watch(
		active,
		(value) => {
			visited.add(value);
			contentContainer.value?.scrollTo({ top: 0, behavior: 'instant' });
		},
		{ immediate: true },
	);

	interface TabItem {
		value: SettingsTab;
		labelKey: string;
		icon: string;
		iconColor: string;
		iconBg: string;
		badge?: string;
	}

	interface TabGroup {
		id: string;
		titleKey: string;
		items: TabItem[];
	}

	const tabGroups = computed<TabGroup[]>(() => [
		{
			id: 'general',
			titleKey: 'settings.groups.general',
			items: [
				{
					value: 'workspace',
					labelKey: 'settings.tabs.workspace',
					icon: 'fa-solid fa-laptop-code',
					iconColor: 'text-blue-500',
					iconBg: 'bg-blue-500/10',
				},
				{
					value: 'system',
					labelKey: 'settings.tabs.system',
					icon: 'fa-solid fa-sliders',
					iconColor: 'text-indigo-500',
					iconBg: 'bg-indigo-500/10',
				},
				{
					value: 'appearance',
					labelKey: 'settings.tabs.appearance',
					icon: 'fa-solid fa-palette',
					iconColor: 'text-purple-500',
					iconBg: 'bg-purple-500/10',
				},
			],
		},
		{
			id: 'intelligence',
			titleKey: 'settings.groups.intelligence',
			items: [
				{
					value: 'agent',
					labelKey: 'agent.settings.tab',
					icon: 'fa-solid fa-wand-magic-sparkles',
					iconColor: 'text-violet-500',
					iconBg: 'bg-violet-500/10',
					badge: 'AI',
				},
			],
		},
		{
			id: 'securityAndData',
			titleKey: 'settings.groups.securityAndData',
			items: [
				{
					value: 'security',
					labelKey: 'settings.tabs.security',
					icon: 'fa-solid fa-shield-halved',
					iconColor: 'text-emerald-500',
					iconBg: 'bg-emerald-500/10',
				},
				{
					value: 'ipControl',
					labelKey: 'settings.tabs.ipControl',
					icon: 'fa-solid fa-network-wired',
					iconColor: 'text-teal-500',
					iconBg: 'bg-teal-500/10',
				},
				{
					value: 'data',
					labelKey: 'settings.tabs.dataManagement',
					icon: 'fa-solid fa-database',
					iconColor: 'text-amber-500',
					iconBg: 'bg-amber-500/10',
				},
			],
		},
		{
			id: 'systemInfo',
			titleKey: 'settings.groups.systemInfo',
			items: [
				{
					value: 'about',
					labelKey: 'settings.tabs.about',
					icon: 'fa-solid fa-circle-info',
					iconColor: 'text-sky-500',
					iconBg: 'bg-sky-500/10',
				},
			],
		},
	]);

	const allTabs = computed<TabItem[]>(() => tabGroups.value.flatMap((g) => g.items));

	const syncRouteTab = (): void => {
		const raw = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
		const next =
			typeof raw === 'string' && allTabs.value.some((item) => item.value === raw)
				? (raw as SettingsTab)
				: 'workspace';
		if (active.value !== next) active.value = next;
		mobileView.value = 'detail';
	};

	watch(() => route.query.tab, syncRouteTab, { immediate: true });
	onActivated(syncRouteTab);

	const currentTab = computed<TabItem>(() => {
		const item = allTabs.value.find((candidate) => candidate.value === active.value);
		if (!item) throw new Error(`Settings tab configuration is missing: ${active.value}`);
		return item;
	});

	type TabSurface = 'mobile' | 'desktop';
	type TabOrientation = 'horizontal' | 'vertical';

	const tabElementId = (surface: TabSurface, tab: SettingsTab): string => `settings-tab-${surface}-${tab}`;

	const tabLabel = (tab: SettingsTab): string => {
		const item = allTabs.value.find((candidate) => candidate.value === tab);
		return item ? t(item.labelKey) : tab;
	};

	const selectTab = (tab: SettingsTab) => {
		if (active.value === tab) {
			if (contentContainer.value) {
				contentContainer.value.scrollTo({ top: 0, behavior: 'smooth' });
			}
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} else {
			active.value = tab;
		}
		mobileView.value = 'detail';
		const currentQueryTab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
		if (currentQueryTab !== tab) {
			void router.replace({ query: { ...route.query, tab } }).catch(() => undefined);
		}
	};

	const focusTab = (surface: TabSurface, tab: SettingsTab): void => {
		requestAnimationFrame(() => document.getElementById(tabElementId(surface, tab))?.focus());
	};

	const handleTabKeydown = (
		event: KeyboardEvent,
		current: SettingsTab,
		orientation: TabOrientation,
		surface: TabSurface,
	): void => {
		const tabs = allTabs.value.map((item) => item.value);
		const index = tabs.indexOf(current);
		if (index < 0) return;
		let target: SettingsTab | undefined;
		if (event.key === 'Home') target = tabs[0];
		else if (event.key === 'End') target = tabs[tabs.length - 1];
		else if (orientation === 'horizontal' && event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
		else if (orientation === 'horizontal' && event.key === 'ArrowLeft')
			target = tabs[(index - 1 + tabs.length) % tabs.length];
		else if (orientation === 'vertical' && event.key === 'ArrowDown') target = tabs[(index + 1) % tabs.length];
		else if (orientation === 'vertical' && event.key === 'ArrowUp')
			target = tabs[(index - 1 + tabs.length) % tabs.length];
		if (!target) return;
		event.preventDefault();
		selectTab(target);
		focusTab(surface, target);
	};
</script>

<template>
	<main
		class="settings-page min-h-[calc(100dvh-var(--app-header-height))] lg:h-[calc(100dvh-var(--app-header-height))] lg:min-h-0 lg:max-h-[calc(100dvh-var(--app-header-height))] lg:overflow-hidden text-foreground flex flex-col"
		:class="{
			'h-[calc(100dvh-var(--app-header-height))] max-h-[calc(100dvh-var(--app-header-height))] overflow-hidden':
				mobileView === 'detail',
		}"
	>
		<div
			class="mx-auto max-w-[1600px] 2xl:max-w-[1720px] w-full h-full flex flex-col min-h-0 px-3 sm:px-5 lg:pl-6 lg:pr-8 xl:pl-8 xl:pr-10"
		>
			<!-- 移动端：目录总览视图 (Mobile Menu Catalog) -->
			<div v-if="mobileView === 'menu'" class="space-y-6 lg:hidden py-4 sm:py-6">
				<header class="px-1">
					<h1 class="text-xl font-bold tracking-tight text-foreground">{{ t('settings.title') }}</h1>
				</header>

				<div v-for="group in tabGroups" :key="group.id" class="space-y-2">
					<h2 class="px-2 text-xs font-semibold text-text-secondary tracking-wide">
						{{ t(group.titleKey) }}
					</h2>
					<div
						class="settings-mobile-group ui-glass-panel overflow-hidden rounded-2xl divide-y divide-border/60"
					>
						<button
							v-for="item in group.items"
							:key="item.value"
							type="button"
							class="settings-catalog-item flex w-full items-center justify-between p-3.5 text-left transition-colors"
							@click="selectTab(item.value)"
						>
							<div class="flex items-center gap-3 min-w-0">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
									:class="[item.iconBg, item.iconColor]"
								>
									<i :class="item.icon" class="text-sm" aria-hidden="true"></i>
								</div>
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="text-sm font-semibold text-foreground">{{
											t(item.labelKey)
										}}</span>
										<UiBadge v-if="item.badge" tone="primary" density="compact">
											{{ item.badge }}
										</UiBadge>
									</div>
								</div>
							</div>
							<i
								class="fa-solid fa-chevron-right shrink-0 text-xs text-text-secondary/50 ml-2"
								aria-hidden="true"
							></i>
						</button>
					</div>
				</div>
			</div>

			<!-- 主工作区：移动端详情页 或 桌面端两栏独立滚动布局 -->
			<div
				:class="{
					'hidden lg:flex': mobileView === 'menu',
					'flex flex-col lg:flex-row': mobileView === 'detail',
				}"
				class="h-full w-full min-h-0 gap-2 sm:gap-3 lg:gap-8 overflow-hidden"
			>
				<!-- 移动端：顶部紧凑导航栏 (单行高度，居中选项，右侧不设冗余标签，放不下时右侧隐藏/可滑动) -->
				<div
					class="settings-mobile-toolbar ui-glass-panel mt-2 flex items-center gap-2 rounded-xl p-1.5 lg:hidden shrink-0 w-full overflow-hidden"
				>
					<button
						type="button"
						class="settings-mobile-back ui-solid-item inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors shrink-0"
						@click="mobileView = 'menu'"
					>
						<i class="fa-solid fa-chevron-left text-primary text-[11px]" aria-hidden="true"></i>
						<span>{{ t('settings.mobile.allSettings') }}</span>
					</button>

					<!-- 居中设置项（无遮挡时居中，放不下时右侧隐藏/可滑动） -->
					<div
						class="flex-1 min-w-0 flex items-center overflow-x-auto no-scrollbar py-0.5 cursor-grab select-none"
						@pointerdown="settingsTabsDrag.pointerdown"
						@pointermove="settingsTabsDrag.pointermove"
						@pointerup="settingsTabsDrag.pointerup"
						@pointercancel="settingsTabsDrag.pointercancel"
						@lostpointercapture="settingsTabsDrag.lostpointercapture"
						@click.capture="settingsTabsDrag.click"
						@dragstart.prevent
						role="tablist"
						:aria-label="t('settings.sectionsAriaLabel')"
					>
						<div class="flex items-center gap-1.5 mx-auto shrink-0">
							<button
								v-for="item in allTabs"
								:key="item.value"
								type="button"
								role="tab"
								:id="tabElementId('mobile', item.value)"
								:tabindex="active === item.value ? 0 : -1"
								:aria-selected="active === item.value"
								:aria-controls="`settings-panel-${item.value}`"
								class="settings-mobile-tab ui-solid-item inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer"
								:class="
									active === item.value
										? 'settings-mobile-tab--active text-foreground font-semibold'
										: 'border-transparent text-text-secondary hover:text-foreground'
								"
								@click="selectTab(item.value)"
								@keydown="handleTabKeydown($event, item.value, 'horizontal', 'mobile')"
							>
								<i :class="item.icon" class="text-[11px]" aria-hidden="true"></i>
								<span>{{ t(item.labelKey) }}</span>
							</button>
						</div>
					</div>
				</div>

				<!-- 桌面端左侧悬浮控制岛 (Desktop Vertically Centered Floating Island) -->
				<aside class="hidden lg:flex flex-col justify-center shrink-0 w-64 xl:w-72 h-full py-4 select-none">
					<div
						class="settings-sidebar ui-glass-panel rounded-[20px] p-3.5 xl:p-4 flex flex-col justify-between min-h-[560px] xl:min-h-[620px] max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-y-contain no-scrollbar"
					>
						<div class="space-y-3.5 xl:space-y-4">
							<div class="settings-sidebar__head flex items-center gap-2.5 px-2.5 pt-1 pb-2">
								<div
									class="settings-icon-tile flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400"
								>
									<i class="fa-solid fa-sliders text-xs" aria-hidden="true"></i>
								</div>
								<h1 class="text-sm font-bold text-foreground leading-none tracking-tight">
									{{ t('settings.title') }}
								</h1>
							</div>

							<!-- 分组导航 (Soft, breathable groups without harsh divider borders) -->
							<nav
								class="space-y-3.5 xl:space-y-4"
								role="tablist"
								aria-orientation="vertical"
								:aria-label="t('settings.sectionsAriaLabel')"
							>
								<div v-for="group in tabGroups" :key="group.id" class="space-y-1">
									<div
										class="px-2.5 text-[11px] font-semibold text-text-secondary/70 uppercase tracking-wider"
									>
										{{ t(group.titleKey) }}
									</div>
									<div class="space-y-0.5">
										<button
											v-for="item in group.items"
											:key="item.value"
											type="button"
											role="tab"
											:id="tabElementId('desktop', item.value)"
											:tabindex="active === item.value ? 0 : -1"
											:aria-selected="active === item.value"
											:aria-controls="`settings-panel-${item.value}`"
											class="settings-nav-item ui-solid-item group relative flex w-full items-center justify-between rounded-xl pl-3 pr-2.5 py-2 xl:py-2.5 text-left text-xs transition-colors duration-150 ease-out cursor-pointer overflow-hidden"
											:class="
												active === item.value
													? 'settings-nav-item--active text-foreground font-semibold'
													: 'settings-nav-item--idle border-transparent text-text-secondary hover:text-foreground font-medium'
											"
											@click="selectTab(item.value)"
											@keydown="handleTabKeydown($event, item.value, 'vertical', 'desktop')"
										>
											<!-- 左侧高亮指示条 (Active Left Indicator) -->
											<span
												class="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-primary transition-all duration-200 ease-out"
												:class="
													active === item.value
														? 'opacity-100 scale-y-100'
														: 'opacity-0 scale-y-50 pointer-events-none'
												"
												aria-hidden="true"
											></span>

											<div class="flex items-center gap-2.5 min-w-0">
												<div
													class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors"
													:class="[item.iconBg, item.iconColor]"
												>
													<i :class="item.icon" class="text-xs" aria-hidden="true"></i>
												</div>
												<span class="truncate">{{ t(item.labelKey) }}</span>
											</div>
											<UiBadge
												v-if="item.badge"
												class="uppercase"
												:tone="active === item.value ? 'primary' : 'neutral'"
												:appearance="active === item.value ? 'soft' : 'ghost'"
												density="compact"
											>
												{{ item.badge }}
											</UiBadge>
										</button>
									</div>
								</div>
							</nav>
						</div>

						<div
							class="pt-3 px-2 flex items-center justify-between text-xs text-text-secondary select-none font-medium"
						>
							<span class="inline-flex items-center gap-1.5 font-medium">
								<span
									class="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"
								></span>
								<span class="text-xs tracking-wide text-text-secondary">Nexus Console</span>
							</span>
							<span class="text-xs font-mono text-text-secondary">v{{ currentVersion }}</span>
						</div>
					</div>
				</aside>

				<!-- 右侧主内容区 (Independent Scroll Canvas) -->
				<section
					ref="contentContainer"
					class="settings-content-canvas min-w-0 flex-1 h-full min-h-0 overflow-y-auto overscroll-y-contain pt-1.5 pb-4 lg:py-5 pr-1 lg:pr-3 space-y-4 touch-pan-y"
				>
					<div class="settings-content-head hidden lg:flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-xs"
								:class="[currentTab.iconBg, currentTab.iconColor]"
							>
								<i :class="currentTab.icon" class="text-base" aria-hidden="true"></i>
							</div>
							<div>
								<h2 class="text-base font-bold text-foreground leading-tight">
									{{ t(currentTab.labelKey) }}
								</h2>
							</div>
						</div>
					</div>

					<div class="settings-content-stack">
						<WorkspacePreferencesPanel
							v-if="visited.has('workspace')"
							v-show="active === 'workspace'"
							id="settings-panel-workspace"
							role="tabpanel"
							:aria-label="tabLabel('workspace')"
						/>
						<PreferencesSettingsPanel
							v-if="visited.has('system')"
							v-show="active === 'system'"
							id="settings-panel-system"
							role="tabpanel"
							:aria-label="tabLabel('system')"
							section="system"
							:locales="supportedLocales"
						/>
						<SecuritySettingsPanel
							v-if="visited.has('security')"
							v-show="active === 'security'"
							id="settings-panel-security"
							role="tabpanel"
							:aria-label="tabLabel('security')"
							section="security"
							:two-factor-enabled="auth.user.value?.twoFactorEnabled"
							@auth-changed="auth.refreshSession"
						/>
						<SecuritySettingsPanel
							v-if="visited.has('ipControl')"
							v-show="active === 'ipControl'"
							id="settings-panel-ipControl"
							role="tabpanel"
							:aria-label="tabLabel('ipControl')"
							section="ipControl"
							:two-factor-enabled="auth.user.value?.twoFactorEnabled"
							@auth-changed="auth.refreshSession"
						/>
						<BackupSettingsPanel
							:active="active === 'data'"
							v-if="visited.has('data')"
							v-show="active === 'data'"
							id="settings-panel-data"
							role="tabpanel"
							:aria-label="tabLabel('data')"
						/>
						<details
							v-if="visited.has('data')"
							v-show="active === 'data'"
							class="ui-settings-group settings-maintenance"
						>
							<summary class="ui-glass-chrome flex cursor-pointer list-none items-center gap-3">
								<span class="ui-settings-group__icon" aria-hidden="true">
									<i class="fa-solid fa-screwdriver-wrench"></i>
								</span>
								<span class="settings-maintenance__heading">
									<span class="text-sm font-semibold text-foreground">{{
										t('settings.advancedMaintenance')
									}}</span>
								</span>
								<i
									class="settings-maintenance__chevron fa-solid fa-chevron-down ml-auto text-[10px] text-text-secondary"
									aria-hidden="true"
								></i>
							</summary>
							<div class="settings-maintenance__body">
								<HostDiagnosticsPanel :active="active === 'data'" />
								<MutationRecoveryPanel :active="active === 'data'" />
							</div>
						</details>
						<AppearanceSettingsPanel
							:active="active === 'appearance'"
							v-if="visited.has('appearance')"
							v-show="active === 'appearance'"
							id="settings-panel-appearance"
							role="tabpanel"
							:aria-label="tabLabel('appearance')"
							@customize="appearance.openCustomizer()"
						/>
						<AgentSettingsPanel
							:active="active === 'agent'"
							v-if="visited.has('agent')"
							v-show="active === 'agent'"
							id="settings-panel-agent"
							role="tabpanel"
							:aria-label="tabLabel('agent')"
						/>
						<AboutPanel
							v-if="visited.has('about')"
							v-show="active === 'about'"
							id="settings-panel-about"
							role="tabpanel"
							:aria-label="tabLabel('about')"
						/>
					</div>
				</section>
			</div>
		</div>
	</main>
</template>

<style scoped>
	.settings-page {
		background: var(--app-bg-color);
	}

	.settings-sidebar {
		border-radius: 20px;
	}

	.settings-sidebar__head {
		border-bottom: 0;
	}

	.settings-content-head {
		padding: 2px 2px 13px;
	}

	.settings-content-canvas {
		scrollbar-gutter: stable;
	}

	.settings-content-stack {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 14px;
	}

	.settings-maintenance__chevron {
		transition: transform 160ms ease;
	}

	.settings-maintenance,
	.settings-maintenance[open] {
		padding: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.settings-maintenance > summary {
		padding: 16px 18px;
		border-radius: 16px;
	}

	.settings-maintenance__heading {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 3px;
	}

	.settings-maintenance__body {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 12px;
	}

	.settings-maintenance[open] .settings-maintenance__chevron {
		transform: rotate(180deg);
	}

	.settings-maintenance[open] > summary {
		margin-bottom: 12px;
	}

	@media (max-width: 640px) {
		.settings-maintenance > summary {
			padding: 14px 15px;
			border-radius: 14px;
		}
	}

	.settings-mobile-toolbar {
		border-radius: 12px;
	}

	/* Settings actions are used repeatedly across long forms. Give the shared buttons a larger
   * visual and pointer target here without increasing buttons in dense Workspace toolbars. */
	.settings-page :deep([data-ui='button']:not([data-density='compact']):not([data-density='comfortable'])) {
		--ui-control-height: 38px;
		--ui-control-padding-inline: 14px;
		--ui-control-gap: 8px;
		--ui-control-font-size: 13px;
	}

	.settings-page :deep([data-ui='button'][data-density='compact']) {
		--ui-control-height: 34px;
		--ui-control-padding-inline: 11px;
		--ui-control-gap: 7px;
		--ui-control-font-size: 12px;
	}

	.settings-icon-tile {
		border: 0;
		box-shadow: none;
	}

	.settings-nav-item--active,
	.settings-mobile-tab--active {
		border-color: transparent;
		background: color-mix(in srgb, var(--card-bg-color) 72%, var(--link-active-color) 12%);
		box-shadow: none;
	}

	.settings-nav-item--idle {
		background: transparent;
	}

	.settings-nav-item--idle:hover,
	.settings-mobile-tab:not(.settings-mobile-tab--active):hover,
	.settings-mobile-back:hover,
	.settings-catalog-item:hover {
		background: var(--header-bg-color);
	}

	.settings-catalog-item:active {
		background: var(--input-bg-color);
	}

	/* Child panels keep their own spacing; the page supplies the shared canvas. */
	.settings-page :deep(.settings-surface) {
		overflow: visible;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.settings-page :deep(.settings-surface > h2) {
		display: none;
	}

	@media (max-width: 1023px) {
		.settings-content-canvas {
			padding-inline: 0;
			scrollbar-gutter: auto;
			scrollbar-width: none;
			-ms-overflow-style: none;
		}

		.settings-content-canvas::-webkit-scrollbar {
			display: none;
			width: 0;
			height: 0;
		}
	}

	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
