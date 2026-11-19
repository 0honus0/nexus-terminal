<template>
	<div class="ui-toolbar" data-ui="toolbar">
		<div class="ui-toolbar__content"><slot /></div>
		<div v-if="$slots.actions" class="ui-toolbar__actions"><slot name="actions" /></div>
	</div>
</template>

<style scoped>
	.ui-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--ui-toolbar-gap, 10px);
		min-width: 0;
	}
	.ui-toolbar__content {
		flex: 1 1 var(--ui-toolbar-content-basis, 14rem);
		min-width: 0;
	}
	.ui-toolbar__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: inherit;
		margin-inline-start: auto;
	}
</style>
