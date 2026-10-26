<script setup lang="ts">
	import { useSlots } from 'vue';

	const slots = useSlots();

	const props = withDefaults(
		defineProps<{
			title: string;
			description?: string;
			icon?: string;
			tone?: 'neutral' | 'primary' | 'info' | 'accent' | 'success' | 'warning';
			compact?: boolean;
		}>(),
		{
			description: undefined,
			icon: undefined,
			tone: 'neutral',
			compact: false,
		},
	);
</script>

<template>
	<section
		class="ui-settings-group ui-glass-panel"
		:data-tone="props.tone"
		:data-compact="props.compact || undefined"
		:data-body-empty="!slots.default || undefined"
	>
		<header v-if="props.title || slots.actions" class="ui-settings-group__head">
			<div v-if="props.icon" class="ui-settings-group__icon" aria-hidden="true">
				<i :class="props.icon"></i>
			</div>
			<div class="ui-settings-group__heading">
				<h3 class="ui-settings-group__title">{{ props.title }}</h3>
				<p v-if="props.description || slots.description" class="ui-settings-group__description">
					<slot name="description">{{ props.description }}</slot>
				</p>
			</div>
			<div v-if="slots.actions" class="ui-settings-group__actions">
				<slot name="actions"></slot>
			</div>
		</header>
		<div v-if="slots.default" class="ui-settings-group__body">
			<slot></slot>
		</div>
	</section>
</template>
