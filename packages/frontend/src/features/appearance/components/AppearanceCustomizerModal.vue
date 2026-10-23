<script setup lang="ts">
	import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
	import { UiButton, UiSurface } from '@/foundation/ui';
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
				class="absolute flex h-full w-full flex-col overflow-hidden rounded-lg bg-background text-foreground shadow-[0px_0px_15px_rgb(0_0_0_/_0.15)] md:h-[85vh] md:max-h-[700px] md:w-[90%] md:max-w-[1000px]"
			>
				<header
					class="flex shrink-0 cursor-move items-center justify-between border-b border-border bg-header px-4 py-3"
					@mousedown="startDrag"
				>
					<h2 class="m-0 text-lg text-foreground md:text-xl">{{ t('styleCustomizer.title') }}</h2>
					<UiButton appearance="ghost" icon-only :aria-label="t('common.close')" @click="emit('close')">
						&times;
					</UiButton>
				</header>

				<div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
					<nav
						class="appearance-customizer-nav border-b border-border bg-header md:border-b-0 md:border-r"
						role="tablist"
						:aria-label="t('settings.appearance.title')"
					>
						<button
							v-for="(tab, index) in tabs"
							:key="tab.id"
							:id="`appearance-customizer-tab-${tab.id}`"
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
						class="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:px-6 md:py-4"
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

				<footer class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-footer p-3 md:p-4">
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
	.appearance-customizer-nav {
		display: flex;
		flex: 0 0 auto;
		flex-direction: row;
		gap: 6px;
		width: 100%;
		padding: 10px;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.appearance-customizer-nav::-webkit-scrollbar {
		display: none;
	}

	.appearance-customizer-nav__item {
		position: relative;
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-width: 68px;
		min-height: 56px;
		padding: 6px 4px;
		border: 1px solid transparent;
		border-radius: 11px;
		background: transparent;
		color: var(--text-color-secondary);
		font-size: 12px;
		font-weight: 560;
		line-height: 1.2;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
			border-color 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
			color 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.appearance-customizer-nav__item:hover:not([data-active]) {
		background: color-mix(in srgb, var(--card-bg-color) 42%, transparent);
		color: var(--text-color);
	}

	.appearance-customizer-nav__item[data-active] {
		border-color: color-mix(in srgb, var(--link-active-color) 18%, transparent);
		background: color-mix(in srgb, var(--card-bg-color) 58%, var(--link-active-color) 7%);
		color: var(--text-color);
	}

	.appearance-customizer-nav__item[data-active]::after {
		position: absolute;
		right: 10px;
		bottom: 0;
		left: 10px;
		height: 2px;
		border-radius: 999px;
		background: var(--link-active-color);
		content: '';
	}

	.appearance-customizer-nav__icon {
		display: grid;
		width: 24px;
		height: 24px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 7px;
		background: color-mix(in srgb, var(--text-color) 5%, transparent);
		color: var(--text-color-secondary);
		font-size: 11px;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.appearance-customizer-nav__item[data-active] .appearance-customizer-nav__icon {
		background: color-mix(in srgb, var(--link-active-color) 14%, var(--card-bg-color));
		color: var(--link-active-color);
	}

	.appearance-customizer-nav__label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (min-width: 768px) {
		.appearance-customizer-nav {
			flex-direction: column;
			gap: 4px;
			width: 184px;
			padding: 12px;
			overflow: visible;
		}

		.appearance-customizer-nav__item {
			flex: 0 0 auto;
			flex-direction: row;
			justify-content: flex-start;
			gap: 10px;
			width: 100%;
			min-width: 0;
			min-height: 44px;
			padding: 6px 10px 6px 12px;
		}

		.appearance-customizer-nav__item[data-active]::after {
			top: 10px;
			right: auto;
			bottom: 10px;
			left: 0;
			width: 2px;
			height: auto;
		}

		.appearance-customizer-nav__icon {
			width: 28px;
			height: 28px;
			border-radius: 9px;
			font-size: 12px;
		}
	}
</style>
