import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  devices,
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { loginAsInitialAdmin } from "../../support/auth";
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from "../../support/ssh";

const screenshotDir = path.resolve(__dirname, "../../../../doc/imgs/generated");

async function saveScreenshot(page: Page, filename: string): Promise<void> {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, filename),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

async function saveLocatorScreenshot(
  locator: Locator,
  filename: string,
): Promise<void> {
  await mkdir(screenshotDir, { recursive: true });
  await locator.screenshot({
    path: path.join(screenshotDir, filename),
    animations: "disabled",
    caret: "hide",
  });
}

test.describe.serial("functional documentation screenshots", () => {
  test("captures real user-facing SSH, file-management, and theme scenes", async ({
    page,
    context,
  }) => {
    await loginAsInitialAdmin(context.request);
    await configureSshE2eSettings(context.request);
    await resetTestSshFilesystem();
    const connectionId = await ensureTestSshConnection(context.request);

    await page.setViewportSize({ width: 1440, height: 900 });
    await connectTestSshFromConnectionsPage(page, connectionId);

    const terminal = page.getByTestId("terminal");
    const commandInput = page.getByTestId("command-input");
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(commandInput).toBeVisible();
    await commandInput.fill("clear");
    await commandInput.press("Enter");
    await commandInput.fill(
      "printf 'Nexus Terminal documentation screenshot\\n'",
    );
    await commandInput.press("Enter");
    await expect
      .poll(async () => terminal.locator(".xterm-rows").innerText(), {
        timeout: 15_000,
      })
      .toContain("Nexus Terminal documentation screenshot");
    await saveLocatorScreenshot(terminal, "ssh-terminal.png");

    await openConnectedFileManager(page);
    await expect(fileManagerRow(page, "README-e2e.md")).toBeVisible();
    await fileManagerRow(page, "plainfile").dblclick();
    const editor = page.getByTestId("file-editor-overlay");
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () =>
        editor.locator(".monaco-editor .view-lines").innerText(),
      )
      .toContain("plain-no-extension");
    await saveLocatorScreenshot(
      editor.locator(".editor-popup"),
      "file-manager-editor.png",
    );
    await editor.getByTestId("file-editor-close").click();
    await expect(editor).toBeHidden();

    const fileManagerModal = page.getByTestId("file-manager-modal");
    await fileManagerModal.click({ position: { x: 8, y: 8 } });
    await expect(fileManagerModal).toBeHidden();

    await page.getByTitle("Customize Style").click();
    const customizer = page.getByTestId("style-customizer");
    await expect(customizer).toBeVisible();
    await customizer.getByTestId("theme-dark-mode").click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--app-bg-color")
            .trim(),
        ),
      )
      .toBe("#212529");
    await saveLocatorScreenshot(
      customizer.locator(":scope > div").first(),
      "theme-customization.png",
    );
  });

  test("captures the mobile SSH workspace with a real mobile browser context", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await context.newPage();

    try {
      await loginAsInitialAdmin(context.request);
      await configureSshE2eSettings(context.request);
      await resetTestSshFilesystem();
      const connectionId = await ensureTestSshConnection(context.request);
      await connectTestSshFromConnectionsPage(page, connectionId);

      const terminal = page.getByTestId("terminal");
      const commandBar = page.getByTestId("command-input-bar");
      await expect(terminal).toBeVisible({ timeout: 20_000 });
      await expect(commandBar).toBeVisible();
      const commandInput = page.getByTestId("command-input");
      await commandInput.fill("clear");
      await commandInput.press("Enter");
      await commandInput.fill("printf 'Nexus mobile SSH\\n'");
      await commandInput.press("Enter");
      await expect
        .poll(async () => terminal.locator(".xterm-rows").innerText(), {
          timeout: 15_000,
        })
        .toContain("Nexus mobile SSH");
      await saveScreenshot(page, "mobile-workspace.png");
    } finally {
      await context.close();
    }
  });
});
