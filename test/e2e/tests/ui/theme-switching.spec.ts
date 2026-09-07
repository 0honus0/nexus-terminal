import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { ensureInitialAdmin, loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

async function appBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim());
}

async function documentThemeColor(page: Page): Promise<string | null> {
  return page.locator('meta[name="theme-color"]').getAttribute('content');
}

const HTML_THEME_NAME = 'E2E Appearance Local HTML Theme.html';
const HTML_THEME_RENAMED = 'E2E Appearance Local HTML Theme Renamed.html';
const HTML_THEME_CONTENT = '<div class="e2e-appearance-theme">M06 local HTML theme</div>';
const DEFAULT_OFFICIAL_HTML_THEME_REPOSITORY =
  'https://github.com/0honus0/nexus-terminal/tree/main/assets/html-themes/remote';
const LEGACY_OFFICIAL_HTML_THEME_REPOSITORY =
  'https://github.com/0honus0/nexus-terminal/tree/main/doc/custom_html_theme';
const TESTED_GIT_REF =
  process.env.GITHUB_SHA?.trim() || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const TESTED_OFFICIAL_HTML_THEME_REPOSITORY = `https://github.com/0honus0/nexus-terminal/tree/${TESTED_GIT_REF}/assets/html-themes/remote`;
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZpmIAAAAASUVORK5CYII=',
  'base64',
);
const LEGACY_DARK_UI_THEME_WITHOUT_INPUT_TOKENS: Record<string, string> = {
  '--app-bg-color': '#212529',
  '--text-color': '#e9ecef',
  '--text-color-secondary': '#adb5bd',
  '--border-color': '#495057',
  '--link-color': '#BB86FC',
  '--link-hover-color': '#D1A9FF',
  '--link-active-color': '#A06CD5',
  '--link-active-bg-color': 'rgba(160, 108, 213, 0.2)',
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)',
  '--header-bg-color': '#343a40',
  '--footer-bg-color': '#343a40',
  '--button-bg-color': 'var(--link-active-color)',
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#8E44AD',
  '--icon-color': 'var(--text-color-secondary)',
  '--icon-hover-color': 'var(--link-hover-color)',
  '--split-line-color': 'var(--border-color)',
  '--split-line-hover-color': 'var(--border-color)',
  '--input-focus-border-color': 'var(--link-active-color)',
  '--input-focus-glow': 'var(--link-active-color)',
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.8)',
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};

async function appearance(request: APIRequestContext): Promise<Record<string, unknown>> {
  const response = await request.get('/api/v1/appearance');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

async function cleanupHtmlThemes(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/appearance/html-presets/local');
  expect(response.ok()).toBeTruthy();
  const themes = (await response.json()) as Array<{ name: string; type: string }>;
  for (const theme of themes.filter(
    (item) => item.type === 'custom' && [HTML_THEME_NAME, HTML_THEME_RENAMED].includes(item.name),
  )) {
    expect(
      (await request.delete(`/api/v1/appearance/html-presets/local/${encodeURIComponent(theme.name)}`)).ok(),
    ).toBeTruthy();
  }
}

test.describe('fresh installation appearance defaults', () => {
  test.use({ e2eDatabaseMode: 'empty' });

  test('official remote HTML theme repository defaults to the shipped remote asset path', async ({ request }) => {
    await ensureInitialAdmin(request);
    await loginAsInitialAdmin(request);
    await expect
      .poll(async () => (await appearance(request)).remoteHtmlPresetsUrl)
      .toBe(DEFAULT_OFFICIAL_HTML_THEME_REPOSITORY);
  });
});

test('PWA window title bar color updates immediately and persists across reload', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();

  const originalResponse = await context.request.get('/api/v1/appearance');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as { windowThemeColor?: string };
  const targetColor = '#1F2937';

  let releaseStaleLoads: (() => void) | undefined;
  const staleLoadsReleased = new Promise<void>((resolve) => {
    releaseStaleLoads = resolve;
  });
  let markStaleLoadStarted: (() => void) | undefined;
  const staleLoadStarted = new Promise<void>((resolve) => {
    markStaleLoadStarted = resolve;
  });
  let holdAppearanceLoads = true;
  let heldLoadCount = 0;
  let fulfilledHeldLoadCount = 0;

  await page.route('**/api/v1/appearance', async (route) => {
    if (route.request().method() !== 'GET' || !holdAppearanceLoads) {
      await route.continue();
      return;
    }
    const backendResponse = await route.fetch();
    heldLoadCount += 1;
    markStaleLoadStarted?.();
    await staleLoadsReleased;
    await route.fulfill({ response: backendResponse });
    fulfilledHeldLoadCount += 1;
  });

  try {
    await page.goto('/settings');
    await staleLoadStarted;
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();

    const input = page.getByTestId('window-theme-color-input');
    await expect(input).toBeVisible();
    await input.fill(targetColor);

    const savePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
    );
    await page.getByTestId('window-theme-color-save').click();
    expect((await savePromise).ok()).toBeTruthy();
    await expect.poll(() => documentThemeColor(page)).toBe(targetColor);

    holdAppearanceLoads = false;
    releaseStaleLoads?.();
    await expect.poll(() => fulfilledHeldLoadCount).toBe(heldLoadCount);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(input).toHaveValue(targetColor);
    await expect.poll(() => documentThemeColor(page)).toBe(targetColor);

    const persisted = await context.request.get('/api/v1/appearance');
    expect(persisted.ok()).toBeTruthy();
    expect(((await persisted.json()) as { windowThemeColor?: string }).windowThemeColor).toBe(targetColor);

    await page.unrouteAll({ behavior: 'wait' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(page.getByTestId('window-theme-color-input')).toHaveValue(targetColor);
    await expect.poll(() => documentThemeColor(page)).toBe(targetColor);
  } finally {
    holdAppearanceLoads = false;
    releaseStaleLoads?.();
    await page.unrouteAll({ behavior: 'wait' });
    const restore = await context.request.put('/api/v1/appearance', {
      data: { windowThemeColor: original.windowThemeColor ?? '#343A40' },
    });
    expect(restore.ok()).toBeTruthy();
  }
});

test('UI theme switches to dark mode, persists across reload, and resets to default', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();
  await page.goto('/');

  await step('Dark Mode applies immediately and is persisted by the appearance API', async () => {
    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    await expect(customizer).toBeVisible();
    await customizer.getByTestId('theme-dark-mode').click();
    await expect.poll(() => appBackground(page)).toBe('#212529');

    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    try {
      const lastVisibleThemeRow = customizer.getByText('Link active bg color:', { exact: true }).locator('..');
      const footer = customizer.locator('footer');
      await expect(lastVisibleThemeRow).toBeVisible();
      const [rowBox, footerBox] = await Promise.all([lastVisibleThemeRow.boundingBox(), footer.boundingBox()]);
      expect(rowBox).toBeTruthy();
      expect(footerBox).toBeTruthy();
      expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);

      await captureFunctionalScreenshot(page, 'theme-customization.png', { viewport: { width: 1440, height: 900 } });
    } finally {
      if (originalViewport) await page.setViewportSize(originalViewport);
    }

    const response = await context.request.get('/api/v1/appearance');
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { customUiTheme?: string };
    expect(JSON.parse(body.customUiTheme || '{}')['--app-bg-color']).toBe('#212529');
  });

  await step('Dark Mode survives a full page reload', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => appBackground(page), { timeout: 15_000 }).toBe('#212529');
  });

  await step('Default Mode restores the default theme and persists the reset', async () => {
    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    await customizer.getByTestId('theme-default-mode').click();
    await expect.poll(() => appBackground(page)).toBe('#ffffff');

    const response = await context.request.get('/api/v1/appearance');
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { customUiTheme?: string };
    expect(JSON.parse(body.customUiTheme || '{}')['--app-bg-color']).toBe('#ffffff');
  });
});

test('legacy dark UI themes without input tokens keep Dashboard controls readable and normalize on save', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();
  const original = await appearance(context.request);

  try {
    const legacyTheme = await context.request.put('/api/v1/appearance', {
      data: { customUiTheme: JSON.stringify(LEGACY_DARK_UI_THEME_WITHOUT_INPUT_TOKENS) },
    });
    expect(legacyTheme.ok()).toBeTruthy();

    await page.goto('/');
    await expect.poll(() => appBackground(page)).toBe('#212529');

    const search = page.getByTestId('dashboard-connection-search');
    const tag = page.getByTestId('dashboard-tag-filter');
    const sort = page.getByTestId('dashboard-sort-by');
    await expect(search).toBeVisible();
    await expect(tag).toBeVisible();
    await expect(sort).toBeVisible();

    const searchColors = await search.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      text: getComputedStyle(node).color,
      placeholder: getComputedStyle(node, '::placeholder').color,
    }));
    expect(searchColors).toEqual({
      background: 'rgb(30, 41, 59)',
      text: 'rgb(248, 250, 252)',
      placeholder: 'rgb(148, 163, 184)',
    });

    for (const control of [tag, sort]) {
      await expect
        .poll(() =>
          control.evaluate((node) => {
            const style = getComputedStyle(node);
            return [style.backgroundColor, style.color];
          }),
        )
        .toEqual(['rgb(30, 41, 59)', 'rgb(248, 250, 252)']);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => appBackground(page)).toBe('#212529');
    await expect
      .poll(() =>
        page.getByTestId('dashboard-connection-search').evaluate((node) => {
          const style = getComputedStyle(node);
          return [style.backgroundColor, style.color];
        }),
      )
      .toEqual(['rgb(30, 41, 59)', 'rgb(248, 250, 252)']);

    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    const jsonEditor = customizer.getByTestId('ui-theme-json');
    await expect(jsonEditor).toBeVisible();
    const normalizedDraft = JSON.parse(await jsonEditor.inputValue()) as Record<string, string>;
    expect(normalizedDraft['--input-bg-color']).toBe('#1e293b');
    expect(normalizedDraft['--input-text-color']).toBe('#f8fafc');
    expect(normalizedDraft['--input-placeholder-color']).toBe('#94a3b8');

    const save = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
    );
    await customizer.getByTestId('ui-theme-save').click();
    expect((await save).ok()).toBeTruthy();
    const persisted = await appearance(context.request);
    const persistedTheme = JSON.parse(String(persisted.customUiTheme ?? '{}')) as Record<string, string>;
    expect(persistedTheme['--input-bg-color']).toBe('#1e293b');
    expect(persistedTheme['--input-text-color']).toBe('#f8fafc');
    expect(persistedTheme['--input-placeholder-color']).toBe('#94a3b8');
  } finally {
    const restore = await context.request.put('/api/v1/appearance', {
      data: { customUiTheme: original.customUiTheme },
    });
    expect(restore.ok()).toBeTruthy();
  }
});

test('terminal preset themes load from the API, switch through the UI, and persist across reload', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();

  const originalAppearanceResponse = await context.request.get('/api/v1/appearance');
  expect(originalAppearanceResponse.ok()).toBeTruthy();
  const originalAppearance = (await originalAppearanceResponse.json()) as { activeTerminalThemeId?: number | null };

  const themesResponse = await context.request.get('/api/v1/terminal-themes');
  expect(themesResponse.ok()).toBeTruthy();
  const themes = (await themesResponse.json()) as Array<{ id?: string; name: string; preset?: boolean }>;

  // Pick a preset that is intentionally not part of the compact frontend sample list.
  // Its presence proves the UI is using the backend seed/API as the runtime source of truth.
  const targetTheme = themes.find((theme) => theme.name === 'zenwritten_light' && theme.preset);
  expect(targetTheme?.id).toBeTruthy();
  const targetThemeId = Number(targetTheme!.id);
  expect(Number.isInteger(targetThemeId) && targetThemeId > 0).toBeTruthy();

  try {
    await page.goto('/');

    await step('backend-only preset is discoverable and can be applied through the style customizer', async () => {
      await page.getByTitle('Customize Style').click();
      const customizer = page.getByTestId('style-customizer');
      await expect(customizer).toBeVisible();
      await customizer.getByTestId('style-customizer-terminal-tab').click();

      const search = customizer.getByTestId('terminal-theme-search');
      await search.fill(targetTheme!.name);
      const themeRow = customizer.getByTestId(`terminal-theme-row-${targetThemeId}`);
      await expect(themeRow).toHaveCount(1);
      await expect(themeRow).toBeVisible();

      const savePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
      );
      await themeRow.getByTestId('terminal-theme-apply').click();
      expect((await savePromise).ok()).toBeTruthy();

      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/appearance');
          expect(response.ok()).toBeTruthy();
          return ((await response.json()) as { activeTerminalThemeId?: number | null }).activeTerminalThemeId;
        })
        .toBe(targetThemeId);

      const activeThemeName = customizer.getByTestId('terminal-active-theme-name');
      await expect(activeThemeName).toHaveText(targetTheme!.name);
    });

    await step('selected terminal preset survives a full page reload', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTitle('Customize Style').click();
      const customizer = page.getByTestId('style-customizer');
      await customizer.getByTestId('style-customizer-terminal-tab').click();

      const activeThemeName = customizer.getByTestId('terminal-active-theme-name');
      await expect(activeThemeName).toHaveText(targetTheme!.name);

      const response = await context.request.get('/api/v1/appearance');
      expect(response.ok()).toBeTruthy();
      expect(((await response.json()) as { activeTerminalThemeId?: number | null }).activeTerminalThemeId).toBe(
        targetThemeId,
      );
    });
  } finally {
    const restore = await context.request.put('/api/v1/appearance', {
      data: { activeTerminalThemeId: originalAppearance.activeTerminalThemeId ?? null },
    });
    expect(restore.ok()).toBeTruthy();
  }
});

test('style customizer keeps mobile geometry stable and persists custom UI, independent typography, and text effects', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
  const original = await appearance(context.request);

  try {
    await page.setViewportSize({ width: 320, height: 667 });
    await page.goto('/');
    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    const dialog = customizer.getByTestId('style-customizer-dialog');
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(320);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(668);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    await step('custom UI JSON persists through the one Appearance owner', async () => {
      await customizer.getByTestId('ui-theme-json').fill(
        JSON.stringify(
          {
            '--app-bg-color': '#f1f2f3',
            '--text-color': '#202122',
            '--link-active-color': '#6750a4',
          },
          null,
          2,
        ),
      );
      const save = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
      );
      await customizer.getByTestId('ui-theme-save').click();
      expect((await save).ok()).toBeTruthy();
      await expect.poll(() => appBackground(page)).toBe('#f1f2f3');
      const persisted = await appearance(context.request);
      const theme = JSON.parse(String(persisted.customUiTheme ?? '{}')) as Record<string, string>;
      expect(theme['--app-bg-color']).toBe('#f1f2f3');
      expect(theme['--link-active-color']).toBe('#6750a4');
    });

    await step('desktop and mobile terminal typography plus text effects persist independently', async () => {
      await customizer.getByTestId('style-customizer-terminal-tab').click();
      await customizer.getByTestId('terminal-font-family').fill('E2E Terminal Mono, monospace');
      await customizer.getByTestId('terminal-font-size-desktop').fill('17');
      await customizer.getByTestId('terminal-font-size-mobile').fill('23');
      const terminalFontSave = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
      );
      await customizer.getByTestId('terminal-font-save').click();
      expect((await terminalFontSave).ok()).toBeTruthy();

      await customizer.getByTestId('terminal-text-stroke-enabled').check();
      await customizer.getByTestId('terminal-text-stroke-width').fill('1.5');
      await customizer.getByTestId('terminal-text-stroke-color').fill('#112233');
      await customizer.getByTestId('terminal-text-shadow-enabled').check();
      await customizer.getByTestId('terminal-text-shadow-x').fill('1');
      await customizer.getByTestId('terminal-text-shadow-y').fill('2');
      await customizer.getByTestId('terminal-text-shadow-blur').fill('3');
      await customizer.getByTestId('terminal-text-shadow-color').fill('rgba(4,5,6,0.7)');
      const textEffectsSave = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
      );
      await customizer.getByTestId('terminal-text-effects-save').click();
      expect((await textEffectsSave).ok()).toBeTruthy();

      await expect
        .poll(async () => {
          const value = await appearance(context.request);
          return [
            value.terminalFontFamily,
            value.terminalFontSize,
            value.terminalFontSizeMobile,
            value.terminalTextStrokeEnabled,
            value.terminalTextStrokeWidth,
            value.terminalTextShadowEnabled,
            value.terminalTextShadowBlur,
          ];
        })
        .toEqual(['E2E Terminal Mono, monospace', 17, 23, true, 1.5, true, 3]);
    });

    await step('desktop and mobile editor typography persist independently and survive reload', async () => {
      await customizer.getByTestId('style-customizer-other-tab').click();
      await customizer.getByTestId('editor-font-family').fill('E2E Editor Mono, monospace');
      await customizer.getByTestId('editor-font-size-desktop').fill('15');
      await customizer.getByTestId('editor-font-size-mobile').fill('21');
      await customizer.getByTestId('editor-font-save').click();
      await expect
        .poll(async () => {
          const value = await appearance(context.request);
          return [value.editorFontFamily, value.editorFontSize, value.mobileEditorFontSize];
        })
        .toEqual(['E2E Editor Mono, monospace', 15, 21]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTitle('Customize Style').click();
      const reloaded = page.getByTestId('style-customizer');
      await reloaded.getByTestId('style-customizer-terminal-tab').click();
      await expect(reloaded.getByTestId('terminal-font-size-desktop')).toHaveValue('17');
      await expect(reloaded.getByTestId('terminal-font-size-mobile')).toHaveValue('23');
      await reloaded.getByTestId('style-customizer-other-tab').click();
      await expect(reloaded.getByTestId('editor-font-size-desktop')).toHaveValue('15');
      await expect(reloaded.getByTestId('editor-font-size-mobile')).toHaveValue('21');
    });
  } finally {
    await context.request.put('/api/v1/appearance', {
      data: {
        customUiTheme: original.customUiTheme,
        terminalFontFamily: original.terminalFontFamily,
        terminalFontSize: original.terminalFontSize,
        terminalFontSizeMobile: original.terminalFontSizeMobile,
        editorFontFamily: original.editorFontFamily,
        editorFontSize: original.editorFontSize,
        mobileEditorFontSize: original.mobileEditorFontSize,
        terminalTextStrokeEnabled: original.terminalTextStrokeEnabled,
        terminalTextStrokeWidth: original.terminalTextStrokeWidth,
        terminalTextStrokeColor: original.terminalTextStrokeColor,
        terminalTextShadowEnabled: original.terminalTextShadowEnabled,
        terminalTextShadowOffsetX: original.terminalTextShadowOffsetX,
        terminalTextShadowOffsetY: original.terminalTextShadowOffsetY,
        terminalTextShadowBlur: original.terminalTextShadowBlur,
        terminalTextShadowColor: original.terminalTextShadowColor,
      },
    });
  }
});

test('background and HTML appearance flows stay reachable on mobile and preserve the current appearance on remote failure', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
  await cleanupHtmlThemes(context.request);
  const original = await appearance(context.request);
  expect(original.pageBackgroundImage ?? null).toBeNull();
  expect(original.terminalBackgroundImage ?? null).toBeNull();
  expect(
    (
      await context.request.put('/api/v1/appearance/html-presets/remote/repository-url', {
        data: { url: null },
      })
    ).ok(),
  ).toBeTruthy();

  try {
    await page.setViewportSize({ width: 320, height: 667 });
    await page.goto('/');
    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    await customizer.getByTestId('style-customizer-background-tab').click();
    await expect(customizer.getByTestId('page-background-settings')).toBeVisible();

    await step('page and terminal background uploads persist and remain inside the mobile viewport', async () => {
      const pageUpload = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/appearance/background/page') && response.request().method() === 'POST',
      );
      await customizer.getByTestId('page-background-file').setInputFiles({
        name: 'm06-page.png',
        mimeType: 'image/png',
        buffer: ONE_PIXEL_PNG,
      });
      expect((await pageUpload).ok()).toBeTruthy();
      await expect.poll(async () => Boolean((await appearance(context.request)).pageBackgroundImage)).toBeTruthy();
      await expect.poll(() => page.evaluate(() => document.body.style.backgroundImage)).not.toBe('none');

      const overlay = customizer.getByTestId('terminal-background-overlay');
      await overlay.fill('0.37');
      await expect(overlay).toHaveValue('0.37');

      const terminalUpload = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/appearance/background/terminal') && response.request().method() === 'POST',
      );
      await customizer.getByTestId('terminal-background-file').setInputFiles({
        name: 'm06-terminal.png',
        mimeType: 'image/png',
        buffer: ONE_PIXEL_PNG,
      });
      expect((await terminalUpload).ok()).toBeTruthy();
      await expect.poll(async () => Boolean((await appearance(context.request)).terminalBackgroundImage)).toBeTruthy();
      await expect(overlay).toHaveValue('0.37');

      await customizer.getByTestId('terminal-background-overlay-save').click();
      await expect.poll(async () => (await appearance(context.request)).terminalBackgroundOverlayOpacity).toBe(0.37);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);
    });

    await step('local HTML preset create, duplicate conflict, apply, rename, and delete use the real API', async () => {
      await customizer.getByTestId('html-theme-add').click();
      const editor = page.getByRole('dialog').filter({ has: page.getByTestId('html-theme-preset-name') });
      await expect(editor).toBeVisible();
      await editor.getByTestId('html-theme-preset-name').fill(HTML_THEME_NAME.replace(/\.html$/, ''));
      await editor.getByTestId('html-theme-preset-content').fill(HTML_THEME_CONTENT);
      const create = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/appearance/html-presets/local') && response.request().method() === 'POST',
      );
      await editor.getByTestId('html-theme-preset-save').click();
      expect((await create).status()).toBe(201);
      await expect(editor).toBeHidden();

      await customizer.getByTestId('html-theme-local-search').fill('E2E Appearance Local');
      let row = customizer.getByTestId(`html-theme-local-row-${HTML_THEME_NAME}`);
      await expect(row).toBeVisible();
      const apply = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
      );
      await row.getByTestId('html-theme-apply').click();
      expect((await apply).ok()).toBeTruthy();
      await expect.poll(async () => (await appearance(context.request)).terminalCustomHtml).toBe(HTML_THEME_CONTENT);

      await customizer.getByTestId('html-theme-add').click();
      const duplicate = page.getByRole('dialog').filter({ has: page.getByTestId('html-theme-preset-name') });
      await duplicate.getByTestId('html-theme-preset-name').fill(HTML_THEME_NAME.replace(/\.html$/, ''));
      await duplicate.getByTestId('html-theme-preset-content').fill('<div>must not overwrite</div>');
      const conflict = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/appearance/html-presets/local') && response.request().method() === 'POST',
      );
      await duplicate.getByTestId('html-theme-preset-save').click();
      expect((await conflict).status()).toBe(400);
      await expect(duplicate).toBeVisible();
      const originalContent = await context.request.get(
        `/api/v1/appearance/html-presets/local/${encodeURIComponent(HTML_THEME_NAME)}`,
      );
      expect(originalContent.ok()).toBeTruthy();
      expect(await originalContent.text()).toBe(HTML_THEME_CONTENT);
      await duplicate.getByRole('button', { name: 'Cancel', exact: true }).click();

      row = customizer.getByTestId(`html-theme-local-row-${HTML_THEME_NAME}`);
      await row.getByTestId('html-theme-edit').click();
      const rename = page.getByRole('dialog').filter({ has: page.getByTestId('html-theme-preset-name') });
      await rename.getByTestId('html-theme-preset-name').fill(HTML_THEME_RENAMED.replace(/\.html$/, ''));
      await rename.getByTestId('html-theme-preset-save').click();
      await expect(rename).toBeHidden();
      await customizer.getByTestId('html-theme-local-search').fill('Renamed');
      row = customizer.getByTestId(`html-theme-local-row-${HTML_THEME_RENAMED}`);
      await expect(row).toBeVisible();
      await row.getByTestId('html-theme-delete').click();
      const confirm = page.getByRole('dialog', { name: 'Please confirm' });
      await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(row).toHaveCount(0);
    });

    await step(
      'real GitHub remote preset list, search, download, and apply persist through the Appearance owner',
      async () => {
        const repository = TESTED_OFFICIAL_HTML_THEME_REPOSITORY;
        await customizer.getByTestId('html-theme-remote-tab').click();
        await customizer.getByTestId('html-theme-remote-repository').fill(repository);
        const saveRepository = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/v1/appearance/html-presets/remote/repository-url') &&
            response.request().method() === 'PUT',
        );
        await customizer.getByTestId('html-theme-remote-save').click();
        expect((await saveRepository).ok()).toBeTruthy();
        await expect.poll(async () => (await appearance(context.request)).remoteHtmlPresetsUrl).toBe(repository);

        const listRemote = page.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/appearance/html-presets/remote/list') &&
            response.request().method() === 'GET',
        );
        await customizer.getByTestId('html-theme-remote-load').click();
        expect((await listRemote).ok()).toBeTruthy();
        await customizer.getByTestId('html-theme-remote-search').fill('丝带');
        const remoteRow = customizer.getByTestId('html-theme-remote-row-丝带.html');
        await expect(remoteRow).toBeVisible();

        const remoteContent = page.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/appearance/html-presets/remote/content') &&
            response.request().method() === 'GET',
        );
        const apply = page.waitForResponse(
          (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
        );
        await remoteRow.getByTestId('html-theme-remote-apply').click();
        const downloaded = await remoteContent;
        expect(downloaded.ok()).toBeTruthy();
        const downloadedHtml = await downloaded.text();
        expect(downloadedHtml.length).toBeGreaterThan(20);
        expect((await apply).ok()).toBeTruthy();
        await expect.poll(async () => (await appearance(context.request)).terminalCustomHtml).toBe(downloadedHtml);
      },
    );

    await step('legacy official HTML theme repository URLs normalize and still list the current catalog', async () => {
      const legacyList = await context.request.get('/api/v1/appearance/html-presets/remote/list', {
        params: { repoUrl: LEGACY_OFFICIAL_HTML_THEME_REPOSITORY },
      });
      expect(legacyList.ok()).toBeTruthy();
      const remoteThemes = (await legacyList.json()) as Array<{ name?: string }>;
      expect(remoteThemes.some((theme) => theme.name === '丝带.html')).toBeTruthy();

      const saveLegacy = await context.request.put('/api/v1/appearance/html-presets/remote/repository-url', {
        data: { url: LEGACY_OFFICIAL_HTML_THEME_REPOSITORY },
      });
      expect(saveLegacy.ok()).toBeTruthy();
      await expect
        .poll(async () => (await appearance(context.request)).remoteHtmlPresetsUrl)
        .toBe(DEFAULT_OFFICIAL_HTML_THEME_REPOSITORY);

      const restoreTestedRef = await context.request.put('/api/v1/appearance/html-presets/remote/repository-url', {
        data: { url: TESTED_OFFICIAL_HTML_THEME_REPOSITORY },
      });
      expect(restoreTestedRef.ok()).toBeTruthy();
      await expect
        .poll(async () => (await appearance(context.request)).remoteHtmlPresetsUrl)
        .toBe(TESTED_OFFICIAL_HTML_THEME_REPOSITORY);
    });

    await step(
      'invalid remote repository loading fails without changing the applied HTML and clearing the URL disables the list',
      async () => {
        const repository = TESTED_OFFICIAL_HTML_THEME_REPOSITORY;
        const before = (await appearance(context.request)).terminalCustomHtml;
        await customizer
          .getByTestId('html-theme-remote-repository')
          .fill('https://example.com/not-a-github-repository');
        const invalidSave = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/v1/appearance/html-presets/remote/repository-url') &&
            response.request().method() === 'PUT',
        );
        await customizer.getByTestId('html-theme-remote-save').click();
        expect((await invalidSave).status()).toBe(400);
        expect((await appearance(context.request)).remoteHtmlPresetsUrl).toBe(repository);
        const load = page.waitForResponse((response) =>
          response.url().includes('/api/v1/appearance/html-presets/remote/list'),
        );
        await customizer.getByTestId('html-theme-remote-load').click();
        expect((await load).status()).toBe(400);
        expect((await appearance(context.request)).terminalCustomHtml).toBe(before);

        await customizer.getByTestId('html-theme-remote-repository').fill('');
        const clearSave = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/v1/appearance/html-presets/remote/repository-url') &&
            response.request().method() === 'PUT',
        );
        await customizer.getByTestId('html-theme-remote-save').click();
        expect((await clearSave).ok()).toBeTruthy();
        await expect.poll(async () => (await appearance(context.request)).remoteHtmlPresetsUrl ?? null).toBeNull();
        await expect(customizer.getByTestId('html-theme-remote-load')).toBeDisabled();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
          .toBeLessThanOrEqual(1);
      },
    );

    await step('uploaded backgrounds are really removed and page CSS is cleared', async () => {
      await customizer.getByTestId('style-customizer-background-tab').click();
      const pageDelete = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/appearance/background/page') && response.request().method() === 'DELETE',
      );
      await customizer.getByTestId('page-background-remove').click();
      expect((await pageDelete).ok()).toBeTruthy();
      await expect.poll(async () => Boolean((await appearance(context.request)).pageBackgroundImage)).toBeFalsy();
      await expect.poll(() => page.evaluate(() => document.body.style.backgroundImage)).toBe('none');

      const terminalDelete = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/appearance/background/terminal') && response.request().method() === 'DELETE',
      );
      await customizer.getByTestId('terminal-background-remove').click();
      expect((await terminalDelete).ok()).toBeTruthy();
      await expect.poll(async () => Boolean((await appearance(context.request)).terminalBackgroundImage)).toBeFalsy();
    });
  } finally {
    await cleanupHtmlThemes(context.request);
    await context.request.put('/api/v1/appearance/html-presets/remote/repository-url', {
      data: { url: original.remoteHtmlPresetsUrl ?? null },
    });
    await context.request.put('/api/v1/appearance', {
      data: {
        terminalBackgroundEnabled: original.terminalBackgroundEnabled,
        terminalBackgroundOverlayOpacity: original.terminalBackgroundOverlayOpacity,
        terminalCustomHtml: original.terminalCustomHtml,
      },
    });
  }
});

test('PWA resources, favicon, manifest, and service worker bootstrap resolve from stable current URLs', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await page.goto('/');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#[0-9A-Fa-f]{6}$/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /logo/);

  const resources = await page.evaluate(async () => {
    const urls = [
      '/manifest.json',
      '/sw.js',
      '/icons/icon-144x144.png',
      '/icons/icon-192x192.png',
      '/icons/icon-512x512.png',
    ];
    return Promise.all(
      urls.map(async (url) => {
        const response = await fetch(url, { cache: 'no-store' });
        return { url, status: response.status };
      }),
    );
  });
  expect(resources).toEqual([
    { url: '/manifest.json', status: 200 },
    { url: '/sw.js', status: 200 },
    { url: '/icons/icon-144x144.png', status: 200 },
    { url: '/icons/icon-192x192.png', status: 200 },
    { url: '/icons/icon-512x512.png', status: 200 },
  ]);

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!('serviceWorker' in navigator)) return '';
          const registration = await navigator.serviceWorker.getRegistration();
          return (
            registration?.active?.scriptURL ||
            registration?.waiting?.scriptURL ||
            registration?.installing?.scriptURL ||
            ''
          );
        }),
      { timeout: 15_000 },
    )
    .toContain('/sw.js?v=4');
});
