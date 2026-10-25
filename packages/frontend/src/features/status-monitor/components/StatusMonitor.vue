<script setup lang="ts">
	import type { StatusMonitorSessionController } from '../model/status-types';
	import { computed, defineAsyncComponent, defineComponent, h, ref, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiInlineNotice, UiSpinner } from '@/foundation/ui';
	import { writeClipboardText } from '@/foundation/browser';
	import { useWheelScale } from '@/foundation/interaction';
	import { useFeedback } from '@/shared/feedback/public';
	import { useStatusMonitor } from '../composables/useStatusMonitor';
	import {
		formatStatusDiskPair,
		formatStatusMemoryPair,
		formatStatusPercent,
		formatStatusRate,
		formatStatusSwapPair,
	} from '../model/statusFormatting';

	const StatusCharts = defineAsyncComponent({
		loader: () => import('./StatusCharts.vue'),

		loadingComponent: UiSpinner,
		delay: 120,
	});

	type ResourceMetric = 'cpu' | 'memory' | 'swap' | 'disk';
	type StatusMetric = ResourceMetric | 'network';

	const props = withDefaults(
		defineProps<{
			session: StatusMonitorSessionController;
			active?: boolean;
			connected: boolean;
			connecting?: boolean;

			showIp?: boolean;
			host?: string;
			scale?: number;
		}>(),
		{ showIp: true, scale: 1, connecting: false, active: true },
	);
	const emit = defineEmits<{ 'update:scale': [scale: number] }>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const monitor = useStatusMonitor(props.session, () => props.active);
	const localScale = ref(props.scale);
	const scaleRoot = ref<HTMLElement | null>(null);
	const selectedMetric = ref<StatusMetric | null>(null);
	const historyRange = ref<1 | 5 | 10 | 30>(5);
	const ranges = [1, 5, 10, 30] as const;
	const hasVisibleData = computed(() => Boolean(monitor.current.value && !monitor.error.value));
	const awaitingSample = computed(() => props.connected && !monitor.current.value && !monitor.error.value);
	useWheelScale({
		target: () => scaleRoot.value,

		value: () => props.scale,

		scale: localScale,
		min: 0.65,
		max: 1.6,
		step: 0.1,
		precision: 2,
		thresholdPx: 72,

		onChange: (scale) => emit('update:scale', scale),
	});
	const scaleStyle = computed(() => {
		const scale = localScale.value;
		const inverse = 100 / scale;
		return {
			'--status-scale': scale,
			width: `${inverse}%`,
			height: `${inverse}%`,
			flex: '0 0 auto',
			transform: `scale(${scale})`,
			transformOrigin: 'top left',
		};
	});

	const copyHost = async () => {
		if (!props.host) {
			return;
		}
		try {
			await writeClipboardText(props.host);
			feedback.notifySuccess(t('common.copied'));
		} catch {
			feedback.notifyError(t('statusMonitor.copyIpError'));
		}
	};

	const icon = (paths: ReturnType<typeof h>[]) =>
		defineComponent({
			setup: () => () => h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, paths),
		});

	const stroke = {
		stroke: 'currentColor',
		'stroke-width': 1.65,
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
	};
	const CpuIcon = icon([
		h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2.4, ...stroke }),
		h('rect', { x: 9, y: 9, width: 6, height: 6, rx: 1.1, fill: 'currentColor', 'fill-opacity': 0.18, ...stroke }),
		h('path', {
			d: 'M9 3v2M12 3v2M15 3v2M9 19v2M12 19v2M15 19v2M3 9h2M3 12h2M3 15h2M19 9h2M19 12h2M19 15h2',
			...stroke,
		}),
	]);
	const MemoryIcon = icon([
		h('rect', { x: 3.5, y: 7, width: 17, height: 10, rx: 2, ...stroke }),
		h('path', { d: 'M7 10v4M10.5 10v4M14 10v4M17.5 10v4M6 17v2M9 17v2M12 17v2M15 17v2M18 17v2', ...stroke }),
	]);
	const SwapIcon = icon([
		h('rect', { x: 4, y: 4.5, width: 16, height: 6, rx: 1.8, ...stroke }),
		h('rect', { x: 4, y: 13.5, width: 16, height: 6, rx: 1.8, ...stroke }),
		h('path', { d: 'M8 8h7l-2-2M16 16H9l2 2', ...stroke }),
	]);
	const DiskIcon = icon([
		h('rect', { x: 4, y: 3.5, width: 16, height: 17, rx: 3, ...stroke }),
		h('circle', { cx: 12, cy: 10, r: 4, ...stroke }),
		h('circle', { cx: 12, cy: 10, r: 1.1, fill: 'currentColor' }),
		h('path', { d: 'M12 10l3-2M7 17h6M16.5 17h.1', ...stroke }),
	]);

	const normalizedPercent = (value?: number) => Math.round(Math.max(0, Math.min(100, Number(value) || 0)));

	const percent = (value?: number) => formatStatusPercent(value) ?? t('statusMonitor.notAvailable');

	const metricName = (key: ResourceMetric) => {
		const label =
			key === 'cpu'
				? t('statusMonitor.cpuLabel')
				: key === 'memory'
					? t('statusMonitor.memoryLabel')
					: key === 'swap'
						? t('statusMonitor.swapLabel')
						: t('statusMonitor.diskLabel');
		return label.replace(/[:：]\s*$/, '');
	};

	const memory = (used?: number, total?: number) =>
		formatStatusMemoryPair(used, total) ?? t('statusMonitor.notAvailable');

	const swap = (used?: number, total?: number) =>
		formatStatusSwapPair(used, total) ?? t('statusMonitor.notAvailable');

	const disk = (used?: number, total?: number) =>
		formatStatusDiskPair(used, total) ?? t('statusMonitor.notAvailable');

	const capacityParts = (detail: string) => {
		const match = detail.match(/^([\d.]+) \/ ([\d.]+) (MB|GB)$/);
		return match ? { used: match[1], total: match[2], unit: match[3] } : null;
	};

	const compactRate = (bytesPerSecond?: number): string => {
		if (bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) {
			return '0B/s';
		}
		const value = Math.max(0, bytesPerSecond);
		if (value < 1024) {
			return `${Math.round(value)}B/s`;
		}
		if (value < 1024 ** 2) {
			return `${(value / 1024).toFixed(1)}K/s`;
		}
		if (value < 1024 ** 3) {
			return `${(value / 1024 ** 2).toFixed(1)}M/s`;
		}
		return `${(value / 1024 ** 3).toFixed(1)}G/s`;
	};

	const metricContext = (metric: { capacity?: ReturnType<typeof capacityParts>; load?: string }): string => {
		if (metric.capacity) {
			return `${metric.capacity.used} / ${metric.capacity.total} ${metric.capacity.unit}`;
		}
		return metric.load ? `${t('statusMonitor.load')} ${metric.load}` : '';
	};

	const metricAriaLabel = (metric: {
		name: string;
		displayPercent: string;
		capacity?: ReturnType<typeof capacityParts>;
		load?: string;
	}): string => {
		const context = metricContext(metric);
		return context
			? `${metric.name} ${metric.displayPercent} ${context}`
			: `${metric.name} ${metric.displayPercent}`;
	};

	const metrics = computed<
		Array<{
			key: ResourceMetric;
			name: string;
			percent: number;
			displayPercent: string;
			detail: string;
			capacity?: ReturnType<typeof capacityParts>;
			load?: string;
			color: string;
			icon: Component;
		}>
	>(() => {
		const status = monitor.current.value;
		const firstLoadAverage = status?.loadAvg?.[0];
		const cpuLoad =
			firstLoadAverage === undefined ? '' : `${t('statusMonitor.load')} ${firstLoadAverage.toFixed(2)}`;
		const cpuDetail =
			cpuLoad ||
			(status?.cpuModel
				? status.cpuModel.length > 20
					? `${status.cpuModel.slice(0, 18)}...`
					: status.cpuModel.trim()
				: '');

		return [
			{
				key: 'cpu',
				name: metricName('cpu'),
				percent: normalizedPercent(status?.cpuPercent),
				displayPercent: percent(status?.cpuPercent),
				detail: cpuDetail,
				load:
					firstLoadAverage !== undefined && Number.isFinite(firstLoadAverage)
						? firstLoadAverage.toFixed(2)
						: undefined,
				color: '#3b82f6',
				icon: CpuIcon,
			},
			{
				key: 'memory',
				name: metricName('memory'),
				percent: normalizedPercent(status?.memPercent),
				displayPercent: percent(status?.memPercent),
				detail: memory(status?.memUsed, status?.memTotal),
				capacity: capacityParts(memory(status?.memUsed, status?.memTotal)),
				color: '#10b981',
				icon: MemoryIcon,
			},
			{
				key: 'swap',
				name: metricName('swap'),
				percent: normalizedPercent(status?.swapPercent),
				displayPercent: percent(status?.swapPercent),
				detail: swap(status?.swapUsed, status?.swapTotal),
				capacity: capacityParts(swap(status?.swapUsed, status?.swapTotal)),
				color: '#8b5cf6',
				icon: SwapIcon,
			},
			{
				key: 'disk',
				name: metricName('disk'),
				percent: normalizedPercent(status?.diskPercent),
				displayPercent: percent(status?.diskPercent),
				detail: disk(status?.diskUsed, status?.diskTotal),
				capacity: capacityParts(disk(status?.diskUsed, status?.diskTotal)),
				color: '#f59e0b',
				icon: DiskIcon,
			},
		];
	});

	const metricColors = {
		cpu: '#3b82f6',
		memory: '#10b981',
		swap: '#8b5cf6',
		disk: '#f59e0b',
		network: '#14b8a6',
	} as const;
	const selectedMetricColor = computed(() => metricColors[selectedMetric.value ?? 'cpu']);
	const selectedMetricTitle = computed(() => t(`statusMonitor.trend.${selectedMetric.value ?? 'cpu'}`));
	const selectedMetricValue = computed(() => {
		const status = monitor.current.value;
		if (!status || !selectedMetric.value || selectedMetric.value === 'network') {
			return '';
		}
		return selectedMetric.value === 'cpu'
			? percent(status.cpuPercent)
			: selectedMetric.value === 'memory'
				? percent(status.memPercent)
				: selectedMetric.value === 'swap'
					? percent(status.swapPercent)
					: percent(status.diskPercent);
	});

	const selectMetric = (metric: StatusMetric) => {
		selectedMetric.value = selectedMetric.value === metric ? null : metric;
	};
</script>

<template>
	<section ref="scaleRoot" :data-status-scale="localScale.toFixed(2)" class="status-monitor h-full min-h-0">
		<div
			v-if="props.connecting || awaitingSample"
			class="status-loading"
			role="status"
			:aria-busy="props.connecting || awaitingSample"
		>
			<div class="status-loading-panel">
				<header class="status-loading-head">
					<UiSpinner density="compact" />
					<span>{{ props.connecting ? t('statusMonitor.connecting') : t('statusMonitor.loading') }}</span>
				</header>
				<div class="status-loading-list" aria-hidden="true">
					<div v-for="index in 4" :key="index" class="status-loading-card">
						<span class="status-loading-icon"></span>
						<span class="status-loading-copy">
							<span class="status-loading-line status-loading-line--title"></span>
							<span class="status-loading-line status-loading-line--detail"></span>
						</span>
						<span class="status-loading-reading"></span>
						<span class="status-loading-track"></span>
					</div>
					<div class="status-loading-card status-loading-card--network">
						<span class="status-loading-icon"></span>
						<span class="status-loading-copy">
							<span class="status-loading-line status-loading-line--title"></span>
						</span>
						<span class="status-loading-interface"></span>
						<span class="status-loading-traffic">
							<i></i>
							<i></i>
						</span>
					</div>
				</div>
			</div>
		</div>
		<div
			v-else-if="props.connected"
			:style="scaleStyle"
			:data-status-scale="localScale.toFixed(2)"
			class="status-surface"
			:class="{ 'has-history': Boolean(selectedMetric), 'status-has-data': hasVisibleData }"
		>
			<div v-if="monitor.error.value" class="empty-state">
				<UiInlineNotice class="status-error-notice" tone="danger" compact>
					{{ t('statusMonitor.failures.' + monitor.error.value) }}
				</UiInlineNotice>
			</div>
			<section v-else-if="monitor.current.value" class="monitor-panel">
				<header class="monitor-header">
					<strong>{{ t('statusMonitor.title') }}</strong>
					<button
						v-if="showIp && host"
						type="button"
						class="live-state host-button status-touch-target"
						:title="host"
						@click="copyHost"
					>
						<i class="status-dot"></i>
						<span class="host-name">{{ host }}</span>
						<i class="fas fa-copy host-copy" aria-hidden="true"></i>
					</button>
					<span v-else class="live-state"
						><i class="status-dot"></i><span class="live-label">{{ t('statusMonitor.online') }}</span></span
					>
				</header>

				<div class="monitor-content" :class="{ 'has-history': Boolean(selectedMetric) }">
					<div class="metric-list">
						<button
							v-for="metric in metrics"
							:key="metric.key"
							type="button"
							class="metric-row"
							:class="{
								selected: selectedMetric === metric.key,
								warning: metric.percent >= 65 && metric.percent < 90,
								critical: metric.percent >= 90,
							}"
							:style="{ '--metric-accent': metric.color, '--metric-value': `${metric.percent}%` }"
							:aria-label="metricAriaLabel(metric)"
							:aria-pressed="selectedMetric === metric.key"
							:title="metricAriaLabel(metric)"
							@click="selectMetric(metric.key)"
						>
							<span class="metric-icon"><component :is="metric.icon" /></span>
							<span class="metric-body">
								<span class="metric-topline">
									<span class="metric-name">{{ metric.name }}</span>
									<span v-if="metric.capacity" class="metric-value">
										<b>{{ metric.capacity.used }}</b>
										<span>/ {{ metric.capacity.total }} {{ metric.capacity.unit }}</span>
									</span>
									<span v-else-if="metric.load" class="metric-value">
										<b>{{ metric.load }}</b
										><span>{{ t('statusMonitor.load') }}</span>
									</span>
									<span class="metric-reading">{{ metric.displayPercent }}</span>
								</span>
								<span
									class="metric-track"
									:class="{ 'is-low': metric.percent < 24 }"
									aria-hidden="true"
								>
									<i :style="{ width: `${metric.percent}%` }"></i>
									<span class="metric-track-label">{{ metric.displayPercent }}</span>
								</span>
							</span>
						</button>

						<button
							type="button"
							class="metric-row network-row"
							:class="{ selected: selectedMetric === 'network' }"
							:style="{ '--metric-accent': metricColors.network }"
							:aria-label="`${t('statusMonitor.networkLabel')} ↓ ${formatStatusRate(monitor.current.value.netRxRate)} ↑ ${formatStatusRate(monitor.current.value.netTxRate)}`"
							:aria-pressed="selectedMetric === 'network'"
							:title="`${t('statusMonitor.networkLabel')} ↓ ${formatStatusRate(monitor.current.value.netRxRate)} ↑ ${formatStatusRate(monitor.current.value.netTxRate)}`"
							@click="selectMetric('network')"
						>
							<span class="metric-icon"><i class="fas fa-network-wired" aria-hidden="true"></i></span>
							<span class="metric-body">
								<span class="metric-topline">
									<span class="metric-name">{{ t('statusMonitor.networkLabel') }}</span>
									<span v-if="monitor.current.value.netInterface" class="network-interface">{{
										monitor.current.value.netInterface
									}}</span>
								</span>
								<span class="network-reading">
									<span class="rate rate-down">
										<i class="fas fa-arrow-down" aria-hidden="true"></i>
										<b>{{ compactRate(monitor.current.value.netRxRate) }}</b>
									</span>
									<span class="rate rate-up">
										<i class="fas fa-arrow-up" aria-hidden="true"></i>
										<b>{{ compactRate(monitor.current.value.netTxRate) }}</b>
									</span>
								</span>
							</span>
						</button>
					</div>

					<section
						v-if="selectedMetric"
						class="history-card"
						:style="{ '--history-accent': selectedMetricColor }"
					>
						<header class="history-header">
							<div class="history-heading">
								<strong>{{ selectedMetricTitle }}</strong>
								<span v-if="selectedMetricValue" class="history-current">{{
									selectedMetricValue
								}}</span>
								<button
									type="button"
									class="history-close"
									:aria-label="t('statusMonitor.closeTrend')"
									@click="selectedMetric = null"
								>
									<i class="fas fa-times" aria-hidden="true"></i>
								</button>
							</div>
							<div class="range-tabs" role="group" :aria-label="t('statusMonitor.historyRange')">
								<button
									v-for="range in ranges"
									:key="range"
									type="button"
									:class="{ active: historyRange === range }"
									:aria-pressed="historyRange === range"
									@click="historyRange = range"
								>
									{{ t('statusMonitor.minutes', { count: range }) }}
								</button>
							</div>
							<div v-if="selectedMetric === 'network'" class="network-legend">
								<span
									><i class="legend-download" aria-hidden="true"></i>↓
									{{ compactRate(monitor.current.value.netRxRate) }}</span
								>
								<span
									><i class="legend-upload" aria-hidden="true"></i>↑
									{{ compactRate(monitor.current.value.netTxRate) }}</span
								>
							</div>
						</header>
						<StatusCharts
							:history="monitor.history.value"
							:metric="selectedMetric"
							:range-minutes="historyRange"
							:scale="localScale"
						/>
					</section>
				</div>
			</section>
		</div>
	</section>
</template>

<style scoped src="./StatusMonitor.css"></style>
