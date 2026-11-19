<script setup lang="ts">
	import { Check, ChevronRight, Package, PanelsTopLeft, Pencil, Plus } from '@lucide/vue';
	import { useEventListener } from '@vueuse/core';
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '../../ui/browser/ui-base-api.js';
	import type { WindowApi } from '../../window/browser/window-api.js';
	import type { DesktopApplication } from './desktop-api.js';

	const { windows, pins, applications } = defineProps<{
		windows: WindowApi;
		pins: readonly string[];
		applications: ReadonlyMap<string, DesktopApplication>;
	}>();
	const emit = defineEmits<{ add: [] }>();
	const editing = defineModel<boolean>('editing', { required: true });
	const { t } = useI18n({ useScope: 'global' });
	const root = ref<HTMLElement>();
	const reveal = ref<InstanceType<typeof UiButton>>();
	const expanded = ref(false);
	const active = computed(() => windows.active.value);
	const running = computed(() => windows.items.value.filter((item) => !item.closing));
	const keys = computed(() =>
		[...new Set([...pins, ...running.value.map(({ application }) => application.key)])].filter((key) =>
			applications.has(key),
		),
	);

	useEventListener(
		'pointerdown',
		(event) => {
			if (expanded.value && event.target instanceof Node && !root.value?.contains(event.target))
				expanded.value = false;
		},
		{ capture: true },
	);

	function close(): void {
		expanded.value = false;
		reveal.value?.$el.focus({ preventScroll: true });
	}

	function leave(): void {
		if (!root.value?.contains(document.activeElement)) expanded.value = false;
	}

	function blur(event: FocusEvent): void {
		if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return;
		if (root.value?.matches(':hover')) return;
		expanded.value = false;
	}

	function performAction(): void {
		if (active.value) {
			for (const item of running.value) item.minimized = true;
		} else editing.value = !editing.value;
	}

	function toggle(key: string, event: MouseEvent): void {
		const app = applications.get(key);
		if (app) windows.toggle(app, event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined);
	}
</script>

<template>
	<div
		ref="root"
		class="dock-region"
		:class="{ 'is-expanded': expanded }"
		@pointerenter="(event) => event.pointerType !== 'touch' && event.buttons === 0 && (expanded = true)"
		@pointerleave="leave"
		@focusin="(event) => (event.target as HTMLElement).matches(':focus-visible') && (expanded = true)"
		@focusout="blur"
		@keydown.esc.stop="close"
	>
		<UiButton
			ref="reveal"
			class="dock-reveal"
			icon-only
			density="compact"
			:aria-label="t('desktop.showTools')"
			:aria-expanded="expanded"
			:aria-hidden="expanded || undefined"
			:tabindex="expanded ? -1 : 0"
			aria-controls="desktop-dock"
			@click="expanded = true"
		>
			<ChevronRight :size="12" />
		</UiButton>
		<nav id="desktop-dock" class="desktop-dock" :aria-label="t('desktop.tools')" :inert="!expanded">
			<UiButton
				class="dock-action"
				icon-only
				:aria-pressed="!active ? editing : undefined"
				:aria-label="t(active ? 'desktop.showDesktop' : editing ? 'desktop.finishEditing' : 'desktop.edit')"
				@click="performAction"
			>
				<component :is="active ? PanelsTopLeft : editing ? Check : Pencil" :size="21" :stroke-width="1.8" />
			</UiButton>
			<UiButton v-if="editing" icon-only :aria-label="t('desktop.addTile')" @click="emit('add')"
				><Plus :size="20"
			/></UiButton>
			<span v-if="keys.length" class="dock-divider" aria-hidden="true" />
			<UiButton
				v-for="key in keys"
				:key="key"
				class="dock-app"
				:style="{ '--app-accent': applications.get(key)?.color }"
				:class="{ 'is-active': active?.application.key === key }"
				icon-only
				:aria-label="t('desktop.openWindow', { title: applications.get(key)?.label() })"
				:title="applications.get(key)?.label()"
				@click="(event: MouseEvent) => toggle(key, event)"
			>
				<component :is="applications.get(key)?.icon ?? Package" :size="22" :stroke-width="1.7" />
				<span
					v-if="running.some(({ application }) => application.key === key)"
					class="dock-running"
					aria-hidden="true"
				/>
			</UiButton>
		</nav>
	</div>
</template>
<style scoped>
	.dock-region {
		position: fixed;
		left: 0;
		top: 50%;
		z-index: 40;
		width: calc(80px + env(safe-area-inset-left));
		max-height: 100dvh;
		padding: 12px 12px 12px max(12px, env(safe-area-inset-left));
		transform: translateY(-50%);
		pointer-events: none;
	}
	/* Keep the bridge from the edge to the toolbar stable throughout its animation.
	   Collapsed gutters still pass card drag/resize input through to the desktop. */
	.dock-region.is-expanded {
		pointer-events: auto;
	}
	.dock-reveal {
		position: absolute;
		left: 0;
		top: 50%;
		display: grid;
		place-items: center;
		width: max(12px, env(safe-area-inset-left));
		min-width: 0;
		height: 56px;
		padding: 0;
		border: 0;
		border-radius: 0 6px 6px 0;
		background: color-mix(in srgb, var(--ui-primary) 14%, transparent);
		box-shadow: none;
		backdrop-filter: none;
		color: var(--ui-primary);
		transform: translateY(-50%);
		cursor: pointer;
		pointer-events: auto;
	}
	.is-expanded .dock-reveal {
		opacity: 0;
		pointer-events: none;
	}
	.desktop-dock {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		width: 56px;
		max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
		overflow-y: auto;
		scrollbar-width: none;
		padding: 6px;
		border: 1px solid var(--ui-border);
		border-radius: 19px;
		background: color-mix(in srgb, var(--ui-surface) 90%, transparent);
		box-shadow:
			0 8px 30px #1f163516,
			inset 0 1px 0 #ffffff30;
		backdrop-filter: blur(20px);
		transform: translateX(calc(-100% - 24px - env(safe-area-inset-left)));
		visibility: hidden;
		transition:
			transform calc(260ms * var(--ui-motion-factor, 1) / var(--ui-motion-speed, 1))
				cubic-bezier(0.25, 0.1, 0.25, 1),
			visibility calc(260ms * var(--ui-motion-factor, 1) / var(--ui-motion-speed, 1));
		pointer-events: none;
	}
	.is-expanded .desktop-dock {
		transform: translateX(0);
		visibility: visible;
		pointer-events: auto;
	}
	.desktop-dock :deep(button) {
		position: relative;
		display: grid;
		place-items: center;
		width: 42px;
		height: 44px;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		border-radius: 12px;
		cursor: pointer;
		background: transparent;
		color: var(--app-accent, var(--ui-primary));
	}
	.desktop-dock :deep(button:hover),
	.dock-app.is-active,
	.dock-action[aria-pressed='true'] {
		background: color-mix(in srgb, var(--app-accent, var(--ui-primary)) 12%, transparent);
	}
	.desktop-dock :deep(button:focus-visible) {
		outline-offset: -2px;
	}
	.desktop-dock :deep(button:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.dock-app :deep(.dock-running) {
		position: absolute;
		left: 2px;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--app-accent, var(--ui-primary));
	}
	.dock-app.is-active :deep(.dock-running) {
		height: 12px;
		border-radius: 3px;
	}
	.dock-divider {
		width: 24px;
		height: 1px;
		margin: 1px 0;
		flex-shrink: 0;
		background: var(--ui-border);
	}
	@media (prefers-reduced-motion: reduce) {
		.desktop-dock {
			transition: none;
		}
	}
</style>
