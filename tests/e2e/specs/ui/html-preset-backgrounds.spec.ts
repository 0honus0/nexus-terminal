import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';

test('built-in HTML backgrounds keep dark base colors and fit their viewport', async ({ page }) => {
  const directory = path.resolve(__dirname, '../../../../assets/html-themes/local');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.html'));
  expect(names.length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 640, height: 360 });
  for (const name of names) {
    const html = await readFile(path.join(directory, name), 'utf8');
    await page.setContent(`<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}</style>${html}`);
    const geometry = await page.evaluate(() => {
      const root = document.querySelector('body > div')!;
      const style = getComputedStyle(root);
      const bounds = root.getBoundingClientRect();
      return {
        background: style.backgroundColor,
        image: style.backgroundImage,
        width: bounds.width,
        height: bounds.height,
        overflow: document.body.scrollWidth - document.body.clientWidth,
      };
    });
    expect(geometry.width, name).toBe(640);
    expect(geometry.height, name).toBe(360);
    expect(geometry.overflow, name).toBe(0);
    if (['缓动气泡.html', '精致光点.html'].includes(name)) {
      expect(geometry.image, name).toContain('rgb(9, 10, 13)');
      expect(geometry.image, name).toContain('rgb(16, 17, 22)');
    } else {
      expect(geometry.background, name).toBe(name === '代码雨.html' ? 'rgb(0, 0, 0)' : 'rgb(9, 10, 13)');
    }
  }
});
