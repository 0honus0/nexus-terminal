<script setup lang="ts">
	withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
</script>

<template>
	<button type="button" data-ui="resize-handle" data-ui-gen="2" class="ui-resize-handle" :disabled="disabled">
		<svg class="ui-resize-handle__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path d="M13.5 5.5 5.5 13.5M13.5 9.5l-4 4M13.5 1.5l-12 12" />
		</svg>
	</button>
</template>
