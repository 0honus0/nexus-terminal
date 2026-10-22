<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInput, UiModal, UiSelect, UiSpinner } from '@/foundation/ui';
	import ProxyForm from '../components/ProxyForm.vue';
	import { useProxyManagement } from '../composables/use-proxy-management';

	const { t } = useI18n();
	const { data, modal, editing, loading, refresh, open, save, remove } = useProxyManagement();
	const search = ref('');
	const typeFilter = ref<'all' | 'SOCKS5' | 'HTTP'>('all');

	const filtered = computed(() => {
		const query = search.value.trim().toLowerCase();
		return data.proxies.value.filter((proxy) => {
			if (typeFilter.value !== 'all' && proxy.type !== typeFilter.value) return false;
			if (!query) return true;
			return `${proxy.name} ${proxy.type} ${proxy.host} ${proxy.port} ${proxy.username ?? ''}`
				.toLowerCase()
				.includes(query);
		});
	});

	const summary = computed(() => {
		const proxies = data.proxies.value;
		return [
			{
				key: 'total',
				label: t('proxies.summary.total'),
				value: proxies.length,
				icon: 'fa-solid fa-network-wired',
				tone: 'primary',
			},
			{
				key: 'socks5',
				label: 'SOCKS5',
				value: proxies.filter((proxy) => proxy.type === 'SOCKS5').length,
				icon: 'fa-solid fa-shuffle',
				tone: 'accent',
			},
			{
				key: 'http',
				label: 'HTTP',
				value: proxies.filter((proxy) => proxy.type === 'HTTP').length,
				icon: 'fa-solid fa-globe',
				tone: 'info',
			},
		];
	});
</script>

<template>
	<main class="ui-catalog-page">
		<div class="ui-catalog-shell">
			<h1 class="ui-catalog-title">{{ t('proxies.title') }}</h1>

			<div class="ui-catalog-actions">
				<UiButton
					type="button"
					appearance="solid"
					tone="primary"
					:disabled="loading || data.busy.value || data.needsRefresh.value || Boolean(modal)"
					@click="open()"
				>
					<i class="fas fa-plus" aria-hidden="true"></i>
					{{ t('proxies.addProxy') }}
				</UiButton>
			</div>

			<div
				class="ui-catalog-summary ui-catalog-summary--three"
				role="group"
				:aria-label="t('proxies.summary.label')"
			>
				<div v-for="item in summary" :key="item.key" class="ui-catalog-stat" :data-tone="item.tone">
					<span class="ui-catalog-stat__icon" aria-hidden="true"><i :class="item.icon"></i></span>
					<span class="ui-catalog-stat__label">{{ item.label }}</span>
					<strong class="ui-catalog-stat__value">{{ item.value }}</strong>
				</div>
			</div>

			<section class="ui-catalog-panel" aria-labelledby="proxy-list-title">
				<header class="ui-catalog-panel__head">
					<div class="ui-catalog-panel__title">
						<span class="ui-catalog-panel__mark" aria-hidden="true">
							<i class="fas fa-route"></i>
						</span>
						<h2 id="proxy-list-title">
							{{ t('proxies.listTitle') }}
							<span class="ui-catalog-panel__count">{{ filtered.length }}</span>
						</h2>
					</div>
				</header>

				<div class="ui-catalog-toolbar ui-catalog-toolbar--proxy">
					<UiInput
						v-model="search"
						type="search"
						density="comfortable"
						:placeholder="t('proxies.searchPlaceholder')"
						:aria-label="t('common.search')"
					>
						<template #leading><i class="fas fa-magnifying-glass" aria-hidden="true"></i></template>
					</UiInput>
					<UiSelect
						v-model="typeFilter"
						density="comfortable"
						text-align="center"
						:aria-label="t('proxies.filterType')"
					>
						<option value="all">{{ t('proxies.allTypes') }}</option>
						<option value="SOCKS5">SOCKS5</option>
						<option value="HTTP">HTTP</option>
					</UiSelect>
				</div>
				<div v-if="data.needsRefresh.value" class="mb-3 flex justify-end">
					<UiButton type="button" density="compact" :disabled="loading" @click="refresh">
						{{ t('proxies.refresh') }}
					</UiButton>
				</div>

				<div v-if="loading && data.proxies.value.length === 0" class="ui-catalog-empty">
					<UiSpinner />
					<p>{{ t('proxies.loading') }}</p>
				</div>
				<div v-else-if="filtered.length === 0" class="ui-catalog-empty">
					<span class="ui-catalog-empty__icon" aria-hidden="true">
						<i :class="search || typeFilter !== 'all' ? 'fas fa-magnifying-glass' : 'fas fa-route'"></i>
					</span>
					<p v-if="data.proxies.value.length === 0">{{ t('proxies.noProxies') }}</p>
					<p v-else>{{ t('proxies.noMatches') }}</p>
				</div>
				<ul v-else class="ui-catalog-list">
					<li v-for="proxy in filtered" :key="proxy.id">
						<article class="ui-catalog-card">
							<span
								class="ui-catalog-card__icon"
								:data-tone="proxy.type === 'HTTP' ? 'info' : 'accent'"
								aria-hidden="true"
							>
								<i :class="proxy.type === 'HTTP' ? 'fas fa-globe' : 'fas fa-shuffle'"></i>
							</span>
							<div class="ui-catalog-card__content">
								<div class="ui-catalog-card__heading">
									<strong class="ui-catalog-card__name">{{ proxy.name }}</strong>
									<span class="ui-catalog-badge">{{ proxy.type }}</span>
									<span v-if="proxy.username" class="ui-catalog-badge ui-catalog-badge--accent">
										{{ t('proxies.authenticated') }}
									</span>
								</div>
								<code class="ui-catalog-card__address">{{ proxy.host }}:{{ proxy.port }}</code>
								<div class="ui-catalog-card__meta">
									<span class="ui-catalog-card__meta-item">
										<i class="fas fa-user" aria-hidden="true"></i>
										{{ proxy.username || t('proxies.noAuthentication') }}
									</span>
								</div>
							</div>
							<div class="ui-catalog-card__actions">
								<UiButton
									type="button"
									appearance="soft"
									icon-only
									density="comfortable"
									class="ui-catalog-card__action"
									:disabled="loading || data.busy.value || data.needsRefresh.value"
									:aria-label="t('proxies.actions.edit')"
									:title="t('proxies.actions.edit')"
									@click="open(proxy)"
								>
									<i class="fas fa-pen" aria-hidden="true"></i>
									<span class="ui-catalog-card__action-label">{{ t('proxies.actions.edit') }}</span>
								</UiButton>
								<UiButton
									type="button"
									appearance="soft"
									tone="danger"
									icon-only
									density="comfortable"
									class="ui-catalog-card__action"
									:disabled="loading || data.busy.value || data.needsRefresh.value"
									:aria-label="t('proxies.actions.delete')"
									:title="t('proxies.actions.delete')"
									@click="remove(proxy)"
								>
									<i class="fas fa-trash-alt" aria-hidden="true"></i>
									<span class="ui-catalog-card__action-label">{{ t('proxies.actions.delete') }}</span>
								</UiButton>
							</div>
						</article>
					</li>
				</ul>
			</section>

			<UiModal
				:visible="Boolean(modal)"
				:z-index="150"
				:close-on-backdrop="false"
				panel-class="ui-form-surface !max-w-xl !p-4 sm:!p-6"
				:panel-style="{ height: 'min(650px, calc(100dvh - 2rem))', maxHeight: 'calc(100dvh - 2rem)' }"
				content-class="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !py-0"
				@close="!loading && (modal = false)"
			>
				<ProxyForm v-if="modal" :proxy="editing" :loading="loading" @submit="save" @cancel="modal = false" />
			</UiModal>
		</div>
	</main>
</template>
