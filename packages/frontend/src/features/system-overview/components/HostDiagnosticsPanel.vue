<script setup lang="ts">
	import { computed, onMounted, ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiInlineLoading, UiSettingsGroup, type UiTone } from '@/foundation/ui';
	import { useSettingsReloadSource, useFeedbackMessage } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { getHostDiagnostics } from '../api/diagnostics-api';
	import type { HostDiagnostics } from '../model/diagnostic-types';

	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t, locale } = useI18n();
	const diagnostics = shallowRef<HostDiagnostics | null>(null);
	const busy = ref(false);
	const failed = ref(false);
	let failureCause: unknown;
	useFeedbackMessage(
		() => (failed.value ? t('systemOverview.diagnostics.failed') : ''),
		undefined,
		() => failureCause,
	);
	const view = useAuthenticatedViewScope({
		available: () => props.active,

		onRevoke: () => {
			diagnostics.value = null;
			busy.value = false;
			failed.value = false;
		},
	});

	async function refresh(): Promise<void> {
		const signal = view.capture();
		if (signal.aborted || busy.value) {
			return;
		}
		busy.value = true;
		failed.value = false;
		try {
			const value = await getHostDiagnostics(signal);
			if (view.isCurrent(signal)) {
				diagnostics.value = value;
			}
		} catch (cause) {
			if (view.isCurrent(signal)) {
				failureCause = cause;
				failed.value = true;
			}
		} finally {
			if (view.isCurrent(signal)) {
				busy.value = false;
			}
		}
	}

	useSettingsReloadSource({
		id: 'system-host-diagnostics',

		pending: () => failed.value && !busy.value,

		reload: refresh,
	});

	onMounted(() => void refresh());
	watch(
		() => props.active,
		(active) => {
			if (active) {
				void refresh();
			}
		},
	);

	const metrics = computed(() => {
		const value = diagnostics.value;
		if (!value) return [];
		return [
			{
				key: 'runtime',
				icon: 'fa-solid fa-code',
				label: t('systemOverview.diagnostics.runtime'),
				value: value.process.runtimeVersion,
			},
			{
				key: 'uptime',
				icon: 'fa-solid fa-clock',
				label: t('systemOverview.diagnostics.uptime'),
				value: `${new Intl.NumberFormat(locale.value).format(value.process.uptimeSeconds)} s`,
			},
			{
				key: 'resident',
				icon: 'fa-solid fa-memory',
				label: t('systemOverview.diagnostics.resident'),
				value: `${new Intl.NumberFormat(locale.value).format(
					Math.round(value.process.residentBytes / 1024 / 1024),
				)} MiB`,
			},
			{
				key: 'heap',
				icon: 'fa-solid fa-layer-group',
				label: t('systemOverview.diagnostics.heap'),
				value: `${new Intl.NumberFormat(locale.value).format(
					Math.round(value.process.heapUsedBytes / 1024 / 1024),
				)} MiB`,
			},
			{
				key: 'database',
				icon: 'fa-solid fa-database',
				label: t('systemOverview.diagnostics.database'),
				value: value.database.available
					? String(value.database.schemaVersion ?? t('systemOverview.diagnostics.unavailable'))
					: t('systemOverview.diagnostics.unavailable'),
			},
			{
				key: 'collectedAt',
				icon: 'fa-solid fa-rotate',
				label: t('systemOverview.diagnostics.collectedAt'),
				value: new Date(value.collectedAt).toLocaleString(locale.value),
			},
		];
	});

	function formatBytes(value: number): string {
		const divisor = value >= 1024 * 1024 ? 1024 * 1024 : value >= 1024 ? 1024 : 1;
		const unit = divisor === 1024 * 1024 ? 'MiB' : divisor === 1024 ? 'KiB' : 'B';
		return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }).format(value / divisor)} ${unit}`;
	}

	const memoryMetrics = computed(() => {
		const value = diagnostics.value;
		if (!value) return [];

		const seconds = (value: number): string =>
			`${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 3 }).format(value)} s`;

		return [
			{ label: t('systemOverview.diagnostics.heapTotal'), value: formatBytes(value.process.heapTotalBytes) },
			{ label: t('systemOverview.diagnostics.external'), value: formatBytes(value.process.externalBytes) },
			{ label: t('systemOverview.diagnostics.arrayBuffers'), value: formatBytes(value.process.arrayBufferBytes) },
			{ label: t('systemOverview.diagnostics.cpuUser'), value: seconds(value.process.cpuUserSeconds) },
			{ label: t('systemOverview.diagnostics.cpuSystem'), value: seconds(value.process.cpuSystemSeconds) },
			{
				label: t('systemOverview.diagnostics.gcCount'),
				value: new Intl.NumberFormat(locale.value).format(value.process.gcCount),
			},
			{ label: t('systemOverview.diagnostics.gcDuration'), value: seconds(value.process.gcDurationSeconds) },
		];
	});

	const modules = computed(
		() =>
			diagnostics.value?.modules.map((module) => ({
				id: module.id,
				name: t(`systemOverview.diagnostics.modules.${module.id}`),
				icon: moduleIcons[module.id],
				status: t(`systemOverview.diagnostics.statuses.${module.status}`),
				statusTone: moduleTone(module.status),
				countsOnly: module.status === 'available' && !module.metrics.some((metric) => metric.unit === 'bytes'),
				wide: module.metrics.length > 4,
				metrics: module.metrics.map((metric) => ({
					name: metric.name,
					label: t(`systemOverview.diagnostics.resources.${metric.name}`),
					value:
						metric.unit === 'bytes'
							? formatBytes(metric.value)
							: new Intl.NumberFormat(locale.value).format(metric.value),
				})),
			})) ?? [],
	);

	type DiagnosticModule = HostDiagnostics['modules'][number];

	const moduleIcons: Record<DiagnosticModule['id'], string> = {
		access: 'fa-solid fa-key',
		agent: 'fa-solid fa-wand-magic-sparkles',
		operations: 'fa-solid fa-bell',
		preferences: 'fa-solid fa-sliders',
		remote: 'fa-solid fa-terminal',
		system: 'fa-solid fa-gauge-high',
		targets: 'fa-solid fa-server',
		storage: 'fa-solid fa-database',
	};

	function moduleTone(status: DiagnosticModule['status']): UiTone {
		if (status === 'available') return 'success';
		if (status === 'unavailable') return 'danger';
		return 'warning';
	}
</script>

<template>
	<UiSettingsGroup
		:title="t('systemOverview.diagnostics.title')"
		icon="fa-solid fa-gauge-high"
		tone="info"
		data-host-diagnostics
	>
		<template #actions>
			<UiInlineLoading
				v-if="busy && !diagnostics"
				class="host-diagnostics__status"
				:label="t('common.loading')"
			/>
			<UiBadge v-else-if="failed" tone="danger" density="compact">
				{{ t('systemOverview.diagnostics.failedShort') }}
			</UiBadge>
			<UiBadge v-else-if="diagnostics" tone="success" density="compact">
				<span class="host-diagnostics__status-dot" aria-hidden="true"></span>
				{{ t('systemOverview.diagnostics.ready') }}
			</UiBadge>
		</template>

		<dl v-if="metrics.length" class="host-diagnostics__grid">
			<div v-for="metric in metrics" :key="metric.key" class="host-diagnostics__metric">
				<span class="host-diagnostics__icon" aria-hidden="true">
					<i :class="metric.icon"></i>
				</span>
				<div class="host-diagnostics__metric-copy">
					<dt>{{ metric.label }}</dt>
					<dd>{{ metric.value }}</dd>
				</div>
			</div>
		</dl>
		<details v-if="diagnostics" class="host-diagnostics__resources" data-host-resource-diagnostics>
			<summary class="host-diagnostics__resources-summary">
				<span class="host-diagnostics__resources-icon" aria-hidden="true">
					<i class="fa-solid fa-microchip"></i>
				</span>
				<span class="host-diagnostics__resources-heading">
					<span class="host-diagnostics__resources-title">
						{{ t('systemOverview.diagnostics.resourcesTitle') }}
					</span>
					<span class="host-diagnostics__resources-meta">
						{{ t('systemOverview.diagnostics.moduleCount', { count: modules.length }) }}
					</span>
				</span>
				<i class="host-diagnostics__resources-chevron fa-solid fa-chevron-down" aria-hidden="true"></i>
			</summary>
			<div class="host-diagnostics__resources-body">
				<details class="host-diagnostics__measurement-note">
					<summary>
						<span>
							<i class="fa-solid fa-circle-info" aria-hidden="true"></i>
							{{ t('systemOverview.diagnostics.memoryNoteTitle') }}
						</span>
						<i
							class="host-diagnostics__measurement-chevron fa-solid fa-chevron-down"
							aria-hidden="true"
						></i>
					</summary>
					<p class="host-diagnostics__note">{{ t('systemOverview.diagnostics.memoryNote') }}</p>
				</details>

				<section class="host-diagnostics__process-resources">
					<header class="host-diagnostics__section-heading">
						<h4>{{ t('systemOverview.diagnostics.memorySectionTitle') }}</h4>
					</header>
					<dl class="host-diagnostics__memory-grid">
						<div
							v-for="metric in memoryMetrics"
							:key="metric.label"
							class="host-diagnostics__memory-metric"
						>
							<dt>{{ metric.label }}</dt>
							<dd>{{ metric.value }}</dd>
						</div>
					</dl>
				</section>

				<section class="host-diagnostics__module-section">
					<header class="host-diagnostics__section-heading">
						<h4>{{ t('systemOverview.diagnostics.modulesSectionTitle') }}</h4>
					</header>
					<div class="host-diagnostics__modules-grid">
						<section
							v-for="module in modules"
							:key="module.id"
							:data-diagnostic-module="module.id"
							class="host-diagnostics__module"
							:class="{ 'host-diagnostics__module--wide': module.wide }"
						>
							<header class="host-diagnostics__module-header">
								<span class="host-diagnostics__module-icon" aria-hidden="true">
									<i :class="module.icon"></i>
								</span>
								<h5>{{ module.name }}</h5>
								<span class="host-diagnostics__module-badges">
									<UiBadge
										v-if="module.countsOnly"
										tone="neutral"
										appearance="ghost"
										density="compact"
										:title="t('systemOverview.diagnostics.countsOnly')"
									>
										{{ t('systemOverview.diagnostics.countsOnlyShort') }}
									</UiBadge>
									<UiBadge :tone="module.statusTone" density="compact" dot>
										{{ module.status }}
									</UiBadge>
								</span>
							</header>
							<dl v-if="module.metrics.length" class="host-diagnostics__module-metrics">
								<div
									v-for="metric in module.metrics"
									:key="metric.name"
									class="host-diagnostics__module-metric"
								>
									<dt>{{ metric.label }}</dt>
									<dd>{{ metric.value }}</dd>
								</div>
							</dl>
						</section>
					</div>
				</section>
			</div>
		</details>
	</UiSettingsGroup>
</template>

<style scoped>
	.host-diagnostics__resources {
		margin-top: 12px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--border-color) 58%, transparent);
		border-radius: 14px;
		background: color-mix(in srgb, var(--header-bg-color) 22%, transparent);
	}

	.host-diagnostics__resources-summary {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		cursor: pointer;
		list-style: none;
		transition: background-color 0.16s ease;
	}

	.host-diagnostics__resources-summary::-webkit-details-marker,
	.host-diagnostics__measurement-note summary::-webkit-details-marker {
		display: none;
	}

	.host-diagnostics__resources-summary:hover {
		background: color-mix(in srgb, var(--text-color) 3.5%, transparent);
	}

	.host-diagnostics__resources-summary:focus-visible,
	.host-diagnostics__measurement-note summary:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--primary-color) 52%, transparent);
		outline-offset: -2px;
	}

	.host-diagnostics__resources-icon {
		display: grid;
		width: 30px;
		height: 30px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 9px;
		background: color-mix(in srgb, var(--primary-color) 12%, transparent);
		color: color-mix(in srgb, var(--primary-color) 82%, var(--text-color));
		font-size: 11px;
	}

	.host-diagnostics__resources-heading {
		display: grid;
		min-width: 0;
		flex: 1;
		gap: 2px;
	}

	.host-diagnostics__resources-title {
		font-size: 13px;
		font-weight: 650;
		line-height: 1.35;
	}

	.host-diagnostics__resources-meta {
		color: var(--text-color-secondary);
		font-size: 10.5px;
		line-height: 1.3;
	}

	.host-diagnostics__resources-chevron,
	.host-diagnostics__measurement-chevron {
		flex: 0 0 auto;
		color: var(--text-color-secondary);
		font-size: 9px;
		transition: transform 0.16s ease;
	}

	.host-diagnostics__resources[open] > .host-diagnostics__resources-summary .host-diagnostics__resources-chevron,
	.host-diagnostics__measurement-note[open] > summary .host-diagnostics__measurement-chevron {
		transform: rotate(180deg);
	}

	.host-diagnostics__resources-body {
		display: grid;
		gap: 18px;
		padding: 0 14px 14px;
	}

	.host-diagnostics__measurement-note {
		border-radius: 10px;
		background: color-mix(in srgb, var(--header-bg-color) 28%, transparent);
	}

	.host-diagnostics__measurement-note summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 11px;
		cursor: pointer;
		list-style: none;
		color: var(--text-color-secondary);
		font-size: 11px;
		line-height: 1.4;
	}

	.host-diagnostics__measurement-note summary span {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}

	.host-diagnostics__measurement-note summary i:first-child {
		color: color-mix(in srgb, var(--primary-color) 70%, var(--text-color-secondary));
	}

	.host-diagnostics__note {
		margin: 0;
		padding: 0 11px 11px;
		color: var(--text-color-secondary);
		font-size: 11px;
		line-height: 1.65;
	}

	.host-diagnostics__status {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--text-color-secondary);
		font-size: 11px;
	}

	.host-diagnostics__status-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--status-success-color);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-success-color) 12%, transparent);
	}

	.host-diagnostics__section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.host-diagnostics__section-heading h4 {
		color: var(--text-color-secondary);
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.04em;
		line-height: 1.4;
	}

	.host-diagnostics__memory-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--border-color) 44%, transparent);
		border-radius: 11px;
		background: color-mix(in srgb, var(--border-color) 44%, transparent);
	}

	.host-diagnostics__memory-metric {
		min-width: 0;
		padding: 10px 12px;
		background: color-mix(in srgb, var(--header-bg-color) 28%, var(--app-bg-color));
	}

	.host-diagnostics__memory-metric:last-child {
		grid-column: span 2;
	}

	.host-diagnostics__memory-metric dt,
	.host-diagnostics__module-metric dt {
		color: var(--text-color-secondary);
		font-size: 10px;
		line-height: 1.4;
	}

	.host-diagnostics__memory-metric dd,
	.host-diagnostics__module-metric dd {
		margin-top: 3px;
		overflow: hidden;
		color: var(--text-color);
		font-size: 12.5px;
		font-weight: 650;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.host-diagnostics__modules-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: start;
		gap: 10px;
	}

	.host-diagnostics__module {
		--module-accent: #7b8cf7;
		min-width: 0;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--border-color) 48%, transparent);
		border-radius: 12px;
		background: color-mix(in srgb, var(--header-bg-color) 20%, transparent);
	}

	.host-diagnostics__module[data-diagnostic-module='access'] {
		--module-accent: #8492ff;
	}

	.host-diagnostics__module[data-diagnostic-module='agent'] {
		--module-accent: #b488ff;
	}

	.host-diagnostics__module[data-diagnostic-module='operations'] {
		--module-accent: #e3b05c;
	}

	.host-diagnostics__module[data-diagnostic-module='preferences'] {
		--module-accent: #6fc9a7;
	}

	.host-diagnostics__module[data-diagnostic-module='remote'] {
		--module-accent: #6ca8f5;
	}

	.host-diagnostics__module[data-diagnostic-module='system'] {
		--module-accent: #71c8cf;
	}

	.host-diagnostics__module[data-diagnostic-module='targets'] {
		--module-accent: #e49a66;
	}

	.host-diagnostics__module[data-diagnostic-module='storage'] {
		--module-accent: #df8fbe;
	}

	.host-diagnostics__module--wide {
		grid-column: 1 / -1;
	}

	.host-diagnostics__module-header {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
	}

	.host-diagnostics__module-icon {
		display: grid;
		width: 26px;
		height: 26px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--module-accent) 13%, transparent);
		color: color-mix(in srgb, var(--module-accent) 78%, var(--text-color));
		font-size: 10px;
	}

	.host-diagnostics__module-header h5 {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		font-size: 12px;
		font-weight: 650;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.host-diagnostics__module-badges {
		display: flex;
		flex: 0 1 auto;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 4px;
	}

	.host-diagnostics__module-metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 16px;
		padding: 3px 12px 9px;
	}

	.host-diagnostics__module--wide .host-diagnostics__module-metrics {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.host-diagnostics__module-metric {
		min-width: 0;
		padding: 8px 0;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 24%, transparent);
	}

	.host-diagnostics__grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 9px;
	}

	.host-diagnostics__metric {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		gap: 10px;
		padding: 13px 14px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--header-bg-color) 32%, transparent);
	}

	.host-diagnostics__icon {
		display: grid;
		width: 28px;
		height: 28px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, #5f7cfa 10%, transparent);
		color: color-mix(in srgb, #5f7cfa 76%, var(--text-color));
		font-size: 10px;
	}

	.host-diagnostics__metric-copy {
		min-width: 0;
	}

	.host-diagnostics__metric dt {
		color: var(--text-color-secondary);
		font-size: 10.5px;
		line-height: 1.35;
	}

	.host-diagnostics__metric dd {
		margin-top: 3px;
		overflow: hidden;
		color: var(--text-color);
		font-size: 13px;
		font-weight: 650;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 1080px) {
		.host-diagnostics__grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 760px) {
		.host-diagnostics__resources-body {
			gap: 15px;
			padding: 0 10px 10px;
		}

		.host-diagnostics__resources-summary {
			padding: 10px 11px;
		}

		.host-diagnostics__memory-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.host-diagnostics__modules-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.host-diagnostics__module--wide {
			grid-column: auto;
		}

		.host-diagnostics__module--wide .host-diagnostics__module-metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.host-diagnostics__module-header {
			flex-wrap: wrap;
		}

		.host-diagnostics__module-header h5 {
			flex: 1 1 5rem;
		}

		.host-diagnostics__module-badges {
			margin-left: auto;
		}
	}

	@media (max-width: 560px) {
		.host-diagnostics__grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.host-diagnostics__metric {
			padding: 11px 12px;
		}

		.host-diagnostics__memory-metric {
			padding: 9px 10px;
		}
	}
</style>
