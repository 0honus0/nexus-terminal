<script setup lang="ts">
	import type { UiSectionProps } from '../ui-component-types.js';
	import { useId } from 'vue';
	import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from 'reka-ui';
	import { ChevronDown } from '@lucide/vue';
	import UiButton from './UiButton.vue';
	withDefaults(defineProps<UiSectionProps>(), { appearance: 'plain', collapsible: false });
	const open = defineModel<boolean>('open', { default: true });
	// 标题先于正文渲染，预先分配 ID，保证首次展开时按钮已关联到正文。
	const contentId = useId();
</script>

<template>
	<CollapsibleRoot
		as="section"
		class="ui-section"
		data-ui="section"
		:data-appearance="appearance"
		:open="!collapsible || open"
		@update:open="open = $event"
	>
		<header v-if="title || description || $slots.actions || collapsible" class="ui-section__header">
			<div class="ui-section__heading">
				<h2 v-if="title"><component :is="icon" v-if="icon" :size="18" aria-hidden="true" />{{ title }}</h2>
				<p v-if="description">{{ description }}</p>
			</div>
			<div v-if="$slots.actions || collapsible" class="ui-section__actions">
				<slot name="actions" />
				<CollapsibleTrigger v-if="collapsible" as-child>
					<UiButton
						appearance="ghost"
						density="compact"
						icon-only
						:aria-label="title"
						:aria-controls="contentId"
					>
						<ChevronDown class="ui-section__chevron" :size="16" aria-hidden="true" />
					</UiButton>
				</CollapsibleTrigger>
			</div>
		</header>
		<!-- 保持表单与列表挂载；折叠仅隐藏内容，不重置输入或业务状态。 -->
		<CollapsibleContent v-if="collapsible" as-child force-mount>
			<div v-show="open" :id="contentId" class="ui-section__content"><slot /></div>
		</CollapsibleContent>
		<slot v-else />
	</CollapsibleRoot>
</template>

<style scoped>
	.ui-section {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--ui-layout-gap, 16px);
	}
	.ui-section[data-appearance='panel'] {
		padding: var(--ui-section-padding, 22px);
		border: 1px solid var(--ui-border);
		border-radius: var(--ui-section-radius, 20px);
		background: var(--ui-surface);
	}
	.ui-section__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ui-layout-gap, 16px);
	}
	.ui-section__heading {
		min-width: 0;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		font-size: var(--ui-section-title-size, 15px);
		font-weight: 600;
		color: var(--ui-text);
		overflow-wrap: anywhere;
	}
	p {
		margin: 8px 0 0;
		font-size: 12px;
		line-height: 1.7;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.ui-section__actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.ui-section__content {
		display: flex;
		flex-direction: column;
		gap: var(--ui-layout-gap, 16px);
		min-width: 0;
	}
	.ui-section__chevron {
		color: var(--ui-muted);
		transition: transform var(--ui-motion-duration, 140ms);
	}
	.ui-section [aria-expanded='true'] .ui-section__chevron {
		transform: rotate(180deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.ui-section__chevron {
			transition: none;
		}
	}
</style>
