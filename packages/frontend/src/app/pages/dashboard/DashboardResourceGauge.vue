<script setup lang="ts">
	import { computed } from 'vue';

	const props = withDefaults(
		defineProps<{
			gradientId: string;
			label: string;
			value?: number;
			detail?: string;
			tone: 'cpu' | 'memory' | 'disk';
		}>(),
		{
			value: undefined,
			detail: undefined,
		},
	);

	const normalizedValue = computed(() => {
		if (props.value === undefined || !Number.isFinite(props.value)) return 0;
		return Math.min(100, Math.max(0, Math.round(props.value)));
	});
	const displayValue = computed(() =>
		props.value === undefined || !Number.isFinite(props.value) ? '—' : `${normalizedValue.value}%`,
	);
	const dashOffset = computed(() => 100 - normalizedValue.value);
</script>

<template>
	<div class="dashboard-gauge-block" :class="`dashboard-gauge-block--${tone}`">
		<div class="dashboard-gauge">
			<svg viewBox="0 0 64 64" aria-hidden="true">
				<defs>
					<linearGradient :id="gradientId" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
						<stop class="dashboard-gauge__gradient-start" offset="0" />
						<stop class="dashboard-gauge__gradient-end" offset="1" />
					</linearGradient>
				</defs>
				<circle class="dashboard-gauge__track" cx="32" cy="32" r="26" pathLength="100" />
				<circle
					class="dashboard-gauge__progress"
					cx="32"
					cy="32"
					r="26"
					pathLength="100"
					:stroke="`url(#${gradientId})`"
					:style="{ strokeDashoffset: dashOffset }"
				/>
			</svg>
			<span class="dashboard-gauge__value">{{ displayValue }}</span>
		</div>
		<span class="dashboard-gauge__label">{{ label }}</span>
		<span v-if="detail" class="dashboard-gauge__detail" :title="detail">{{ detail }}</span>
	</div>
</template>

<style scoped>
	.dashboard-gauge-block {
		--gauge-start: var(--link-color);
		--gauge-end: var(--link-active-color);
		display: flex;
		min-width: 0;
		flex: 1 1 0;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.dashboard-gauge-block--memory {
		--gauge-start: color-mix(in srgb, var(--color-success) 62%, #7ee2b8);
		--gauge-end: var(--color-success);
	}

	.dashboard-gauge-block--disk {
		--gauge-start: color-mix(in srgb, var(--color-warning) 58%, #ffe3a0);
		--gauge-end: var(--color-warning);
	}

	.dashboard-gauge {
		position: relative;
		display: grid;
		width: clamp(56px, 5.6vw, 64px);
		aspect-ratio: 1;
		place-items: center;
	}

	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		transform: rotate(-90deg);
	}

	.dashboard-gauge__track,
	.dashboard-gauge__progress {
		fill: none;
		stroke-width: 5.5;
	}

	.dashboard-gauge__track {
		stroke: color-mix(in srgb, var(--border-color) 48%, transparent);
	}

	.dashboard-gauge__progress {
		stroke-dasharray: 100;
		stroke-linecap: round;
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--gauge-end) 44%, transparent));
		transition: stroke-dashoffset 420ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.dashboard-gauge__gradient-start {
		stop-color: var(--gauge-start);
	}

	.dashboard-gauge__gradient-end {
		stop-color: var(--gauge-end);
	}

	.dashboard-gauge__value {
		position: relative;
		z-index: 1;
		font-size: 12px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}

	.dashboard-gauge__label {
		color: var(--text-color-secondary);
		font-size: 10px;
		font-weight: 600;
		white-space: nowrap;
	}

	.dashboard-gauge__detail {
		max-width: 100%;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 9.5px;
		font-variant-numeric: tabular-nums;
		line-height: 1.25;
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.dashboard-gauge__progress {
			transition: none;
		}
	}
</style>
