import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

const e2eRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(__dirname, 'functional-screenshot-manifest.json');
const defaultOutputDir = path.join(e2eRoot, '.tmp', 'functional-screenshots');
let manifestPromise: Promise<Set<string>> | null = null;

export const functionalScreenshotsEnabled = (): boolean =>
  /^(1|true|yes)$/i.test(process.env.E2E_CAPTURE_SCREENSHOTS ?? '');

async function screenshotManifest(): Promise<Set<string>> {
  manifestPromise ??= readFile(manifestPath, 'utf8').then((raw) => new Set(JSON.parse(raw) as string[]));
  return manifestPromise;
}

function screenshotOutputDir(): string {
  const configured = process.env.E2E_SCREENSHOT_OUTPUT_DIR?.trim();
  if (!configured) return defaultOutputDir;
  return path.isAbsolute(configured) ? configured : path.resolve(e2eRoot, configured);
}

export async function captureFunctionalScreenshot(
  page: Page,
  filename: string,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<boolean> {
  if (!functionalScreenshotsEnabled()) return false;

  const manifest = await screenshotManifest();
  if (!manifest.has(filename)) {
    throw new Error(`Functional screenshot ${filename} is not listed in ${path.basename(manifestPath)}`);
  }

  const outputDir = screenshotOutputDir();
  await mkdir(outputDir, { recursive: true });

  const originalViewport = page.viewportSize();
  const targetViewport = options.viewport;
  const shouldRestoreViewport = Boolean(
    targetViewport &&
    originalViewport &&
    (originalViewport.width !== targetViewport.width || originalViewport.height !== targetViewport.height),
  );

  if (targetViewport && shouldRestoreViewport) {
    await page.setViewportSize(targetViewport);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  }

  try {
    await page.screenshot({
      path: path.join(outputDir, filename),
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    });
  } finally {
    if (shouldRestoreViewport && originalViewport) {
      await page.setViewportSize(originalViewport);
    }
  }

  return true;
}
