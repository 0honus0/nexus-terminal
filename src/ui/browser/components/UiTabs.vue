<script setup lang="ts">
	import { TabsRoot, TabsList, TabsTrigger, TabsContent } from 'reka-ui';
	import type { UiTabsProps } from '../ui-component-types.js';
	defineProps<UiTabsProps>();
	const model = defineModel<string>();
</script>
<template>
	<TabsRoot v-model="model" :default-value="defaultValue" class="ui-tabs" data-ui="tabs">
		<TabsList class="ui-tabs__list" :aria-label="label">
			<TabsTrigger
				v-for="option in options"
				:key="option.value"
				:value="option.value"
				:disabled="option.disabled"
				class="ui-tabs__trigger"
				><component :is="option.icon" v-if="option.icon" :size="16" />{{ option.label }}</TabsTrigger
			>
		</TabsList>
		<div class="ui-tabs__panels" :data-stable="stableHeight || undefined">
			<TabsContent
				v-for="option in options"
				:key="option.value"
				:value="option.value"
				:force-mount="stableHeight"
				class="ui-tabs__panel"
				><slot :name="option.value"
			/></TabsContent>
		</div>
	</TabsRoot>
</template>
<style scoped>
	.ui-tabs__list {
		display: flex;
		gap: 4px;
		padding: 4px;
		border-radius: 12px;
		background: var(--ui-background);
	}
	.ui-tabs__trigger {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 40px;
		padding: 8px 12px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--ui-muted);
		cursor: pointer;
		font: inherit;
		font-size: 13px;
	}
	.ui-tabs__trigger[data-state='active'] {
		background: var(--ui-surface);
		color: var(--ui-primary);
	}
	.ui-tabs__trigger:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: 2px;
	}
	.ui-tabs__trigger:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.ui-tabs__panel {
		min-width: 0;
		outline-offset: 3px;
	}
	.ui-tabs__panels[data-stable] {
		display: grid;
	}
	.ui-tabs__panels[data-stable] .ui-tabs__panel {
		grid-area: 1 / 1;
	}
	.ui-tabs__panels[data-stable] .ui-tabs__panel[data-state='inactive'] {
		visibility: hidden;
		pointer-events: none;
	}
</style>
