<script setup lang="ts">
	import type { WindowLauncher } from '../../window/browser/window-plugin-api.js';
	import { ChevronLeft, ChevronRight, MoveDiagonal2, Package, Plus, X } from '@lucide/vue';
	import { useWindowSize } from '@vueuse/core';
	import { PaginationList, PaginationListItem, PaginationRoot } from 'reka-ui';
	import { computed, onScopeDispose, ref, toValue, watch, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		LayoutProfiles,
		LayoutProfileSchema,
		resolveLayoutProfile,
		type LayoutProfile,
	} from '../../layout/layout-api.js';
	import type { LogApi } from '../../log/browser/log-api.js';
	import { PluginView } from '../../plugin/browser/plugin-view-api.js';
	import {
		resolveApplicationLabel,
		type PluginComponentEntry,
		type PluginContributionList,
	} from '../../plugin/plugin-api.browser.js';
	import {
		UiActionCard,
		UiButton,
		UiContextMenu,
		UiDialog,
		UiList,
		UiListItem,
		UiSelect,
	} from '../../ui/browser/ui-components-api.js';
	import { useUiMotion } from '../../ui/browser/ui-motion-api.js';
	import { WindowApi, WindowLayer } from '../../window/browser/window-api.js';
	import type { DesktopApi, DesktopApplication, DesktopTile } from './desktop-api.js';
	import DesktopGrid from './DesktopGrid.vue';
	import DesktopDock from './DesktopDock.vue';
	import { useDesktopNavigation } from './desktop-navigation.js';
	import { useDesktopPreload } from './desktop-preload.js';

	const { contributions, pluginIcons, log, builtins, desktop, escapeAction, windowLauncher } = defineProps<{
		contributions: PluginContributionList;
		pluginIcons: ReadonlyMap<string, Component>;
		log: Pick<LogApi, 'report'>;
		builtins: readonly DesktopApplication[];
		desktop: DesktopApi;
		escapeAction: 'minimize' | 'close';
		windowLauncher: Pick<WindowLauncher, 'attach'>;
	}>();
	const { t, n, locale } = useI18n({ useScope: 'global' });
	const { width } = useWindowSize({ includeScrollbar: false });
	const { play } = useUiMotion();
	const profile = computed(() => resolveLayoutProfile(width.value));
	const windows = new WindowApi(log);
	const editing = ref(false);
	const adding = ref(false);
	const gridFrame = ref<HTMLElement>();
	const grid = ref<InstanceType<typeof DesktopGrid>>();
	const sizingKey = ref<string>();
	const plugins = computed(() =>
		contributions.value.filter((entry): entry is PluginComponentEntry => 'component' in entry),
	);
	const applications = computed(
		() =>
			new Map<string, DesktopApplication>([
				...builtins.map((app) => [app.key, app] as const),
				...plugins.value
					.filter(({ kind }) => kind === 'applications')
					.map(
						(plugin) =>
							[
								plugin.key,
								{
									key: plugin.key,

									label: () => resolveApplicationLabel(plugin.label, locale.value),

									icon: pluginIcons.get(plugin.context.self.id) ?? plugin.icon ?? Package,
									multipleWindows: plugin.multipleWindows,
									size: plugin.defaultWindowSize,
									scrollMode: plugin.scrollMode,
									scrollbarGutter: plugin.scrollbarGutter,
									plugin,
								},
							] as const,
					),
			]),
	);
	const widgets = computed(
		() => new Map(plugins.value.filter(({ kind }) => kind === 'widgets').map((entry) => [entry.key, entry])),
	);
	const page = computed(() => desktop.page(profile.value));
	const preloads = useDesktopPreload(
		() => applications.value,
		() => [...desktop.pins.value, ...page.value.tiles.map(({ key }) => key)],
	);
	const pages = computed(() => desktop.get(profile.value).pages);
	const numberedPages = computed(() => profile.value === 'wide' || editing.value);
	const sizingTile = computed(() => page.value.tiles.find((tile) => tile.key === sizingKey.value));
	const sizeChoices = [
		[1, 1],
		[1, 2],
		[2, 1],
		[2, 2],
		[2, 3],
		[3, 2],
		[3, 3],
		[4, 2],
		[4, 3],
	] as const;
	useDesktopNavigation(gridFrame, () => editing.value || !!windows.active.value, stepPage);
	watch([profile, editing, () => page.value.id], () => (sizingKey.value = undefined));

	const definitions = (target: LayoutProfile) => [
		...[...applications.value.values()].map((app) => ({
			key: app.key,
			label: app.label(),
			w: target === 'compact' ? 1 : (app.tileSize?.w ?? 2),
			h: app.tileSize?.h ?? 1,
		})),
		...[...widgets.value.values()].map((entry) => ({ key: entry.key, label: toValue(entry.label), w: 2, h: 1 })),
	];

	const addable = computed(() => {
		const placed = new Set(pages.value.flatMap(({ tiles }) => tiles.map(({ key }) => key)));
		return definitions(profile.value).filter(({ key }) => !placed.has(key));
	});
	watch(
		[applications, widgets],
		() => {
			for (const target of LayoutProfileSchema.options) desktop.ensure(target, definitions(target));
		},
		{ immediate: true },
	);
	const detachLauncher = windowLauncher.attach((key) => !!openApplication(key));
	onScopeDispose(() => {
		detachLauncher();
		windows.close();
	});

	function open(key: string, event?: MouseEvent): void {
		if (!editing.value) toggleApplication(key, event);
	}

	function toggleApplication(key: string, event?: MouseEvent): void {
		const application = applications.value.get(key);
		if (!application) return;
		preloads.opened(key);
		const launcher = event?.currentTarget ?? document.activeElement;
		windows.toggle(application, launcher instanceof HTMLElement ? launcher : undefined);
	}

	function openApplication(key: string) {
		const application = applications.value.get(key);
		if (!application || application.plugin?.lifetime.signal.aborted) return;
		preloads.opened(key);
		return windows.open(application);
	}

	function tileEntry(tile: DesktopTile): PluginComponentEntry | undefined {
		const entry = applications.value.get(tile.key)?.plugin;
		if (!entry?.tile) return;
		if (tile.w > 1 || tile.h > 1 || entry.tile.showAtIconSize) return entry;
	}

	function contextItems(tile: DesktopTile) {
		const app = applications.value.get(tile.key);
		return [
			{ id: 'pin', label: t(desktop.pins.value.includes(tile.key) ? 'desktop.unpin' : 'desktop.pin') },
			...(app?.multipleWindows ? [{ id: 'new', label: t('desktop.newWindow') }] : []),
		];
	}

	function contextAction(tile: DesktopTile, action: string): void {
		if (action === 'pin') desktop.togglePin(tile.key);
		else {
			openApplication(tile.key);
		}
	}

	function turn(id: string): void {
		if (page.value.id === id) return;
		const direction = pages.value.findIndex((item) => item.id === id) - pages.value.indexOf(page.value);
		desktop.selectPage(profile.value, id);
		if (gridFrame.value)
			play(
				gridFrame.value,
				[
					{ opacity: 0.5, transform: `translateX(${Math.sign(direction) * 20}px)` },
					{ opacity: 1, transform: 'translateX(0)' },
				],
				220,
			);
	}

	function stepPage(offset: number): void {
		const index = pages.value.indexOf(page.value);
		const target = pages.value[(index + offset + pages.value.length) % pages.value.length];
		if (target) turn(target.id);
	}
</script>

<template>
	<div class="desktop-shell" :data-profile="profile">
		<main class="desktop-main" :aria-label="t('desktop.title')">
			<div ref="gridFrame" class="desktop-grid-frame">
				<DesktopGrid
					ref="grid"
					:key="profile + ':' + page.id"
					:page="page"
					:columns="LayoutProfiles[profile].columns"
					:rows="desktop.rows"
					:editing="editing"
					@layout="(tiles) => desktop.setTiles(profile, page.id, tiles)"
				>
					<template #default="{ tile, nudge }">
						<div class="desktop-tile" :class="{ 'is-editing': editing }">
							<UiContextMenu
								v-if="applications.has(tile.key)"
								:items="contextItems(tile)"
								:disabled="editing"
								@select="(action) => contextAction(tile, action)"
							>
								<div
									class="desktop-tile__content"
									:inert="editing"
									@pointerenter="
										(event: PointerEvent) =>
											!editing && event.pointerType !== 'touch' && preloads.prepare(tile.key)
									"
									@focusin="!editing && preloads.prepare(tile.key)"
								>
									<slot
										v-if="!applications.get(tile.key)?.plugin && (tile.w > 1 || tile.h > 1)"
										name="tile"
										:application="applications.get(tile.key)!"
										:size="{ columns: tile.w, rows: tile.h }"
										:open="() => open(tile.key)"
									/>
									<PluginView
										v-else-if="tileEntry(tile)"
										:key="tileEntry(tile)!.instance"
										:entry="tileEntry(tile)!"
										:log="log"
									>
										<template #default="{ context, view }">
											<component
												:is="tileEntry(tile)!.tile!.component"
												:context="context"
												:view="view"
												:size="{ columns: tile.w, rows: tile.h }"
												:open="
													() => {
														if (!view.signal.aborted) open(tile.key);
													}
												"
											/>
										</template>
									</PluginView>
									<UiActionCard
										v-else
										class="application-tile"
										:style="{ '--app-accent': applications.get(tile.key)?.color }"
										:label="applications.get(tile.key)!.label()"
										:title="applications.get(tile.key)!.label()"
										@click="(event: MouseEvent) => open(tile.key, event)"
									>
										<span class="application-tile__icon"
											><component
												:is="applications.get(tile.key)?.icon ?? Package"
												:size="30"
												:stroke-width="1.7"
										/></span>
										<strong>{{ applications.get(tile.key)!.label() }}</strong>
									</UiActionCard>
								</div>
							</UiContextMenu>
							<section
								v-else-if="widgets.has(tile.key)"
								class="desktop-widget"
								:aria-label="toValue(widgets.get(tile.key)!.label)"
								:inert="editing"
							>
								<PluginView
									:key="widgets.get(tile.key)!.instance"
									:entry="widgets.get(tile.key)!"
									:log="log"
								/>
							</section>
							<div v-else class="desktop-tile__placeholder">
								<Package :size="20" /><span>{{ tile.label }}</span>
							</div>
							<button
								v-show="editing"
								class="desktop-tile__move"
								type="button"
								:aria-label="t('desktop.move', { title: tile.label })"
								@keydown="nudge"
							/>
							<span v-show="editing" class="desktop-tile__resize" aria-hidden="true">
								<MoveDiagonal2 :size="18" />
							</span>
							<template v-if="editing">
								<button
									class="desktop-tile__size"
									type="button"
									:aria-label="t('desktop.resize', { title: tile.label })"
									@click="sizingKey = tile.key"
								>
									{{ tile.w }} × {{ tile.h }}
								</button>
								<button
									v-if="!applications.has(tile.key)"
									class="desktop-tile__remove"
									type="button"
									:aria-label="t('desktop.removeTile', { title: tile.label })"
									@click="desktop.remove(profile, tile.key)"
								>
									<X :size="16" />
								</button>
							</template>
						</div>
					</template>
				</DesktopGrid>
			</div>
			<footer class="desktop-pagination" data-ui-selection="none">
				<PaginationRoot
					class="desktop-pages"
					:class="{ 'desktop-pages--dots': !numberedPages }"
					:page="pages.indexOf(page) + 1"
					:total="pages.length"
					:items-per-page="1"
					:sibling-count="numberedPages ? 1 : 2"
					:show-edges="numberedPages"
					:aria-label="t('desktop.pages')"
					@update:page="(index) => turn(pages[index - 1]!.id)"
				>
					<button
						v-if="profile === 'wide'"
						type="button"
						:aria-label="t('desktop.previousPage')"
						:disabled="pages.length === 1"
						@click="stepPage(-1)"
					>
						<ChevronLeft :size="16" />
					</button>
					<PaginationList v-slot="{ items }" class="desktop-pages__list">
						<template
							v-for="(item, index) in items"
							:key="item.type === 'page' ? pages[item.value - 1]!.id : 'ellipsis:' + index"
						>
							<div
								v-if="item.type === 'page'"
								class="desktop-pages__item"
								:class="{ 'is-editing': editing }"
							>
								<PaginationListItem
									v-if="item.type === 'page'"
									:value="item.value"
									:aria-label="t('desktop.pageNumber', { page: item.value })"
									:class="{
										'desktop-pages__dot': !numberedPages,
										'desktop-pages__dot--edge':
											!numberedPages &&
											((index === 0 && item.value > 1) ||
												(index === items.length - 1 && item.value < pages.length)),
									}"
								>
									<span>{{ numberedPages ? n(item.value) : '' }}</span>
								</PaginationListItem>
								<button
									v-if="editing"
									class="desktop-pages__remove"
									type="button"
									:aria-label="t('desktop.removePage', { page: item.value })"
									:disabled="pages.length === 1"
									@click="desktop.removePage(profile, pages[item.value - 1]!.id)"
								>
									<span><X :size="11" /></span>
								</button>
							</div>
							<span v-else class="desktop-pages__ellipsis" aria-hidden="true">…</span>
						</template>
					</PaginationList>
					<button
						v-if="profile === 'wide'"
						type="button"
						:aria-label="t('desktop.nextPage')"
						:disabled="pages.length === 1"
						@click="stepPage(1)"
					>
						<ChevronRight :size="16" />
					</button>
					<UiButton
						v-if="editing"
						appearance="ghost"
						icon-only
						:aria-label="t('desktop.addPage')"
						@click="desktop.addPage(profile)"
						><Plus :size="16"
					/></UiButton>
					<span
						class="desktop-pages__summary"
						role="status"
						:aria-label="t('desktop.pageStatus', { page: pages.indexOf(page) + 1, total: pages.length })"
					>
						{{ n(pages.indexOf(page) + 1) }} / {{ n(pages.length) }}
					</span>
				</PaginationRoot>
			</footer>
		</main>
		<WindowLayer :windows="windows" :log="log" :escape-action="escapeAction">
			<template #default="{ application, minimized }"
				><slot
					name="window"
					:application="application"
					:minimized="minimized"
					:open-application="openApplication"
			/></template>
		</WindowLayer>
		<DesktopDock
			v-model:editing="editing"
			:windows="windows"
			:pins="desktop.pins.value"
			:applications="applications"
			@add="adding = true"
			@prepare="preloads.prepare"
			@open="toggleApplication"
		/>

		<UiDialog v-model:open="adding" :title="t('desktop.addTile')" :close-label="t('closeApplication')">
			<p v-if="!addable.length">{{ t('desktop.noTiles') }}</p>
			<UiList v-else>
				<UiListItem v-for="item in addable" :key="item.key" :title="item.label">
					<template #actions
						><UiButton
							density="compact"
							@click="
								desktop.add(profile, item);
								adding = false;
							"
							>{{ t('desktop.addTile') }}</UiButton
						></template
					>
				</UiListItem>
			</UiList>
		</UiDialog>
		<UiDialog
			:open="!!sizingTile && editing"
			size="sm"
			:title="t('desktop.resizeTitle')"
			:description="t('desktop.resizeHint')"
			:close-label="t('closeApplication')"
			@update:open="(value) => !value && (sizingKey = undefined)"
		>
			<label v-if="pages.length > 1" class="desktop-page-select">
				<span>{{ t('desktop.moveToPage') }}</span>
				<UiSelect
					:model-value="page.id"
					:options="
						pages.map((item, index) => ({
							value: item.id,
							label: t('desktop.pageNumber', { page: index + 1 }),
						}))
					"
					@update:model-value="
						(id) => id && sizingKey && desktop.moveTile(profile, sizingKey, id) && (sizingKey = undefined)
					"
				/>
			</label>
			<div class="desktop-size-choices">
				<UiButton
					v-for="[w, h] in sizeChoices"
					:key="w + ':' + h"
					density="touch"
					:tone="sizingTile?.w === w && sizingTile?.h === h ? 'primary' : 'neutral'"
					:aria-pressed="sizingTile?.w === w && sizingTile?.h === h"
					@click="sizingKey && grid?.resize(sizingKey, w, h)"
					>{{ w }} × {{ h }}</UiButton
				>
			</div>
		</UiDialog>
	</div>
</template>

<style scoped>
	.desktop-shell {
		position: relative;
		height: 100dvh;
		overflow: hidden;
		background: var(--ui-desktop-background, light-dark(#e9e3ee, #211a2c));
	}
	.desktop-main {
		display: flex;
		flex-direction: column;
		max-width: 1440px;
		height: 100%;
		min-height: 0;
		margin: auto;
		padding: max(32px, env(safe-area-inset-top)) max(32px, env(safe-area-inset-right)) env(safe-area-inset-bottom)
			max(32px, env(safe-area-inset-left));
	}
	@media (max-width: 699px) {
		.desktop-main {
			padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
				env(safe-area-inset-bottom) max(20px, env(safe-area-inset-left));
		}
	}
	.desktop-grid-frame {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.desktop-tile {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.desktop-tile,
	.desktop-tile__content {
		border-radius: inherit;
	}
	.desktop-tile__content {
		width: 100%;
		height: 100%;
		container-type: size;
	}
	.application-tile:focus-visible {
		--ui-action-card-radius: 19px;
	}
	.application-tile :deep(.ui-action-card__content) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(3px, 7cqmin, 8px);
		padding: 4px;
	}
	.application-tile__icon {
		display: grid;
		place-items: center;
		--_accent: var(--app-accent, var(--ui-primary));
		width: clamp(26px, 54cqmin, 64px);
		aspect-ratio: 1;
		flex: none;
		border-radius: clamp(9px, 18cqmin, 21px);
		color: #fff;
		background: linear-gradient(
			145deg,
			color-mix(in srgb, var(--_accent) 74%, #fff),
			var(--_accent) 65%,
			color-mix(in srgb, var(--_accent) 86%, #332350)
		);
		box-shadow:
			inset 0 1px 1px #ffffff70,
			inset 0 -1px 1px #0000000c,
			0 6px 14px color-mix(in srgb, var(--_accent) 20%, transparent);
		transition: filter var(--ui-motion-duration) ease;
	}
	.application-tile:hover .application-tile__icon {
		filter: brightness(1.06);
	}
	[data-profile='compact'] .application-tile__icon {
		width: clamp(26px, 54cqmin, 48px);
		border-radius: clamp(9px, 18cqmin, 16px);
	}
	.application-tile__icon svg {
		width: 48%;
		height: 48%;
	}
	.application-tile strong {
		max-width: 100%;
		font-size: clamp(11px, 13cqi, 14px);
		font-weight: 450;
		text-align: center;
		line-height: 1.3;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
	}
	[data-profile='compact'] .application-tile strong {
		font-size: clamp(11px, 13cqi, 12px);
	}
	.desktop-widget {
		width: 100%;
		height: 100%;
		overflow: auto;
		padding: 12px;
		background: color-mix(in srgb, var(--ui-surface) 84%, transparent);
	}
	.desktop-tile__placeholder {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 6px;
		width: 100%;
		height: 100%;
		color: var(--ui-muted);
		background: color-mix(in srgb, var(--ui-surface) 57%, transparent);
		font-size: 12px;
	}
	.is-editing .desktop-tile__content {
		pointer-events: none;
	}
	.desktop-tile__move,
	.desktop-tile__remove,
	.desktop-tile__size {
		position: absolute;
		z-index: 2;
		top: 7px;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		background: var(--ui-surface);
		color: var(--ui-muted);
	}
	/* An edit-only surface captures the whole card, including plugin content.
	 * Explicit controls remain above it; the existing gesture/keyboard handling stays shared. */
	.desktop-tile__move {
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: inherit;
		background: transparent;
		cursor: grab;
		touch-action: none;
	}
	.desktop-tile__move:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: -3px;
	}
	.is-adjusting .desktop-tile__move {
		cursor: grabbing;
	}
	.desktop-tile__remove {
		right: 7px;
		cursor: pointer;
		color: var(--ui-danger);
	}
	.desktop-tile__size {
		top: auto;
		bottom: 7px;
		left: 7px;
		width: auto;
		min-width: 44px;
		padding-inline: 7px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		color: var(--ui-primary);
	}
	.desktop-size-choices {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}
	.desktop-tile.is-editing {
		outline: 1px dashed color-mix(in srgb, var(--ui-primary) 45%, transparent);
		outline-offset: -1px;
	}
	.desktop-tile.is-editing:has(.desktop-tile__content) {
		background: color-mix(in srgb, var(--ui-surface) 54%, transparent);
	}
	.desktop-tile__resize {
		position: absolute;
		z-index: 2;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		color: var(--ui-muted);
		cursor: nwse-resize;
		width: 40px;
		height: 40px;
		right: 3px;
		bottom: 3px;
		border-radius: 10px;
		background-color: color-mix(in srgb, var(--ui-surface) 90%, transparent);
		transform: none;

		touch-action: none;
	}

	.desktop-pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		min-width: 0;
		height: 56px;
	}
	.desktop-pages {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		max-width: 100%;
		color: var(--ui-muted);
		padding: 0 6px;
		border: 1px solid color-mix(in srgb, var(--ui-border) 52%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
		box-shadow: 0 3px 16px #33224c08;
		backdrop-filter: blur(16px);
	}
	.desktop-pages :deep(button) {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		min-width: 32px;
		height: 40px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: inherit;
		box-shadow: none;
		backdrop-filter: none;
		cursor: pointer;
	}
	.desktop-pages :deep(button):disabled {
		opacity: 0.3;
		cursor: default;
	}
	.desktop-pages__list {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.desktop-pages__list :deep(button span) {
		display: grid;
		place-items: center;
		width: 25px;
		height: 25px;
		border-radius: 9px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.desktop-pages__ellipsis {
		width: 24px;
		text-align: center;
	}
	.desktop-pages__summary {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.desktop-pages :deep([aria-current='page'] span) {
		color: var(--ui-primary);
		background: color-mix(in srgb, var(--ui-primary) 13%, transparent);
		font-weight: 650;
	}
	.desktop-pages--dots {
		padding: 0 9px;
	}
	.desktop-pages--dots :deep(button) {
		min-width: 24px;
		height: 32px;
	}
	.desktop-pages--dots :deep(.desktop-pages__dot span) {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--ui-muted) 40%, transparent);
		transition:
			width var(--ui-motion-duration),
			background var(--ui-motion-duration);
	}
	.desktop-pages--dots .desktop-pages__dot--edge span {
		width: 3.5px;
		height: 3.5px;
		opacity: 0.55;
	}
	:deep(.desktop-pages__dot[aria-current='page'] span) {
		width: 18px;
		background: var(--ui-primary);
	}

	.desktop-pages__item {
		position: relative;
	}
	.desktop-pages__item.is-editing {
		margin-inline: 4px;
	}
	.desktop-pages .desktop-pages__remove {
		position: absolute;
		top: -7px;
		right: -8px;
		width: 28px;
		min-width: 28px;
		height: 28px;
	}
	.desktop-pages__list .desktop-pages__remove span {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border: 1px solid var(--ui-border);
		border-radius: 50%;
		background: var(--ui-surface);
		color: var(--ui-muted);
	}
	.desktop-pages__remove:enabled:hover span {
		color: var(--ui-primary);
		border-color: currentColor;
	}
</style>
