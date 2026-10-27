<script setup lang="ts">
	import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { Line } from 'vue-chartjs';
	import {
		Chart as ChartJS,
		LinearScale,
		PointElement,
		LineElement,
		Tooltip,
		Legend,
		type ChartData,
		type ChartOptions,
		type TooltipModel,
	} from 'chart.js';
	import type { StatusHistory, StatusHistoryPoint } from '../model/status-types';
	import { formatStatusPercent, formatStatusRate, formatStatusRateAxis } from '../model/statusFormatting';

	export type StatusMetric = 'cpu' | 'memory' | 'swap' | 'disk' | 'network';

	type TimedChartPoint = { x: number; y: number | null };

	ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);
	const props = withDefaults(
		defineProps<{
			history: StatusHistory;
			sampleTimestamp: number;
			metric?: StatusMetric;
			rangeMinutes?: number;

			scale?: number;
		}>(),
		{ metric: 'cpu', rangeMinutes: 5, scale: 1 },
	);
	const { t } = useI18n();
	const Y_AXIS_GUTTER_PX = 2;
	const CHART_RIGHT_PAD_PX = 4;
	const tooltip = shallowRef<{
		time: string;
		entries: Array<{ label: string; value: string }>;
		left: string;
		top: string;
	} | null>(null);
	watch(
		() => [props.scale, props.metric, props.rangeMinutes],
		() => {
			tooltip.value = null;
		},
		{ flush: 'post' },
	);
	onDeactivated(() => {
		tooltip.value = null;
	});
	const rangeMs = computed(() => Math.max(1, props.rangeMinutes) * 60_000);
	const windowEnd = computed(() => props.sampleTimestamp);
	const windowStart = computed(() => windowEnd.value - rangeMs.value);
	const windowSpanMs = computed(() => Math.max(1, windowEnd.value - windowStart.value));

	const inRange = (points: readonly StatusHistoryPoint[]) =>
		points.filter((point) => point.time >= windowStart.value && point.time <= windowEnd.value);

	const percentageSeries = computed(() => {
		if (props.metric === 'cpu') {
			return inRange(props.history.cpu);
		}
		if (props.metric === 'memory') {
			return inRange(props.history.memory);
		}
		if (props.metric === 'swap') {
			return inRange(props.history.swap);
		}
		if (props.metric === 'disk') {
			return inRange(props.history.disk);
		}
		return [];
	});
	const networkRx = computed(() => inRange(props.history.networkRx));
	const networkTx = computed(() => inRange(props.history.networkTx));
	const visibleStartTime = computed(() => {
		if (props.metric !== 'network') return percentageSeries.value[0]?.time ?? 0;
		const rx = networkRx.value[0]?.time;
		const tx = networkTx.value[0]?.time;
		return rx === undefined ? (tx ?? 0) : tx === undefined ? rx : Math.min(rx, tx);
	});

	const singleLabel = computed(() => {
		if (props.metric === 'cpu') {
			return t('statusMonitor.cpuUsageLabel');
		}
		if (props.metric === 'memory') {
			return t('statusMonitor.memoryPercentLabel');
		}
		if (props.metric === 'swap') {
			return t('statusMonitor.swapPercentLabel');
		}
		return t('statusMonitor.diskPercentLabel');
	});

	const rawNetworkMax = computed(() =>
		Math.max(
			1,
			...inRange(props.history.networkRx).map((point) => point.value),
			...inRange(props.history.networkTx).map((point) => point.value),
		),
	);

	// Keep tick intervals in the same binary unit as their labels. Letting the
	// chart choose decimal byte intervals produces labels such as 4.8M/9.5M.
	const niceNetworkAxis = (rawBytes: number) => {
		const unit =
			rawBytes >= 1024 ** 3 ? 1024 ** 3 : rawBytes >= 1024 ** 2 ? 1024 ** 2 : rawBytes >= 1024 ? 1024 : 1;
		const roughStep = Math.max(rawBytes / unit / 4, Number.EPSILON);
		const magnitude = 10 ** Math.floor(Math.log10(roughStep));
		const fraction = roughStep / magnitude;
		const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
		const step = Math.max(1, niceFraction * magnitude * unit);
		return { max: Math.ceil(rawBytes / step) * step, step, unit };
	};

	const networkAxis = ref(niceNetworkAxis(1));
	const percentageAxisMax = computed(() => {
		const maximum = Math.max(0, ...percentageSeries.value.map((point) => point.value));
		const required = maximum * 1.15;
		return [10, 20, 25, 50, 75, 100].find((limit) => limit >= required) ?? 100;
	});

	const syncNetworkAxis = (force = false) => {
		const raw = rawNetworkMax.value;
		if (force || networkAxis.value.max <= 1 || raw > networkAxis.value.max || raw < networkAxis.value.max * 0.55) {
			networkAxis.value = niceNetworkAxis(raw);
		}
	};

	watch(rawNetworkMax, () => syncNetworkAxis(), { immediate: true });
	watch(
		() => props.rangeMinutes,
		() => syncNetworkAxis(true),
	);

	const chartTheme = ref({
		text: '#666666',
		grid: '#cccccc',
		surface: '#ffffff',
		border: '#cccccc',
		primary: '#a06cd5',
		download: '#28a745',
		upload: '#ffc107',
	});

	const readTheme = () => {
		const style = getComputedStyle(document.documentElement);

		const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;

		chartTheme.value = {
			text: value('--text-color-secondary', chartTheme.value.text),
			grid: value('--border-color', chartTheme.value.grid),
			surface: value('--app-bg-color', chartTheme.value.surface),
			border: value('--border-color', chartTheme.value.border),
			primary: value('--link-active-color', chartTheme.value.primary),
			download: '#10b981',
			upload: '#3b82f6',
		};
	};

	let themeObserver: MutationObserver | null = null;

	const handleViewportChange = () => {
		tooltip.value = null;
	};

	onMounted(() => {
		readTheme();
		themeObserver = new MutationObserver(readTheme);
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
	});
	onBeforeUnmount(() => {
		themeObserver?.disconnect();
		window.removeEventListener('resize', handleViewportChange);
		window.removeEventListener('scroll', handleViewportChange, true);
	});

	const pad2 = (value: number) => String(value).padStart(2, '0');

	const formatAxisTime = (time: number): string => {
		const date = new Date(time);
		const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
		return windowSpanMs.value <= 60_000 ? `${base}:${pad2(date.getSeconds())}` : base;
	};

	const toChartSeries = (history: readonly StatusHistoryPoint[]) => {
		// Infer cadence from the complete retained series, not the selected range.
		// A silent browser/transport pause can leave consecutive sequence numbers.
		const intervals: number[] = [];
		for (let index = 1; index < history.length; index += 1) {
			const previous = history[index - 1];
			const point = history[index];
			if (previous && point && point.sequence === previous.sequence + 1 && point.time > previous.time)
				intervals.push(point.time - previous.time);
		}
		intervals.sort((left, right) => left - right);
		// Lower median keeps a single long pause from defining the normal cadence.
		// Two normal intervals tolerate sampling jitter; this only breaks rendering.
		const cadence = intervals[Math.floor((intervals.length - 1) / 2)];
		const points = inRange(history);
		const result: TimedChartPoint[] = [];
		let previous: StatusHistoryPoint | undefined;
		for (const point of points) {
			// Missing metrics and a stopped/failed subscription are gaps, not a
			// measured transition between the last and next available values.
			if (
				previous &&
				(point.sequence !== previous.sequence + 1 ||
					point.time <= previous.time ||
					(cadence !== undefined && point.time - previous.time > cadence * 2))
			)
				result.push({ x: previous.time, y: null });
			result.push({ x: point.time, y: point.value });
			previous = point;
		}
		return {
			data: result,
			pointRadius: result.map((point, index) =>
				point.y !== null &&
				(index === 0 || result[index - 1]?.y === null) &&
				(index === result.length - 1 || result[index + 1]?.y === null)
					? 2
					: 0,
			),
		};
	};

	const showTooltip = ({ chart, tooltip: model }: { chart: ChartJS; tooltip: TooltipModel<'line'> }): void => {
		const sampleTime = model.dataPoints?.[0]?.parsed.x;
		if (!model.opacity || !model.dataPoints?.length || sampleTime == null) {
			tooltip.value = null;
			return;
		}
		const rect = chart.canvas.getBoundingClientRect();
		const date = new Date(sampleTime);
		const pointerX = rect.left + (model.caretX / chart.width) * rect.width;
		const pointerY = rect.top + (model.caretY / chart.height) * rect.height;
		tooltip.value = {
			time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
			entries: model.dataPoints
				.filter((point) => point.parsed.x === sampleTime)
				.map((point) => ({
					label: point.dataset.label ?? '',
					value:
						props.metric === 'network'
							? formatStatusRate(point.parsed.y ?? undefined)
							: (formatStatusPercent(point.parsed.y ?? undefined) ?? ''),
				})),
			left: `${Math.max(8, Math.min(pointerX + 12, window.innerWidth - 248))}px`,
			top: `${Math.max(8, Math.min(pointerY + 12, window.innerHeight - 46 - model.dataPoints.length * 24))}px`,
		};
	};

	const data = computed<ChartData<'line', TimedChartPoint[]>>(() => {
		if (props.metric === 'network') {
			return {
				datasets: [
					{
						label: t('statusMonitor.networkDownload'),
						...toChartSeries(props.history.networkRx),
						borderColor: chartTheme.value.download,
						backgroundColor: chartTheme.value.download,
						borderWidth: 2,
						pointHoverRadius: 3,
						cubicInterpolationMode: 'monotone',
					},
					{
						label: t('statusMonitor.networkUpload'),
						...toChartSeries(props.history.networkTx),
						borderColor: chartTheme.value.upload,
						backgroundColor: chartTheme.value.upload,
						borderWidth: 2,
						pointHoverRadius: 3,
						cubicInterpolationMode: 'monotone',
					},
				],
			};
		}
		return {
			datasets: [
				{
					label: singleLabel.value,
					...toChartSeries(props.history[props.metric]),
					borderColor: chartTheme.value.primary,
					backgroundColor: chartTheme.value.primary,
					borderWidth: 2,
					pointHoverRadius: 3,
					cubicInterpolationMode: 'monotone',
				},
			],
		};
	});

	const options = computed<ChartOptions<'line'>>(() => ({
		responsive: true,
		// Include the CSS zoom in the backing resolution so axis text is never upscaled.
		devicePixelRatio: Math.ceil((window.devicePixelRatio || 1) * Math.max(1, props.scale)),
		maintainAspectRatio: false,
		// Session history is already bounded; keep real sample times and values,
		// including both ends of a short history in a long selected window.
		parsing: false,
		animation: false,
		layout: {
			padding: { left: 0, right: CHART_RIGHT_PAD_PX },
		},
		interaction: { mode: 'nearest', axis: 'x', intersect: false },
		plugins: {
			legend: {
				display: false,
			},
			tooltip: {
				enabled: false,
				external: showTooltip,
			},
		},
		scales: {
			x: {
				alignToPixels: true,
				type: 'linear',
				min: windowStart.value,
				max: windowEnd.value,
				ticks: {
					color: chartTheme.value.text,
					maxTicksLimit: windowSpanMs.value <= 60_000 ? 3 : 4,
					font: { size: 8 },
					align: 'inner',

					callback: (value) => formatAxisTime(Number(value)),
				},
				grid: { display: false },
				border: { color: chartTheme.value.grid },
			},
			y:
				props.metric === 'network'
					? {
							alignToPixels: true,
							beginAtZero: true,
							min: 0,
							max: networkAxis.value.max,

							afterFit: (scale) => {
								scale.width = Y_AXIS_GUTTER_PX;
							},

							ticks: {
								color: chartTheme.value.text,
								font: { size: 8 },
								// The computed interval is at least one byte, including at idle.
								stepSize: networkAxis.value.step,
								maxTicksLimit: 6,
								mirror: true,
								padding: 3,
								z: 1,

								callback: (value) => formatStatusRateAxis(Number(value), networkAxis.value.unit),
							},
							grid: { color: chartTheme.value.grid, lineWidth: 0.5 },
							border: { color: chartTheme.value.grid },
						}
					: {
							alignToPixels: true,
							beginAtZero: true,
							min: 0,
							max: percentageAxisMax.value,

							afterFit: (scale) => {
								scale.width = Y_AXIS_GUTTER_PX;
							},

							ticks: {
								color: chartTheme.value.text,
								font: { size: 7 },
								maxTicksLimit: 6,
								stepSize:
									percentageAxisMax.value === 10
										? 2
										: percentageAxisMax.value === 75
											? 15
											: percentageAxisMax.value === 100
												? 20
												: percentageAxisMax.value <= 25
													? 5
													: 10,
								mirror: true,
								padding: 3,
								z: 1,

								callback: (value) => `${Number(value)}`,
							},
							grid: { color: chartTheme.value.grid, lineWidth: 0.5 },
							border: { color: chartTheme.value.grid },
						},
		},
	}));
</script>

<template>
	<div
		class="status-history-chart"
		:data-range-minutes="props.rangeMinutes"
		:data-window-start="windowStart"
		:data-window-end="windowEnd"
		:data-visible-start="visibleStartTime"
		@mouseleave="tooltip = null"
	>
		<Line :data="data" :options="options" />
	</div>
	<Teleport to="body">
		<div
			v-if="tooltip"
			role="tooltip"
			class="status-history-tooltip ui-glass-panel"
			:style="{ left: tooltip.left, top: tooltip.top }"
		>
			<strong>{{ tooltip.time }}</strong>
			<div v-for="entry in tooltip.entries" :key="entry.label">{{ entry.label }}: {{ entry.value }}</div>
		</div>
	</Teleport>
</template>

<style scoped>
	.status-history-tooltip {
		position: fixed;
		z-index: 1001;
		max-width: min(240px, calc(100vw - 16px));
		padding: 6px 10px;
		border-radius: 6px;
		color: var(--text-color);
		font-size: 12px;
		line-height: 24px;
		pointer-events: none;
	}

	.status-history-chart {
		min-width: 0;
		min-height: 0;
		height: 100%;
		flex: 1 1 auto;
		position: relative;
		overflow: hidden;
	}
</style>
