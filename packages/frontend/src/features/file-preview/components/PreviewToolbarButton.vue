<script setup lang="ts">
	import { UiButton } from '@/foundation/ui';
</script>

<template>
	<UiButton appearance="soft" density="default" icon-only class="preview-toolbar-button">
		<slot />
	</UiButton>
</template>

<style scoped>
	.preview-toolbar-button {
		--ui-control-height: var(--preview-toolbar-action-size, 32px);
		flex: none;
	}
</style>
