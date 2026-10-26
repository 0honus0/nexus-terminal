<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
	import { UiButton, UiPopover, UiSurface } from '@/foundation/ui';
	import { useI18n } from 'vue-i18n';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import { useAppearanceStore } from '../store/appearance.store';
	import { useAppearanceEditor } from '../composables/use-appearance-editor';
	import BasicAppearancePanel from './BasicAppearancePanel.vue';
	import TerminalBackgroundSettingsPanel from './TerminalBackgroundSettingsPanel.vue';
	import TerminalThemeSettingsPanel from './TerminalThemeSettingsPanel.vue';

	const props = defineProps<{ visible: boolean }>();
	const emit = defineEmits<{ close: [] }>();
	const { t } = useI18n();
	const store = useAppearanceStore();
	const editor = useAppearanceEditor();
	const editorGeneration = ref(0);

	async function refresh(): Promise<void> {
		if (await editor.run((permission) => store.load(true, permission), { notify: false })) {
			editorGeneration.value++;
		}
	}

	useSettingsReloadSource({
		id: 'appearance-customizer',

		pending: () => !store.busy && store.blocked,

		reload: refresh,
	});

	const activeTab = ref<'ui' | 'terminal' | 'background' | 'other'>('ui');
	const tabs = [
		{ id: 'ui', label: 'styleCustomizer.uiStyles', icon: 'fa-solid fa-palette' },
		{ id: 'terminal', label: 'styleCustomizer.terminalStyles', icon: 'fa-solid fa-terminal' },
		{ id: 'background', label: 'styleCustomizer.backgroundSettings', icon: 'fa-solid fa-image' },
		{ id: 'other', label: 'styleCustomizer.otherSettings', icon: 'fa-solid fa-sliders' },
	] as const;
	const activeTabDefinition = computed(() => tabs.find((tab) => tab.id === activeTab.value) ?? tabs[0]);
	const root = ref<HTMLElement | null>(null);
	const dialog = ref<HTMLElement | null>(null);
	const uiPanel = ref<InstanceType<typeof BasicAppearancePanel> | null>(null);
	const drag = reactive({ active: false, startX: 0, startY: 0, left: 0, top: 0 });

	const centerDialog = async (): Promise<void> => {
		await nextTick();
		if (!dialog.value) return;
		dialog.value.style.left = '';
		dialog.value.style.top = '';
	};

	const handleResize = (): void => {
		if (!drag.active) {
			void centerDialog();
		}
	};

	onMounted(() => {
		activeTab.value = 'ui';
		void centerDialog();
		window.addEventListener('resize', handleResize);
	});

	watch(
		() => props.visible,
		(visible) => {
			if (!visible) return;
			activeTab.value = 'ui';
			void centerDialog();
		},
	);

	const startDrag = (event: MouseEvent): void => {
		if (!dialog.value || !root.value || (event.target as HTMLElement).closest('button')) return;
		event.preventDefault();
		drag.active = true;
		drag.startX = event.clientX;
		drag.startY = event.clientY;
		drag.left = dialog.value.offsetLeft;
		drag.top = dialog.value.offsetTop;
		document.addEventListener('mousemove', moveDrag);
		document.addEventListener('mouseup', stopDrag);
	};

	const moveDrag = (event: MouseEvent): void => {
		if (!drag.active || !dialog.value || !root.value) return;
		const maxLeft = Math.max(0, root.value.clientWidth - dialog.value.offsetWidth);
		const maxTop = Math.max(0, root.value.clientHeight - dialog.value.offsetHeight);
		dialog.value.style.left = `${Math.max(0, Math.min(maxLeft, drag.left + event.clientX - drag.startX))}px`;
		dialog.value.style.top = `${Math.max(0, Math.min(maxTop, drag.top + event.clientY - drag.startY))}px`;
	};

	const stopDrag = (): void => {
		drag.active = false;
		document.removeEventListener('mousemove', moveDrag);
		document.removeEventListener('mouseup', stopDrag);
	};

	const moveTab = (event: KeyboardEvent, index: number): void => {
		const direction =
			event.key === 'ArrowUp' || event.key === 'ArrowLeft'
				? -1
				: event.key === 'ArrowDown' || event.key === 'ArrowRight'
					? 1
					: 0;
		if (direction === 0) return;
		event.preventDefault();
		const next = tabs[(index + direction + tabs.length) % tabs.length];
		if (!next) return;
		activeTab.value = next.id;
		void nextTick(() => document.getElementById(`appearance-customizer-tab-${next.id}`)?.focus());
	};

	onBeforeUnmount(() => {
		stopDrag();
		window.removeEventListener('resize', handleResize);
	});
</script>

<template>
	<Teleport to="body">
		<div
			v-if="props.visible"
			ref="root"
			data-ui="overlay"
			class="fixed inset-0 z-[1000] flex items-center justify-center"
			@click.self="emit('close')"
		>
			<div
				ref="dialog"
				class="ui-glass-panel absolute flex h-full w-full flex-col overflow-hidden rounded-lg text-foreground md:h-[85vh] md:max-h-[700px] md:w-[90%] md:max-w-[1000px]"
			>
				<header
					class="ui-glass-chrome flex shrink-0 cursor-move items-center justify-between border-b border-border px-4 py-3"
					@mousedown="startDrag"
				>
					<h2 class="m-0 text-lg text-foreground md:text-xl">{{ t('styleCustomizer.title') }}</h2>
					<UiButton appearance="ghost" icon-only :aria-label="t('common.close')" @click="emit('close')">
						&times;
					</UiButton>
				</header>

				<div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
					<div class="appearance-customizer-mobile-nav ui-glass-chrome">
						<UiPopover
							:ariaLabel="t(activeTabDefinition.label)"
							placement="bottom"
							align="start"
							:offset="6"
							wrapper-class="block w-full"
							panel-class="appearance-customizer-mobile-popover"
						>
							<template #trigger-control="{ open }">
								<button
									type="button"
									class="appearance-customizer-mobile-trigger ui-focusable"
									aria-haspopup="listbox"
									:aria-expanded="open"
								>
									<span class="appearance-customizer-nav__icon" aria-hidden="true">
										<i :class="activeTabDefinition.icon"></i>
									</span>
									<span class="appearance-customizer-mobile-trigger__label">{{
										t(activeTabDefinition.label)
									}}</span>
									<span class="appearance-customizer-mobile-trigger__chevron" aria-hidden="true">
										<i class="fa-solid fa-chevron-down"></i>
									</span>
								</button>
							</template>
							<template #panel="{ close }">
								<div
									class="appearance-customizer-mobile-menu"
									role="listbox"
									:aria-label="t('settings.appearance.title')"
								>
									<button
										v-for="tab in tabs"
										:key="tab.id"
										type="button"
										role="option"
										class="appearance-customizer-nav__item ui-focusable"
										:data-active="activeTab === tab.id || undefined"
										:aria-selected="activeTab === tab.id"
										@click="
											activeTab = tab.id;
											close();
										"
									>
										<span class="appearance-customizer-nav__icon" aria-hidden="true">
											<i :class="tab.icon"></i>
										</span>
										<span class="appearance-customizer-nav__label">{{ t(tab.label) }}</span>
									</button>
								</div>
							</template>
						</UiPopover>
					</div>

					<nav
						class="appearance-customizer-nav appearance-customizer-nav--desktop ui-glass-chrome border-border md:border-r"
						role="tablist"
						:aria-label="t('settings.appearance.title')"
					>
						<button
							v-for="(tab, index) in tabs"
							:id="`appearance-customizer-tab-${tab.id}`"
							:key="tab.id"
							type="button"
							role="tab"
							class="appearance-customizer-nav__item ui-focusable"
							:data-active="activeTab === tab.id || undefined"
							:aria-selected="activeTab === tab.id"
							aria-controls="appearance-customizer-panel"
							:tabindex="activeTab === tab.id ? 0 : -1"
							@click="activeTab = tab.id"
							@keydown="moveTab($event, index)"
						>
							<span class="appearance-customizer-nav__icon" aria-hidden="true">
								<i :class="tab.icon"></i>
							</span>
							<span class="appearance-customizer-nav__label">{{ t(tab.label) }}</span>
						</button>
					</nav>

					<main
						id="appearance-customizer-panel"
						:key="editorGeneration"
						role="tabpanel"
						:aria-labelledby="`appearance-customizer-tab-${activeTab}`"
						class="appearance-customizer-content min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:px-6 md:py-4"
					>
						<UiSurface v-if="activeTab === 'ui'" class="min-w-0 p-4"
							><BasicAppearancePanel ref="uiPanel" section="ui" :show-ui-actions="false"
						/></UiSurface>
						<div v-else-if="activeTab === 'terminal'" class="min-w-0 space-y-4">
							<UiSurface class="min-w-0 p-4"><BasicAppearancePanel section="terminal" /></UiSurface>
							<UiSurface class="min-w-0 p-4"
								><TerminalBackgroundSettingsPanel section="text-effects"
							/></UiSurface>
							<UiSurface class="min-w-0 p-4"><TerminalThemeSettingsPanel /></UiSurface>
						</div>
						<UiSurface v-else-if="activeTab === 'background'" class="min-w-0 p-4"
							><TerminalBackgroundSettingsPanel section="background"
						/></UiSurface>
						<UiSurface v-else class="min-w-0 p-4"><BasicAppearancePanel section="other" /></UiSurface>
					</main>
				</div>

				<footer
					class="ui-glass-chrome flex shrink-0 flex-wrap justify-end gap-2 border-t border-border p-3 md:p-4"
				>
					<UiButton
						v-if="activeTab === 'ui'"
						type="button"
						appearance="soft"
						tone="neutral"
						@click="uiPanel?.resetUiTheme()"
					>
						{{ t('styleCustomizer.resetUiTheme') }}
					</UiButton>
					<UiButton
						v-if="activeTab === 'ui'"
						type="button"
						appearance="solid"
						tone="primary"
						@click="uiPanel?.saveUiTheme()"
					>
						{{ t('styleCustomizer.saveUiTheme') }}
					</UiButton>
					<UiButton type="button" appearance="soft" tone="neutral" @click="emit('close')">
						{{ t('common.close') }}
					</UiButton>
				</footer>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
	.appearance-customizer-mobile-nav {
		display: flex;
		flex: 0 0 auto;
		width: 100%;
		padding: 10px 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 48%, transparent);
	}

	.appearance-customizer-mobile-trigger {
		position: relative;
		display: flex;
		gap: 10px;
		align-items: center;
		width: min(100%, 360px);
		min-height: 46px;
		padding: 7px 10px;
		border: 1px solid var(--glass-border-color);
		border-radius: 12px;
		background-color: color-mix(in srgb, var(--link-active-color) 8%, var(--glass-fill));
		background-image: var(--glass-sheen-image);
		color: var(--text-color);
		text-align: left;
		cursor: pointer;
		box-shadow: var(--glass-rim-shadow);
		-webkit-backdrop-filter: var(--ui-glass-filter);
		backdrop-filter: var(--ui-glass-filter);
		transition:
			background-color 140ms ease,
			border-color 140ms ease;
	}

	.appearance-customizer-mobile-trigger::before {
		position: absolute;
		top: 10px;
		bottom: 10px;
		left: 0;
		width: 2px;
		border-radius: 999px;
		background: var(--link-active-color);
		content: '';
	}

	.appearance-customizer-mobile-trigger:hover {
		border-color: var(--ui-hairline-strong);
		background-color: color-mix(in srgb, var(--link-active-color) 12%, var(--glass-fill));
	}

	.appearance-customizer-mobile-trigger__label {
		min-width: 0;
		overflow: hidden;
		font-size: 13px;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.appearance-customizer-mobile-trigger__chevron {
		display: grid;
		width: 22px;
		height: 22px;
		flex: 0 0 auto;
		margin-left: auto;
		place-items: center;
		border-radius: 7px;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 9px;
		transition: transform 160ms ease;
	}

	.appearance-customizer-mobile-trigger[data-state='open'] .appearance-customizer-mobile-trigger__chevron {
		transform: rotate(180deg);
	}

	.appearance-customizer-mobile-menu {
		display: grid;
		gap: 4px;
	}

	.appearance-customizer-mobile-menu .appearance-customizer-nav__item {
		justify-content: flex-start;
		text-align: left;
	}

	:global(.appearance-customizer-mobile-popover) {
		z-index: 1100;
		width: min(calc(100vw - 24px), 360px);
		padding: 6px;
	}

	.appearance-customizer-nav {
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		gap: 5px;
		width: 100%;
		padding: 8px;
		overflow-x: hidden;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.appearance-customizer-nav--desktop {
		display: none;
	}

	.appearance-customizer-nav::-webkit-scrollbar {
		display: none;
	}

	.appearance-customizer-nav__item {
		position: relative;
		display: flex;
		flex: 0 0 auto;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		gap: 9px;
		width: 100%;
		min-width: 0;
		min-height: 46px;
		padding: 7px 10px;
		border: 1px solid transparent;
		border-radius: 11px;
		background: transparent;
		color: var(--text-color-secondary);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.2;
		text-align: center;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
			border-color 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
			color 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.appearance-customizer-nav__item:hover:not([data-active]) {
		background: color-mix(in srgb, var(--card-bg-color) 44%, transparent);
		color: var(--text-color);
	}

	.appearance-customizer-nav__item[data-active] {
		border-color: var(--glass-border-color);
		background-color: color-mix(in srgb, var(--link-active-color) 11%, var(--glass-fill));
		background-image: var(--glass-sheen-image);
		color: var(--text-color);
		font-weight: 600;
		box-shadow: var(--glass-rim-shadow);
		-webkit-backdrop-filter: var(--ui-glass-filter);
		backdrop-filter: var(--ui-glass-filter);
	}

	.appearance-customizer-nav__item[data-active]::after {
		position: absolute;
		top: 10px;
		bottom: 10px;
		left: 0;
		display: block;
		width: 2px;
		border-radius: 999px;
		background: var(--link-active-color);
		content: '';
	}

	.appearance-customizer-nav__icon {
		display: grid;
		width: 26px;
		height: 26px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 10px;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.appearance-customizer-nav__item[data-active] .appearance-customizer-nav__icon {
		background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		color: var(--link-active-color);
	}

	.appearance-customizer-nav__label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (min-width: 768px) {
		.appearance-customizer-mobile-nav {
			display: none;
		}

		.appearance-customizer-nav--desktop {
			display: flex;
		}

		.appearance-customizer-nav {
			gap: 6px;
			width: 136px;
			padding: 16px 10px;
			overflow: visible;
		}

		.appearance-customizer-nav__item {
			min-width: 0;
			min-height: 52px;
			padding: 8px 10px;
		}

		.appearance-customizer-nav__icon {
			width: 30px;
			height: 30px;
			border-radius: 9px;
			font-size: 11px;
		}
	}

	@media (max-width: 767px) {
		.appearance-customizer-content {
			scrollbar-width: none;
			-ms-overflow-style: none;
		}

		.appearance-customizer-content::-webkit-scrollbar {
			display: none;
			width: 0;
			height: 0;
		}
	}
</style>
