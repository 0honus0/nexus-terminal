<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { ChevronDown, ScrollText, Search, Trash2 } from '@lucide/vue';
	import {
		UiBadge,
		UiButton,
		UiEmptyState,
		UiInput,
		UiSelect,
		UiScrollArea,
		UiToolbar,
		vSelectableAction,
	} from '../../ui/browser/ui-components-api.js';
	import { LogLevelSchema } from '../log-plugin-api.js';
	import type { LogHistoryApi } from './log-api.js';

	const { history } = defineProps<{ history: LogHistoryApi }>();
	const { t, te, locale } = useI18n({ useScope: 'global' });
	const search = ref('');
	const level = ref('all');
	const filtered = computed(() => !!search.value.trim() || level.value !== 'all');
	const timeFormat = computed(() => new Intl.DateTimeFormat(locale.value, { timeStyle: 'medium' }));
	const options = computed(() => [
		{ value: 'all', label: t('logViewer.all') },
		...LogLevelSchema.options.map((value) => ({ value, label: t('logViewer.levels.' + value) })),
	]);
	const entries = computed(() => {
		const query = search.value.trim().toLocaleLowerCase(locale.value);
		return history.entries.value
			.flatMap((entry) => {
				const severity = entry.level;
				if (level.value !== 'all' && severity !== level.value) return [];
				const key = 'notices.' + entry.code;
				const message = te(key) ? t(key, { ...entry.params }) : entry.code;
				const terms = [
					message,
					entry.code,
					entry.source,
					entry.pluginId,
					entry.correlationId,
					JSON.stringify(entry.params),
				];
				if (query && !terms.some((value) => value?.toLocaleLowerCase(locale.value).includes(query))) return [];
				const tone =
					severity === 'fatal' || severity === 'error'
						? 'danger'
						: severity === 'warn'
							? 'warning'
							: severity === 'info'
								? 'primary'
								: 'neutral';
				return [{ entry, message, severity, tone }] as const;
			})
			.reverse();
	});
</script>

<template>
	<section class="log-app">
		<header class="log-header">
			<div class="log-heading">
				<span class="log-heading__icon"><ScrollText :size="23" aria-hidden="true" /></span>
				<div>
					<h2>{{ t('logViewer.session') }}</h2>
					<p>{{ t('logViewer.retention', { limit: history.limit }) }}</p>
				</div>
			</div>
			<span class="log-count">{{
				t(filtered ? 'logViewer.matching' : 'logViewer.count', {
					count: entries.length,
				})
			}}</span>
		</header>
		<UiToolbar class="log-toolbar">
			<UiInput
				v-model="search"
				type="search"
				:aria-label="t('logViewer.search')"
				:placeholder="t('logViewer.search')"
				><template #leading><Search :size="17" aria-hidden="true" /></template
			></UiInput>
			<template #actions
				><UiSelect v-model="level" :options="options" :aria-label="t('logViewer.level')" />
				<UiButton
					icon-only
					density="default"
					:aria-label="t('logViewer.clear')"
					:title="t('logViewer.clear')"
					:disabled="!history.entries.value.length"
					@click="history.clear()"
					><Trash2 :size="18"
				/></UiButton>
			</template>
		</UiToolbar>
		<UiScrollArea class="log-results" :aria-label="t('logViewer.title')">
			<UiEmptyState
				v-if="!entries.length"
				:icon="ScrollText"
				:title="t(history.entries.value.length ? 'logViewer.noMatches' : 'logViewer.empty')"
				:description="t(history.entries.value.length ? 'logViewer.noMatchesHint' : 'logViewer.emptyHint')"
			/>
			<ol v-else class="log-list">
				<li v-for="{ entry, message, severity, tone } in entries" :key="entry.id" class="log-row">
					<details>
						<summary v-selectable-action :aria-label="`${t('logViewer.details')}: ${message}`">
							<div class="log-row__meta">
								<UiBadge :tone="tone" dot>{{ t(`logViewer.levels.${severity}`) }}</UiBadge><span
									class="log-source"
									:title="entry.source"
									>{{ entry.source }}</span
								><time :datetime="new Date(entry.time).toISOString()">{{
									timeFormat.format(entry.time)
								}}</time>
							</div>
							<div class="log-row__message">
								<span>{{ message }}</span><ChevronDown :size="15" aria-hidden="true" />
							</div>
						</summary>
						<dl class="log-details" data-ui-selection="text">
							<div>
								<dt>{{ t('logViewer.event') }}</dt>
								<dd>{{ entry.code }}</dd>
							</div>
							<div>
								<dt>{{ t('logViewer.source') }}</dt>
								<dd>{{ entry.source }}</dd>
							</div>
							<div v-if="entry.pluginId">
								<dt>{{ t('logViewer.plugin') }}</dt>
								<dd>{{ entry.pluginId }}</dd>
							</div>
							<div v-if="entry.correlationId">
								<dt>{{ t('logViewer.correlation') }}</dt>
								<dd>{{ entry.correlationId }}</dd>
							</div>
							<div v-if="entry.params">
								<dt>{{ t('logViewer.params') }}</dt>
								<dd>
									<pre>{{ JSON.stringify(entry.params, null, 2) }}</pre>
								</dd>
							</div>
						</dl>
					</details>
				</li>
			</ol>
		</UiScrollArea>
	</section>
</template>

<style scoped>
	.log-app {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		color: var(--ui-text);
		background: var(--ui-surface);
	}
	.log-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 22px 24px 18px;
	}
	.log-heading {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.log-heading__icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex: none;
		border-radius: 14px;
		color: var(--ui-primary);
		background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	.log-heading p {
		margin: 5px 0 0;
		font-size: 11px;
		line-height: 1.6;
		color: var(--ui-muted);
	}
	.log-count {
		min-width: 9ch;
		text-align: end;
		flex: none;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--ui-muted);
	}
	.log-toolbar {
		padding: 0 24px 18px;
	}
	.log-results {
		flex: 1;
		min-height: 0;
		overscroll-behavior: contain;
		border-top: 1px solid var(--ui-border);
	}
	.log-list {
		margin: 0;
		padding: 0 24px;
		list-style: none;
	}
	.log-row {
		border-bottom: 1px solid var(--ui-border);
	}
	.log-row:last-child {
		border-bottom: 0;
	}
	summary {
		padding: 16px 0;
		list-style: none;
		cursor: pointer;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: -2px;
		border-radius: 8px;
	}
	.log-row__meta {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.log-source {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ui-muted);
		font-size: 11px;
	}
	time {
		flex: none;
		color: var(--ui-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.log-row__message {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 16px;
		margin-top: 9px;
		font-size: 13px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.log-row__message svg {
		flex: none;
		margin-top: 4px;
		color: var(--ui-muted);
	}
	details[open] .log-row__message svg {
		transform: rotate(180deg);
	}
	.log-details {
		display: grid;
		gap: 12px;
		margin: 0 0 16px;
		padding: 14px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--ui-muted) 6%, transparent);
		font-size: 12px;
		line-height: 1.6;
	}
	.log-details > div {
		display: grid;
		grid-template-columns: 90px minmax(0, 1fr);
		gap: 10px;
	}
	dt {
		color: var(--ui-muted);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
		font: inherit;
	}
	@container (max-width: 480px) {
		.log-header {
			padding: 18px 16px 14px;
			flex-wrap: wrap;
			gap: 8px;
		}
		.log-heading__icon {
			display: none;
		}
		.log-toolbar {
			padding: 0 16px 14px;
			gap: 8px;
		}
		.log-list {
			padding: 0 16px;
		}
		.log-details > div {
			grid-template-columns: minmax(0, 1fr);
			gap: 3px;
		}
	}
</style>
