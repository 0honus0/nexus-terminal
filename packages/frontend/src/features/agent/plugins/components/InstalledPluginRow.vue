<script setup lang="ts">
	import { UiBadge, type UiTone } from '@/foundation/ui';
	withDefaults(
		defineProps<{ name: string; version: string; icon?: string; statusLabel?: string; statusTone?: UiTone }>(),
		{ icon: 'fa-solid fa-puzzle-piece', statusLabel: '', statusTone: 'neutral' },
	);
</script>
<template>
	<article
		class="installed-plugin-row min-w-0 rounded-xl border border-border/60 bg-card/20 px-3 py-2.5"
		:aria-label="name"
	>
		<div class="installed-plugin-row__main">
			<div class="installed-plugin-row__identity">
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs text-primary"
				>
					<i :class="icon" aria-hidden="true"></i>
				</div>
				<div class="installed-plugin-row__labels">
					<h4 class="ui-catalog-name max-w-full truncate text-xs font-semibold" :title="name">{{ name }}</h4>
					<span class="font-mono text-[11px] text-text-secondary">v{{ version }}</span>
					<UiBadge v-if="statusLabel" class="ui-catalog-status-badge" :tone="statusTone" density="compact">{{
						statusLabel
					}}</UiBadge>
				</div>
			</div>
			<div class="installed-plugin-row__actions"><slot name="actions" /></div>
		</div>
		<slot />
	</article>
</template>
<style scoped>
	.installed-plugin-row {
		container: installed-plugin-row / inline-size;
	}
	.installed-plugin-row__main {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.installed-plugin-row__identity {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.installed-plugin-row__labels {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		min-width: 0;
	}
	.installed-plugin-row__actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.installed-plugin-row__actions :deep([data-installed-action-label]) {
		display: none;
	}
	@container installed-plugin-row (width < 36rem) {
		.installed-plugin-row__actions :deep([data-ui='button']) {
			width: var(--ui-control-height);
			--ui-control-padding-inline: 0px;
		}
	}
	@container installed-plugin-row (min-width:36rem) {
		.installed-plugin-row__actions :deep([data-installed-action-label]) {
			display: inline;
		}
	}
</style>
