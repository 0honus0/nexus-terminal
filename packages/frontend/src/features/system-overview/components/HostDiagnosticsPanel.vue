<script setup lang="ts">
	import { computed, onMounted, ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiSettingsGroup, UiSpinner } from '@/foundation/ui';
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
</script>

<template>
	<UiSettingsGroup
		:title="t('systemOverview.diagnostics.title')"
		icon="fa-solid fa-gauge-high"
		tone="info"
		data-host-diagnostics
	>
		<template #actions>
			<span v-if="busy && !diagnostics" class="host-diagnostics__status">
				<UiSpinner density="compact" :label="t('common.loading')" />
				{{ t('common.loading') }}
			</span>
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
	</UiSettingsGroup>
</template>

<style scoped>
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

	@media (max-width: 560px) {
		.host-diagnostics__grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.host-diagnostics__metric {
			padding: 11px 12px;
		}
	}
</style>
