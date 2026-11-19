<template>
	<ul class="ui-list" data-ui="list">
		<slot />
	</ul>
</template>
<style scoped>
	.ui-list {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ui-list-border, var(--ui-border));
		border-radius: var(--ui-list-radius, 14px);
		background: var(--ui-list-background, var(--ui-surface));
		container-type: inline-size;
	}
	.ui-list:empty {
		display: none;
	}
</style>
