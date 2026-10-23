<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, type UiTone } from '@/foundation/ui';
	import { auditContextKey, auditEventVisual } from '../model/auditPresentation';
	import type { AuditEntry } from '../model/audit-types';

	const props = defineProps<{ log: AuditEntry }>();
	const { t, te, locale } = useI18n();

	const visual = computed(() => auditEventVisual(props.log.event));
	const scope = computed(() => {
		const key = auditContextKey(props.log);
		return key ? t(key) : null;
	});
	const action = computed(() => {
		if (props.log.event === 'HTTP_MUTATION' && scope.value) {
			return t('auditLog.scopedMutation', { context: scope.value });
		}
		if (props.log.event === 'HTTP_MUTATION_FAILED' && scope.value) {
			return t('auditLog.scopedMutationFailed', { context: scope.value });
		}
		const key = `auditLog.actions.${props.log.event}`;
		return te(key) ? t(key) : t('auditLog.unknownAction');
	});

	const date = computed(() => new Date(props.log.createdAt));
	const timeLabel = computed(() =>
		new Intl.DateTimeFormat(locale.value, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		}).format(date.value),
	);
	const dayLabel = computed(() =>
		new Intl.DateTimeFormat(locale.value, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(date.value),
	);
	const fullTimeLabel = computed(() => date.value.toLocaleString(locale.value));

	const httpStatus = computed(() => {
		const code = props.log.statusCode;
		if (code === null) return null;
		if (code >= 200 && code < 300) {
			return { code, tone: 'success' as UiTone, label: t('auditLog.httpStatus.success') };
		}
		if (code >= 300 && code < 400) {
			return { code, tone: 'primary' as UiTone, label: t('auditLog.httpStatus.redirect') };
		}
		if (code === 401 || code === 403) {
			return { code, tone: 'warning' as UiTone, label: t('auditLog.httpStatus.unauthorized') };
		}
		if (code >= 400) return { code, tone: 'danger' as UiTone, label: t('auditLog.httpStatus.failed') };
		return { code, tone: 'neutral' as UiTone, label: t('auditLog.httpStatus.recorded') };
	});
</script>

<template>
	<article
		class="audit-row"
		:data-audit-id="log.id"
		:data-kind="visual.kind"
		:data-status="httpStatus?.tone ?? 'none'"
	>
		<time class="audit-row__time" :datetime="date.toISOString()" :title="fullTimeLabel">
			<strong>{{ timeLabel }}</strong>
			<span>{{ dayLabel }}</span>
		</time>

		<div class="audit-row__track" aria-hidden="true">
			<span class="audit-row__node"><i :class="visual.icon"></i></span>
		</div>

		<div class="audit-row__content">
			<div class="audit-row__heading">
				<strong class="audit-row__action">{{ action }}</strong>
				<UiBadge v-if="scope" class="audit-row__scope" appearance="ghost" density="compact">{{
					scope
				}}</UiBadge>
				<UiBadge
					v-if="httpStatus"
					class="audit-row__status"
					appearance="ghost"
					density="compact"
					:tone="httpStatus.tone"
					:title="`HTTP ${httpStatus.code} · ${httpStatus.label}`"
				>
					<strong>{{ httpStatus.code }}</strong>
					<span>{{ httpStatus.label }}</span>
				</UiBadge>
				<span class="audit-row__mobile-time">
					<i class="fa-regular fa-clock" aria-hidden="true"></i>
					{{ dayLabel }} · {{ timeLabel }}
				</span>
			</div>

			<div v-if="log.userId !== null || log.sourceIp || log.subjectId" class="audit-row__meta">
				<span v-if="log.userId !== null" class="audit-row__meta-item">
					<i class="fa-regular fa-user" aria-hidden="true"></i>
					{{ t('auditLog.fields.userId') }} #{{ log.userId }}
				</span>
				<span v-if="log.sourceIp" class="audit-row__meta-item">
					<i class="fa-solid fa-location-dot" aria-hidden="true"></i>
					{{ log.sourceIp }}
				</span>
				<span v-if="log.subjectId" class="audit-row__meta-item audit-row__meta-item--subject">
					<i class="fa-solid fa-tag" aria-hidden="true"></i>
					<span class="audit-row__meta-label">{{ t('auditLog.fields.subjectId') }}</span>
					<code>{{ log.subjectId }}</code>
				</span>
			</div>

			<div v-if="log.route" class="audit-row__route">
				<i class="fa-solid fa-code" aria-hidden="true"></i>
				<code>{{ log.route }}</code>
			</div>
		</div>
	</article>
</template>

<style scoped>
	.audit-row {
		--audit-kind-color: var(--link-active-color);
		display: grid;
		grid-template-columns: 94px 34px minmax(0, 1fr);
		gap: 10px;
		align-items: stretch;
		min-width: 0;
		padding: 10px 14px 10px 2px;
		border-radius: 12px;
		transition: background-color 140ms ease;
	}

	.audit-row[data-kind='connection'] {
		--audit-kind-color: #5f7cfa;
	}

	.audit-row[data-kind='agent'] {
		--audit-kind-color: #d8679b;
	}

	.audit-row[data-kind='configuration'] {
		--audit-kind-color: #d99a43;
	}

	.audit-row:hover {
		background: color-mix(in srgb, var(--text-color) 3.2%, transparent);
	}

	.audit-row__time {
		display: flex;
		min-width: 0;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		padding-top: 5px;
		color: var(--text-color-secondary);
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}

	.audit-row__time strong {
		color: var(--text-color);
		font-size: 12px;
		font-weight: 670;
	}

	.audit-row__time span {
		font-size: 9px;
	}

	.audit-row__track {
		position: relative;
		display: flex;
		justify-content: center;
		padding-top: 2px;
	}

	.audit-row__track::before {
		position: absolute;
		top: -10px;
		bottom: -10px;
		left: 50%;
		width: 1px;
		content: '';
		background: color-mix(in srgb, var(--border-color) 62%, transparent);
		transform: translateX(-50%);
	}

	.audit-row__node {
		position: relative;
		z-index: 1;
		display: grid;
		width: 30px;
		height: 30px;
		place-items: center;
		border: 1px solid color-mix(in srgb, var(--audit-kind-color) 22%, transparent);
		border-radius: 50%;
		background: color-mix(in srgb, var(--audit-kind-color) 10%, var(--card-bg-color));
		color: var(--audit-kind-color);
		font-size: 10px;
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--app-bg-color) 78%, transparent);
		transition:
			background-color 140ms ease,
			transform 140ms ease;
	}

	.audit-row:hover .audit-row__node {
		background: color-mix(in srgb, var(--audit-kind-color) 15%, var(--card-bg-color));
		transform: scale(1.04);
	}

	.audit-row__content {
		min-width: 0;
		padding: 1px 0 2px;
	}

	.audit-row__heading {
		display: flex;
		min-width: 0;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px 7px;
	}

	.audit-row__action {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 13px;
		font-weight: 660;
		line-height: 1.35;
		letter-spacing: -0.012em;
	}

	.audit-row__scope {
		background: color-mix(in srgb, var(--audit-kind-color) 8%, transparent);
		color: color-mix(in srgb, var(--audit-kind-color) 76%, var(--text-color));
	}

	.audit-row__status {
		margin-left: auto;
	}

	.audit-row__status strong {
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.audit-row__meta {
		display: flex;
		min-width: 0;
		align-items: center;
		flex-wrap: wrap;
		gap: 3px 11px;
		margin-top: 5px;
		color: var(--text-color-secondary);
		font-size: 10px;
		line-height: 1.45;
	}

	.audit-row__meta-item {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 5px;
		overflow-wrap: anywhere;
	}

	.audit-row__meta-item i {
		flex: 0 0 auto;
		font-size: 8.5px;
		opacity: 0.78;
	}

	.audit-row__meta-item code,
	.audit-row__route code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
	}

	.audit-row__meta-label {
		flex: 0 0 auto;
		white-space: nowrap;
	}

	.audit-row__meta-item--subject {
		max-width: 100%;
		flex-wrap: nowrap;
	}

	.audit-row__meta-item--subject code {
		min-width: 0;
		flex: 0 1 auto;
		font-size: 9.5px;
		overflow-wrap: anywhere;
		white-space: normal;
	}

	.audit-row__route {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		gap: 6px;
		margin-top: 5px;
		color: var(--ui-text-muted);
		font-size: 9.5px;
		line-height: 1.45;
	}

	.audit-row__route i {
		flex: 0 0 auto;
		margin-top: 2px;
		font-size: 8.5px;
	}

	.audit-row__route code {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.audit-row__mobile-time {
		display: none;
		align-items: center;
		gap: 5px;
		color: var(--ui-text-muted);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.audit-row {
			grid-template-columns: 30px minmax(0, 1fr);
			gap: 9px;
			padding: 12px 8px 12px 2px;
		}

		.audit-row__time {
			display: none;
		}

		.audit-row__track {
			grid-column: 1;
			grid-row: 1;
			padding-top: 1px;
		}

		.audit-row__track::before {
			top: -12px;
			bottom: -12px;
		}

		.audit-row__content {
			grid-column: 2;
			grid-row: 1;
		}

		.audit-row__mobile-time {
			display: inline-flex;
			width: 100%;
			margin-top: 1px;
		}

		.audit-row__status {
			margin-left: 0;
		}

		.audit-row__meta {
			font-size: 10.5px;
		}

		.audit-row__meta-item--subject {
			width: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.audit-row,
		.audit-row__node {
			transition: none;
		}
	}
</style>
