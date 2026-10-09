<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { AuditLogEntryDto } from '../model/audit';
	import { auditText } from '../model/auditPresentation';

	const props = defineProps<{ log: AuditLogEntryDto }>();
	const { t, te, locale } = useI18n();
	const action = computed(() =>
		te(`auditLog.actions.${props.log.actionType}`)
			? t(`auditLog.actions.${props.log.actionType}`)
			: props.log.actionType,
	);
	const raw = computed(() => {
		const value = props.log.details;
		if (value == null) return '';
		if (typeof value === 'object') {
			const record = value as Record<string, unknown>;
			if (record.parseError && 'raw' in record) return auditText(record.raw);
			return JSON.stringify(value, null, 2);
		}
		return String(value);
	});
</script>

<template>
	<article class="audit-row" :data-audit-id="log.id">
		<time :datetime="new Date(log.timestamp * 1000).toISOString()">{{
			new Date(log.timestamp * 1000).toLocaleString(locale)
		}}</time>
		<span class="audit-action">{{ action }}</span>
		<pre v-if="raw" class="audit-raw" tabindex="0" :aria-label="t('auditLog.table.details')">{{ raw }}</pre>
		<span v-else class="text-text-secondary">—</span>
	</article>
</template>

<style scoped>
	.audit-row {
		display: grid;
		grid-template-columns: 220px 220px minmax(0, 1fr);
		align-items: start;
		gap: 20px;
		padding: 16px 20px;
		border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card-bg-color) 82%, var(--app-bg-color));
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
			0 5px 14px -12px color-mix(in srgb, var(--text-color) 32%, transparent);
		transition:
			border-color 140ms ease,
			background-color 140ms ease;
		font-size: 13px;
	}
	.audit-row:hover {
		border-color: color-mix(in srgb, var(--border-color) 64%, var(--link-active-color));
		background: color-mix(in srgb, var(--card-bg-color) 90%, var(--app-bg-color));
	}
	.audit-row > time {
		align-self: center;
		text-align: center;
	}
	.audit-action {
		align-self: center;
		text-align: center;
		overflow-wrap: anywhere;
	}
	.audit-raw {
		min-width: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		border: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--header-bg-color) 50%, transparent);
		padding: 8px 12px;
		font-size: 12px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
		line-height: 1.6;
	}
	@media (max-width: 800px) {
		.audit-row {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: 10px 16px;
			padding: 16px;
		}
		.audit-raw {
			grid-column: 1 / -1;
		}
	}
</style>
