<script setup lang="ts">
	import { Plus, X } from '@lucide/vue';
	import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiContextMenu, UiDropdownMenu } from '../../ui/browser/ui-components-api.js';
	import type { WindowChrome } from './window-chrome.js';

	const { chrome, title } = defineProps<{ chrome: WindowChrome; title: string }>();
	const { t } = useI18n({ useScope: 'global' });
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
		<TabsList class="window-tabs__list" :aria-label="title">
			<UiContextMenu
				v-for="tab in tabs.items"
				:key="tab.id"
				:items="tab.menu ?? []"
				:disabled="tab.disabled || !tab.menu?.length"
				@select="(id) => chrome.tab(tabs.id, 'menu', tab.id, id)"
			>
				<div class="window-tab">
					<TabsTrigger :value="tab.id" :disabled="tab.disabled" class="window-tab__trigger">{{
						tab.label
					}}</TabsTrigger>
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
		overflow: auto hidden;
		scrollbar-width: none;
	}
	.window-tab {
		display: flex;
		align-items: center;
		flex: none;
		max-width: min(180px, 60vw);
		border-radius: 8px;
	}
	.window-tab:has([data-state='active']) {
		background: var(--ui-surface);
		color: var(--ui-primary);
	}
	.window-tab__trigger {
		min-width: 0;
		background: none;
		border: 0;
		color: inherit;
		padding: 8px 10px;
		font: inherit;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
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
