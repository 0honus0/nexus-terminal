import { GridStackEngine, type GridStackNode } from 'gridstack';
import { useStorage } from '@vueuse/core';
import { shallowRef } from 'vue';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { LayoutProfiles, LayoutProfileSchema, type LayoutProfile } from '../../layout/layout-api.js';
import type { LogApi } from '../../log/browser/log-api.js';

import type { WindowApplication } from '../../window/browser/window-api.js';

export { default as DesktopShell } from './DesktopShell.vue';

const TileSchema = z.strictObject({
	key: z.string(),
	label: z.string(),
	x: z.int().nonnegative(),
	y: z.int().nonnegative(),
	w: z.int().min(1).max(12),
	h: z.int().min(1).max(5),
});

const PageSchema = z.strictObject({ id: z.string(), tiles: z.array(TileSchema) });

const ProfileSchema = z.strictObject({
	pages: z.array(PageSchema).min(1),
	hidden: z.array(z.string()),
	current: z.string(),
});

const DesktopLayoutSchema = z.record(LayoutProfileSchema, ProfileSchema);

export type DesktopTile = z.infer<typeof TileSchema>;

export type DesktopPage = z.infer<typeof PageSchema>;

type DesktopLayout = z.infer<typeof DesktopLayoutSchema>;

export interface DesktopTileProps {
	readonly size: { readonly columns: number; readonly rows: number };
	open(): void;
}

export interface DesktopApplication extends WindowApplication {
	readonly tileSize?: { readonly w: number; readonly h: number };
}

const desktopRows = 5;

function emptyLayout(): DesktopLayout {
	const empty = () => ({ pages: [{ id: 'home', tiles: [] }], hidden: [], current: 'home' });

	return { compact: empty(), medium: empty(), wide: empty() };
}

function findPosition(tiles: readonly DesktopTile[], size: Pick<DesktopTile, 'w' | 'h'>, columns: number) {
	const engine = new GridStackEngine({ column: columns, nodes: tiles.map((tile) => ({ ...tile })) });
	const candidate: GridStackNode = { ...size };
	if (
		size.w > columns ||
		!engine.findEmptyPosition(candidate) ||
		candidate.x === undefined ||
		candidate.y === undefined
	)
		return;
	if (candidate.y + size.h <= desktopRows) return { x: candidate.x, y: candidate.y };
}

function validatePages(pages: readonly DesktopPage[], columns: number): boolean {
	const keys = new Set<string>();
	const ids = new Set<string>();
	return pages.every(({ id, tiles }) => {
		if (ids.has(id)) return false;
		ids.add(id);
		return tiles.every((tile, index) => {
			if (keys.has(tile.key) || tile.x + tile.w > columns || tile.y + tile.h > desktopRows) return false;
			keys.add(tile.key);
			return !tiles
				.slice(0, index)
				.some(
					(other) =>
						tile.x < other.x + other.w &&
						other.x < tile.x + tile.w &&
						tile.y < other.y + other.h &&
						other.y < tile.y + tile.h,
				);
		});
	});
}

/** 保存分档中的用户布局。插件暂时缺席时保留格位，视口变化不写入。 */
export class DesktopApi {
	readonly rows = desktopRows;
	readonly #layout = shallowRef(emptyLayout());
	readonly #saved;
	readonly #report;
	#readFailed = false;
	readonly pins;

	constructor(log: Pick<LogApi, 'report'>) {
		this.#report = (code: string, userVisible = false) =>
			log.report({ source: 'desktop', code, level: 'warn', userVisible });
		this.#saved = useStorage<DesktopLayout | null>('nexus.desktop.pages', null, undefined, {
			writeDefaults: false,
			listenToStorageChanges: false,
			deep: false,
			serializer: {
				read: (raw) => {
					try {
						const layout = DesktopLayoutSchema.parse(JSON.parse(raw));
						for (const profile of LayoutProfileSchema.options)
							if (!validatePages(layout[profile].pages, LayoutProfiles[profile].columns))
								throw new Error('DESKTOP_LAYOUT_INVALID');
						return layout;
					} catch (cause) {
						this.#readFailed = true;
						throw cause;
					}
				},

				write: JSON.stringify,
			},

			onError: () => this.#report('DESKTOP_STORAGE_UNAVAILABLE'),
		});
		this.#layout.value = this.#saved.value ?? this.#layout.value;
		this.pins = useStorage<string[]>('nexus.desktop.pins', [], undefined, {
			writeDefaults: false,
			listenToStorageChanges: false,
			serializer: {
				read: (raw) => z.array(z.string()).parse(JSON.parse(raw)),

				write: JSON.stringify,
			},

			onError: () => this.#report('DESKTOP_STORAGE_UNAVAILABLE'),
		});
	}

	get(profile: LayoutProfile) {
		return this.#layout.value[profile];
	}

	page(profile: LayoutProfile): DesktopPage {
		const { pages, current } = this.get(profile);
		return pages.find(({ id }) => id === current) ?? pages[0]!;
	}

	ensure(profile: LayoutProfile, tiles: readonly Omit<DesktopTile, 'x' | 'y'>[]): void {
		for (const tile of tiles) this.add(profile, tile, false);
	}

	add(profile: LayoutProfile, tile: Omit<DesktopTile, 'x' | 'y'>, explicit = true): void {
		const layout = this.get(profile);
		if (
			(!explicit && layout.hidden.includes(tile.key)) ||
			layout.pages.some(({ tiles }) => tiles.some(({ key }) => key === tile.key))
		)
			return;
		const columns = LayoutProfiles[profile].columns;
		const size = { ...tile, w: Math.min(tile.w, columns) };
		const preferred = this.page(profile);
		for (const page of [preferred, ...layout.pages.filter((item) => item !== preferred)]) {
			const position = findPosition(page.tiles, size, columns);
			if (!position) continue;
			this.#set(
				profile,
				{
					...layout,
					current: explicit ? page.id : layout.current,
					hidden: layout.hidden.filter((key) => key !== tile.key),
					pages: layout.pages.map((item) =>
						item === page ? { ...item, tiles: [...item.tiles, { ...size, ...position }] } : item,
					),
				},
				explicit,
			);
			return;
		}
		const id = uuid();
		this.#set(
			profile,
			{
				...layout,
				current: explicit ? id : layout.current,
				hidden: layout.hidden.filter((key) => key !== tile.key),
				pages: [...layout.pages, { id, tiles: [{ ...size, x: 0, y: 0 }] }],
			},
			explicit,
		);
	}

	isTileVisible(key: string): boolean {
		return LayoutProfileSchema.options.some((profile) =>
			this.get(profile).pages.some(({ tiles }) => tiles.some((tile) => tile.key === key)),
		);
	}

	setTileVisible(key: string, label: string, visible: boolean, size?: DesktopApplication['tileSize']): void {
		for (const profile of LayoutProfileSchema.options) {
			if (visible) {
				const current = this.page(profile).id;
				this.add(profile, { key, label, w: profile === 'compact' ? 1 : (size?.w ?? 2), h: size?.h ?? 1 });
				this.selectPage(profile, current);
			} else this.remove(profile, key);
		}
	}

	setTiles(profile: LayoutProfile, pageId: string, tiles: DesktopTile[]): void {
		const layout = this.get(profile);
		const pages = layout.pages.map((page) => (page.id === pageId ? { ...page, tiles } : page));
		if (validatePages(pages, LayoutProfiles[profile].columns)) this.#set(profile, { ...layout, pages });
	}

	remove(profile: LayoutProfile, key: string): void {
		const layout = this.get(profile);
		this.#set(profile, {
			...layout,
			hidden: [...new Set([...layout.hidden, key])],
			pages: layout.pages.map((page) => ({ ...page, tiles: page.tiles.filter((tile) => tile.key !== key) })),
		});
	}

	selectPage(profile: LayoutProfile, id: string): void {
		const layout = this.get(profile);
		if (layout.current !== id && layout.pages.some((page) => page.id === id))
			this.#set(profile, { ...layout, current: id }, false);
	}

	addPage(profile: LayoutProfile): void {
		const layout = this.get(profile);
		const id = uuid();
		this.#set(profile, { ...layout, current: id, pages: [...layout.pages, { id, tiles: [] }] });
	}

	moveTile(profile: LayoutProfile, key: string, destination: string): boolean {
		const layout = this.get(profile);
		const source = layout.pages.find((page) => page.tiles.some((tile) => tile.key === key));
		const target = layout.pages.find((page) => page.id === destination);
		const tile = source?.tiles.find((item) => item.key === key);
		if (!tile || !target || source === target) return false;
		const position = findPosition(target.tiles, tile, LayoutProfiles[profile].columns);
		if (!position) {
			this.#report('DESKTOP_PAGE_FULL', true);
			return false;
		}
		const pages = layout.pages.map((page) => {
			if (page === source) return { ...page, tiles: page.tiles.filter((item) => item !== tile) };
			if (page === target) return { ...page, tiles: [...page.tiles, { ...tile, ...position }] };
			return page;
		});
		this.#set(profile, { ...layout, pages });
		return true;
	}

	removePage(profile: LayoutProfile, id: string): void {
		const layout = this.get(profile);
		const removed = layout.pages.find((page) => page.id === id);
		if (!removed || layout.pages.length <= 1) return;
		const remaining = layout.pages
			.filter((page) => page !== removed)
			.map((page) => ({ ...page, tiles: [...page.tiles] }));
		if (!remaining.length) return;
		const columns = LayoutProfiles[profile].columns;
		for (const tile of [...removed.tiles].sort((a, b) => b.w * b.h - a.w * a.h)) {
			let placed = false;
			for (const page of remaining) {
				const position = findPosition(page.tiles, tile, columns);
				if (!position) continue;
				page.tiles.push({ ...tile, ...position });
				placed = true;
				break;
			}
			if (!placed) {
				this.#report('DESKTOP_PAGE_FULL', true);
				return;
			}
		}
		this.#set(profile, {
			...layout,
			current: id === this.page(profile).id ? remaining[0]!.id : layout.current,
			pages: remaining,
		});
	}

	togglePin(key: string): void {
		this.pins.value = this.pins.value.includes(key)
			? this.pins.value.filter((value) => value !== key)
			: [...this.pins.value, key];
	}

	#set(profile: LayoutProfile, value: DesktopLayout[LayoutProfile], explicit = true): void {
		this.#layout.value = { ...this.#layout.value, [profile]: value };
		if (explicit) this.#readFailed = false;
		if (!this.#readFailed) this.#saved.value = this.#layout.value;
	}
}
