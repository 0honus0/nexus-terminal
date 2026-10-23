<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, type UiTone } from '@/foundation/ui';
	import type { NotificationDelivery } from '@/features/notifications/public';
	import { auditEventContextKey, auditEventVisual } from '../model/auditPresentation';

	const props = defineProps<{ delivery: NotificationDelivery }>();
	const { t, te, locale } = useI18n();

	const eventLabel = computed(() =>
		te(`auditLog.actions.${props.delivery.event}`)
			? t(`auditLog.actions.${props.delivery.event}`)
			: t('auditLog.unknownAction'),
	);
	const visual = computed(() => auditEventVisual(props.delivery.event));
	const scope = computed(() => {
		const key = auditEventContextKey(props.delivery.event);
		return key ? t(key) : null;
	});
	const status = computed(() => {
		const value = props.delivery.status;
		const statusMetadata: Record<NotificationDelivery['status'], { tone: UiTone; icon: string }> = {
			queued: { tone: 'warning', icon: 'fa-solid fa-clock' },
			dispatched: { tone: 'warning', icon: 'fa-solid fa-paper-plane' },
			sent: { tone: 'success', icon: 'fa-solid fa-circle-check' },
			failed: { tone: 'danger', icon: 'fa-solid fa-circle-xmark' },
			unknown: { tone: 'danger', icon: 'fa-solid fa-circle-question' },
		};
		const metadata = statusMetadata[value];
		return {
			...metadata,
			short: t(`auditLog.deliveries.statusShort.${value}`),
			full: t(`auditLog.deliveries.status.${value}`),
		};
	});

	const date = computed(() => new Date(props.delivery.createdAt));
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
	const updatedLabel = computed(() =>
		props.delivery.updatedAt > props.delivery.createdAt
			? t('auditLog.deliveries.updated', {
					time: new Date(props.delivery.updatedAt).toLocaleString(locale.value),
				})
			: null,
	);
</script>

<template>
	<article
		class="audit-delivery-row"
		:data-delivery-id="delivery.id"
		:data-kind="visual.kind"
		:data-status="delivery.status"
	>
		<time class="audit-delivery-row__time" :datetime="date.toISOString()">
			<strong>{{ timeLabel }}</strong>
			<span>{{ dayLabel }}</span>
		</time>

		<div class="audit-delivery-row__track" aria-hidden="true">
			<span class="audit-delivery-row__node"><i :class="visual.icon"></i></span>
		</div>

		<div class="audit-delivery-row__content">
			<div class="audit-delivery-row__heading">
				<strong class="audit-delivery-row__action">{{ eventLabel }}</strong>
				<UiBadge v-if="scope" class="audit-delivery-row__scope" appearance="ghost" density="compact">{{
					scope
				}}</UiBadge>
				<UiBadge
					class="audit-delivery-row__status"
					appearance="ghost"
					density="compact"
					:tone="status.tone"
					:title="status.full"
					:aria-label="status.full"
				>
					<i :class="status.icon" aria-hidden="true"></i>
					{{ status.short }}
				</UiBadge>
				<span class="audit-delivery-row__mobile-time">
					<i class="fa-regular fa-clock" aria-hidden="true"></i>
					{{ dayLabel }} · {{ timeLabel }}
				</span>
			</div>

			<div class="audit-delivery-row__meta">
				<span v-if="delivery.settingId !== null" class="audit-delivery-row__meta-item">
					<i class="fa-solid fa-bell" aria-hidden="true"></i>
					{{ t('auditLog.deliveries.channel') }} #{{ delivery.settingId }}
				</span>
				<span v-else class="audit-delivery-row__meta-item">
					<i class="fa-solid fa-bell-slash" aria-hidden="true"></i>
					{{ t('auditLog.deliveries.channelUnavailable') }}
				</span>
				<span v-if="updatedLabel" class="audit-delivery-row__meta-item">
					<i class="fa-solid fa-rotate" aria-hidden="true"></i>
					{{ updatedLabel }}
				</span>
			</div>
		</div>
	</article>
</template>

<style scoped>
	.audit-delivery-row {
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

	.audit-delivery-row[data-kind='connection'] {
		--audit-kind-color: #5f7cfa;
	}

	.audit-delivery-row[data-kind='agent'] {
		--audit-kind-color: #d8679b;
	}

	.audit-delivery-row[data-kind='configuration'] {
		--audit-kind-color: #d99a43;
	}

	.audit-delivery-row:hover {
		background: color-mix(in srgb, var(--text-color) 3.2%, transparent);
	}

	.audit-delivery-row__time {
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

	.audit-delivery-row__time strong {
		color: var(--text-color);
		font-size: 12px;
		font-weight: 670;
	}

	.audit-delivery-row__time span {
		font-size: 9px;
	}

	.audit-delivery-row__track {
		position: relative;
		display: flex;
		justify-content: center;
		padding-top: 2px;
	}

	.audit-delivery-row__track::before {
		position: absolute;
		top: -10px;
		bottom: -10px;
		left: 50%;
		width: 1px;
		content: '';
		background: color-mix(in srgb, var(--border-color) 62%, transparent);
		transform: translateX(-50%);
	}

	.audit-delivery-row__node {
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
	}

	.audit-delivery-row__content {
		min-width: 0;
		padding: 1px 0 2px;
	}

	.audit-delivery-row__heading {
		display: flex;
		min-width: 0;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px 7px;
	}

	.audit-delivery-row__action {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 13px;
		font-weight: 660;
		line-height: 1.35;
		letter-spacing: -0.012em;
	}

	.audit-delivery-row__scope {
		background: color-mix(in srgb, var(--audit-kind-color) 8%, transparent);
		color: color-mix(in srgb, var(--audit-kind-color) 76%, var(--text-color));
	}

	.audit-delivery-row__status {
		margin-left: auto;
	}

	.audit-delivery-row__meta {
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

	.audit-delivery-row__meta-item {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 5px;
		overflow-wrap: anywhere;
	}

	.audit-delivery-row__meta-item i {
		flex: 0 0 auto;
		font-size: 8.5px;
		opacity: 0.78;
	}

	.audit-delivery-row__mobile-time {
		display: none;
		align-items: center;
		gap: 5px;
		color: var(--ui-text-muted);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.audit-delivery-row {
			grid-template-columns: 30px minmax(0, 1fr);
			gap: 9px;
			padding: 12px 8px 12px 2px;
		}

		.audit-delivery-row__time {
			display: none;
		}

		.audit-delivery-row__track {
			grid-column: 1;
			grid-row: 1;
			padding-top: 1px;
		}

		.audit-delivery-row__track::before {
			top: -12px;
			bottom: -12px;
		}

		.audit-delivery-row__content {
			grid-column: 2;
			grid-row: 1;
		}

		.audit-delivery-row__mobile-time {
			display: inline-flex;
			width: 100%;
			margin-top: 1px;
		}

		.audit-delivery-row__status {
			margin-left: 0;
		}

		.audit-delivery-row__meta {
			font-size: 10.5px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.audit-delivery-row {
			transition: none;
		}
	}
</style>
