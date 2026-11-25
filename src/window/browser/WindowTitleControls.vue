<script setup lang="ts">
	import { LoaderCircle, Plus, X } from '@lucide/vue';
	import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
	import { useI18n } from 'vue-i18n';
	import { onScopeDispose } from 'vue';
	import { UiButton, UiContextMenu, UiDropdownMenu } from '../../ui/browser/ui-components-api.js';
	import type { WindowChrome } from './window-chrome.js';

	const { chrome, title } = defineProps<{ chrome: WindowChrome; title: string }>();
	const { t } = useI18n({ useScope: 'global' });

	// The titlebar disables native touch gestures for window dragging. Handle
	// horizontal movement here for mouse, touch and pen at every viewport size.
	let gesture: { list: HTMLElement; id: number; x: number; y: number; left: number; dragging: boolean } | undefined;
	let suppressClick = false;

	function beginScroll(event: PointerEvent) {
		if (!event.isPrimary || event.button !== 0) return;
		endScroll();
		suppressClick = false;
		const list = event.currentTarget as HTMLElement;
		if (list.scrollWidth <= list.clientWidth) return;
		gesture = {
			list,
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			left: list.scrollLeft,
			dragging: false,
		};
		window.addEventListener('pointermove', moveScroll);
		window.addEventListener('pointerup', endScroll);
		window.addEventListener('pointercancel', endScroll);
	}

	function moveScroll(event: PointerEvent) {
		const current = gesture;
		if (!current || event.pointerId !== current.id) return;
		const dx = event.clientX - current.x;
		if (!current.dragging) {
			if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(event.clientY - current.y)) return;
			current.dragging = true;
			suppressClick = true;
			current.list.dataset.dragging = '';
			if (current.list.isConnected) current.list.setPointerCapture(event.pointerId);
		}
		event.preventDefault();
		current.list.scrollLeft = current.left - dx;
	}

	function endScroll(event?: PointerEvent) {
		if (event && event.pointerId !== gesture?.id) return;
		const current = gesture;
		gesture = undefined;
		if (current) {
			delete current.list.dataset.dragging;
			if (current.list.hasPointerCapture(current.id)) current.list.releasePointerCapture(current.id);
		}
		window.removeEventListener('pointermove', moveScroll);
		window.removeEventListener('pointerup', endScroll);
		window.removeEventListener('pointercancel', endScroll);
	}

	function filterClick(event: MouseEvent) {
		if (!suppressClick || event.detail === 0) return;
		suppressClick = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	function scrollWheel(event: WheelEvent) {
		const list = event.currentTarget as HTMLElement;
		if (event.ctrlKey || event.metaKey || list.scrollWidth <= list.clientWidth) return;
		const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
		const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1);
		if (!pixels) return;
		event.preventDefault();
		list.scrollLeft += pixels;
	}

	onScopeDispose(() => endScroll());
</script>

<template>
	<TabsRoot
		v-for="tabs in chrome.tabs.value ? [chrome.tabs.value] : []"
		:key="tabs.id"
		:model-value="tabs.activeId"
		activation-mode="manual"
		class="window-tabs"
		@update:model-value="(value) => chrome.tab(tabs.id, 'select', String(value))"
	>
		<TabsList
			class="window-tabs__list"
			:aria-label="title"
			@pointerdown="beginScroll"
			@click.capture="filterClick"
			@wheel="scrollWheel"
		>
			<UiContextMenu
				v-for="tab in tabs.items"
				:key="tab.id"
				:items="tab.menu ?? []"
				:disabled="tab.disabled || !tab.menu?.length"
				@select="(id) => chrome.tab(tabs.id, 'menu', tab.id, id)"
			>
				<div
					class="window-tab"
					:data-tone="tab.status?.tone"
					:title="tab.status ? tab.label + ' · ' + tab.status.label : undefined"
				>
					<TabsTrigger
						:value="tab.id"
						:disabled="tab.disabled"
						class="window-tab__trigger"
						:aria-description="tab.status?.label"
						@mousedown.capture.prevent
						@click="
							(event: MouseEvent) => {
								if (event.detail) {
									(event.currentTarget as HTMLElement).focus({ preventScroll: true });
									chrome.tab(tabs.id, 'select', tab.id);
								}
							}
						"
					>
						<LoaderCircle
							v-if="tab.status?.busy"
							class="window-tab__spinner"
							:size="13"
							aria-hidden="true"
						/>
						<span v-else-if="tab.status" class="window-tab__dot" aria-hidden="true" />
						<span class="window-tab__label">{{ tab.label }}</span>
					</TabsTrigger>
					<UiButton
						v-if="tab.closable"
						appearance="ghost"
						density="compact"
						icon-only
						:disabled="tab.disabled"
						:aria-label="t('desktop.closeTab', { title: tab.label })"
						@click="chrome.tab(tabs.id, 'close', tab.id)"
						><X :size="13"
					/></UiButton>
				</div>
			</UiContextMenu>
		</TabsList>
		<UiButton
			v-if="tabs.addLabel"
			appearance="ghost"
			density="compact"
			icon-only
			:aria-label="tabs.addLabel"
			@click="chrome.tab(tabs.id, 'add')"
			><Plus :size="16"
		/></UiButton>
	</TabsRoot>
	<slot v-if="!chrome.tabs.value" />
	<div v-if="chrome.actions.value.length" class="window-actions">
		<template v-for="{ registration, action, key, busy } in chrome.actions.value" :key="key">
			<UiDropdownMenu
				v-if="action.items"
				:items="action.items"
				:transition="action.menuTransition"
				@select="(id) => chrome.action(registration, action.id, id)"
			>
				<UiButton
					appearance="ghost"
					density="compact"
					:icon-only="!!action.icon"
					:aria-label="action.label"
					:disabled="action.disabled || busy"
					><component :is="action.icon" v-if="action.icon" :size="16" /><template v-else>{{
						action.label
					}}</template></UiButton
				>
			</UiDropdownMenu>
			<UiButton
				v-else
				appearance="ghost"
				density="compact"
				:icon-only="!!action.icon"
				:aria-label="action.label"
				:disabled="action.disabled || busy"
				@click="chrome.action(registration, action.id)"
			>
				<component :is="action.icon" v-if="action.icon" :size="16" /><template v-else>{{
					action.label
				}}</template>
			</UiButton>
		</template>
	</div>
</template>

<style scoped>
	.window-tabs {
		display: flex;
		align-items: center;
		flex: 1;
		gap: 5px;
		min-width: 0;
	}
	.window-tabs__list {
		display: flex;
		gap: 4px;
		min-width: 0;
		flex-wrap: nowrap;
		overflow: auto hidden;
		scrollbar-width: none;
		overscroll-behavior-x: contain;
		touch-action: none;
		user-select: none;
	}
	.window-tabs__list[data-dragging],
	.window-tabs__list[data-dragging] * {
		cursor: grabbing;
	}

	.window-tab {
		display: flex;
		align-items: center;
		flex: none;
		max-width: min(180px, 60vw);
		border-radius: 8px;
		box-shadow: inset 0 0 0 1px transparent;
	}
	.window-tab[data-tone='success'] {
		--_tab-tone: var(--ui-success);
	}
	.window-tab[data-tone='warning'] {
		--_tab-tone: var(--ui-warning);
	}
	.window-tab[data-tone='info'] {
		--_tab-tone: var(--ui-app-blue, var(--ui-primary));
	}
	.window-tab[data-tone='danger'] {
		--_tab-tone: var(--ui-danger);
	}
	.window-tab[data-tone='neutral'] {
		--_tab-tone: var(--ui-muted);
	}
	.window-tab[data-tone] {
		background: color-mix(in srgb, var(--_tab-tone) 9%, transparent);
	}
	.window-tab[data-tone]:has([data-state='active']) {
		background: color-mix(in srgb, var(--_tab-tone) 18%, var(--ui-surface));
		box-shadow: inset 0 0 0 1px var(--_tab-tone);
		color: var(--ui-text);
	}
	.window-tab[data-tone]:not(:has([data-state='active'])):hover {
		background: color-mix(in srgb, var(--_tab-tone) 14%, transparent);
	}
	.window-tab__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--_tab-tone);
		flex: none;
	}
	.window-tab__spinner {
		color: var(--_tab-tone);
		flex: none;
		animation: window-tab-spin 1s linear infinite;
	}
	@keyframes window-tab-spin {
		to {
			transform: rotate(360deg);
		}
	}
	:global(html[data-ui-motion='reduced']) .window-tab__spinner {
		animation: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.window-tab__spinner {
			animation: none;
		}
	}
	.window-tab:has([data-state='active']) {
		background: var(--ui-surface);
		color: var(--ui-primary);
	}
	.window-tab__trigger {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		background: none;
		border: 0;
		color: inherit;
		padding: 8px 10px;
		font: inherit;
		font-size: 13px;
		line-height: 18px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.window-tab__label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.window-tab > :deep([data-ui='button']),
	.window-tabs > :deep([data-ui='button']) {
		flex: none;
	}
	.window-tab__trigger:focus-visible {
		outline-offset: -2px;
	}
	.window-actions {
		display: flex;
		gap: 3px;
		margin-inline-start: auto;
		flex: none;
	}
</style>
