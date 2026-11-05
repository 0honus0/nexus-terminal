import { expect, type Locator } from '@playwright/test';

/** Read rendered sRGB colors, including alpha over the catalog's ancestor fills. */
export async function expectReadableCatalogText(locator: Locator): Promise<string> {
	await expect(locator).toBeVisible();
	const sample = await locator.evaluate((element) => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Missing color sampling canvas');
		context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color');
		context.fillRect(0, 0, 1, 1);
		const ancestors: Element[] = [];
		for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
		for (const node of ancestors) {
			context.fillStyle = getComputedStyle(node).backgroundColor;
			context.fillRect(0, 0, 1, 1);
		}
		const background = context.getImageData(0, 0, 1, 1).data;
		context.fillStyle = getComputedStyle(element).color;
		context.fillRect(0, 0, 1, 1);
		const foreground = context.getImageData(0, 0, 1, 1).data;

		const luminance = (bytes: Uint8ClampedArray) => {
			const channels = Array.from(bytes)
				.slice(0, 3)
				.map((value) => {
					const channel = value / 255;
					return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
				});
			return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
		};

		const first = luminance(foreground);
		const second = luminance(background);
		return {
			color: Array.from(foreground).slice(0, 3).join(','),
			contrast: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
		};
	});
	expect(sample.contrast, `Catalog text contrast (${sample.color})`).toBeGreaterThanOrEqual(4.5);
	return sample.color;
}
