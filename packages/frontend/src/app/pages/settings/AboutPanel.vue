<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiSettingsGroup, UiSpinner } from '@/foundation/ui';
	import packageJson from '../../../../package.json';
	import {
		fetchLatestRelease,
		isNewerRelease,
		releaseRepository,
		releaseRepositoryUrl,
		releaseUrl,
	} from '../../config/release';

	const { t } = useI18n();
	const currentVersion = packageJson.version;
	const latestVersion = ref<string | null>(null);
	const checking = ref(false);
	const error = ref('');
	const controller = new AbortController();
	const updateAvailable = computed(() =>
		latestVersion.value ? isNewerRelease(latestVersion.value, currentVersion) : false,
	);

	const check = async (): Promise<void> => {
		checking.value = true;
		error.value = '';
		try {
			latestVersion.value = await fetchLatestRelease(controller.signal);
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			const status = typeof cause === 'object' && cause && 'status' in cause ? Number(cause.status) : 0;
			error.value =
				status === 404
					? t('settings.about.error.noReleases')
					: status === 403
						? t('settings.about.error.rateLimit')
						: t('settings.about.error.checkFailed');
		} finally {
			checking.value = false;
		}
	};

	onMounted(check);
	onBeforeUnmount(() => controller.abort());
</script>

<template>
	<UiSettingsGroup :title="t('settings.about.appInfo')" icon="fa-solid fa-circle-info" tone="info">
		<div class="settings-about">
			<div class="settings-about__item">
				<span class="settings-about__icon" aria-hidden="true">
					<i class="fa-solid fa-tag"></i>
				</span>
				<div class="settings-about__copy">
					<span class="settings-about__label">{{ t('settings.about.version') }}</span>
					<div class="settings-about__value-row">
						<span class="settings-about__version">v{{ currentVersion }}</span>
						<UiBadge v-if="checking" tone="primary" density="compact" role="status">
							<UiSpinner class="[--ui-spinner-size:10px]" />
							{{ t('settings.about.checkingUpdate') }}
						</UiBadge>
						<UiBadge v-else-if="error" tone="danger" density="compact" :title="error">
							<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
							{{ t('settings.about.error.checkFailedShort') }}
						</UiBadge>
						<a
							v-else-if="updateAvailable && latestVersion"
							:href="releaseUrl(latestVersion)"
							target="_blank"
							rel="noopener noreferrer"
							class="ui-focusable settings-about__update"
						>
							<UiBadge tone="warning" density="compact">
								<i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i>
								{{ t('settings.about.updateAvailable', { version: latestVersion }) }}
							</UiBadge>
						</a>
						<UiBadge v-else-if="latestVersion" tone="success" density="compact">
							<i class="fa-solid fa-check" aria-hidden="true"></i>
							{{ t('settings.about.latestVersion') }}
						</UiBadge>
					</div>
				</div>
			</div>
			<a
				:href="releaseRepositoryUrl"
				target="_blank"
				rel="noopener noreferrer"
				class="settings-about__item settings-about__item--link ui-focusable"
			>
				<span class="settings-about__icon" aria-hidden="true">
					<i class="fa-brands fa-github"></i>
				</span>
				<span class="settings-about__copy">
					<span class="settings-about__label">{{ t('settings.about.project') }}</span>
					<span class="settings-about__repository">{{ releaseRepository }}</span>
				</span>
				<i class="settings-about__external fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
			</a>
		</div>
	</UiSettingsGroup>
</template>

<style scoped>
	.settings-about {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
		width: 100%;
	}

	.settings-about__item {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 11px;
		padding: 12px 14px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--header-bg-color) 28%, transparent);
	}

	.settings-about__item--link {
		color: inherit;
		transition:
			background-color 160ms ease,
			color 160ms ease;
	}

	.settings-about__item--link:hover {
		background: color-mix(in srgb, var(--link-active-color) 8%, var(--header-bg-color) 28%);
	}

	.settings-about__icon {
		display: grid;
		width: 30px;
		height: 30px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 9px;
		background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		color: color-mix(in srgb, var(--link-active-color) 76%, var(--text-color));
		font-size: 11px;
	}

	.settings-about__copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.settings-about__label {
		color: var(--text-color-secondary);
		font-size: 10.5px;
		font-weight: 500;
		line-height: 1.35;
	}

	.settings-about__value-row {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 9px;
		margin-top: 3px;
	}

	.settings-about__version {
		color: var(--text-color);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 14px;
		font-weight: 650;
		line-height: 1.35;
		letter-spacing: -0.01em;
	}

	.settings-about__repository {
		display: block;
		margin-top: 3px;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 12.5px;
		font-weight: 550;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 160ms ease;
	}

	.settings-about__item--link:hover .settings-about__repository {
		color: var(--link-active-color);
	}

	.settings-about__external {
		flex: 0 0 auto;
		color: var(--text-color-secondary);
		font-size: 10px;
		opacity: 0.55;
	}

	.settings-about__update {
		display: inline-flex;
		border-radius: 999px;
	}
</style>
