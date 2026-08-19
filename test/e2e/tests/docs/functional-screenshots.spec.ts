import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  devices,
  expect,
  test,
  type Page,
} from "@playwright/test";
import { loginAsInitialAdmin } from "../../support/auth";
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from "../../support/ssh";

const screenshotDir = path.resolve(__dirname, "../../../../doc/imgs/e2e");

// Documentation screenshots intentionally capture the complete visible UI viewport.
// Each scenario only needs to make the documented feature clearly visible before capture.
async function saveViewportScreenshot(
  page: Page,
  filename: string,
): Promise<void> {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, filename),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

async function dragScreenshotFiles(page: Page, count = 12): Promise<void> {
  const dataTransfer = await page.evaluateHandle((fileCount: number) => {
    const transfer = new DataTransfer();
    for (let index = 0; index < fileCount; index += 1) {
      const name = `screenshot-upload-${String(index + 1).padStart(2, "0")}.bin`;
      transfer.items.add(new File([
        new Uint8Array(4 * 1024 * 1024).fill(0x40 + (index % 20)),
      ], name, { type: "application/octet-stream" }));
    }
    return transfer;
  }, count);

  try {
    const list = activeFileManagerList(page);
    await list.dispatchEvent("dragenter", { dataTransfer });
    const overlay = page.getByTestId("file-upload-drop-overlay");
    await expect(overlay).toBeVisible();
    await overlay.dispatchEvent("drop", { dataTransfer });
    await expect(overlay).toBeHidden();
  } finally {
    await dataTransfer.dispose();
  }
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
    await saveViewportScreenshot(page, "ssh-terminal.png");

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
    await saveViewportScreenshot(page, "file-manager-editor.png");
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
    await saveViewportScreenshot(page, "theme-customization.png");
  });

  test("captures upload progress and the full-width hidden task card", async ({
    page,
    context,
  }) => {
    await loginAsInitialAdmin(context.request);
    await configureSshE2eSettings(context.request);
    await resetTestSshFilesystem();
    const connectionId = await ensureTestSshConnection(context.request);

    await page.setViewportSize({ width: 1440, height: 900 });
    await connectTestSshFromConnectionsPage(page, connectionId);
    await openConnectedFileManager(page);
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=260`, { method: "POST" });

    try {
      await dragScreenshotFiles(page);
      const popup = page.getByTestId("file-upload-progress-popup");
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup.getByTestId("file-upload-speed")).toBeVisible();
      await expect(popup.getByTestId("file-upload-progress-hide")).toBeVisible();
      await expect(popup.getByTestId("file-upload-cancel-all")).toBeVisible();
      await page.waitForTimeout(700);
      await saveViewportScreenshot(page, "upload-progress.png");

      await popup.getByTestId("file-upload-progress-hide").click();
      await expect(popup).toBeHidden();
      await page.getByTestId("transfer-progress-toggle").click();
      const progressDisplay = page.getByTestId("progress-display-modal");
      await expect(progressDisplay).toBeVisible();
      const sourceCard = progressDisplay.getByTestId("hidden-progress-source").first();
      await expect(sourceCard).toBeVisible();
      const [sourceCardBox, hiddenListBox] = await Promise.all([
        sourceCard.boundingBox(),
        progressDisplay.getByTestId("hidden-progress-list").boundingBox(),
      ]);
      expect(sourceCardBox).not.toBeNull();
      expect(hiddenListBox).not.toBeNull();
      expect(sourceCardBox!.width).toBeGreaterThanOrEqual(hiddenListBox!.width - 2);
      await saveViewportScreenshot(page, "hidden-upload-progress.png");

      await sourceCard.getByTestId("hidden-progress-cancel-all").click();
      await expect(sourceCard).toBeHidden({ timeout: 10_000 });
    } finally {
      await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: "POST" });
    }
  });

  test("captures mobile SSH touch workflows with a real mobile browser context", async ({
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
      await saveViewportScreenshot(page, "mobile-workspace.png");

      await commandBar.locator("button:has(i.fa-bolt)").click();
      const quickCommands = page.getByTestId("quick-commands-view");
      await expect(quickCommands).toBeVisible();
      await expect(quickCommands.getByTestId("quick-command-add")).toBeVisible();
      await saveViewportScreenshot(page, "mobile-quick-commands.png");
      await page.keyboard.press("Escape");
      await expect(quickCommands).toBeHidden();

      await page.getByTestId("open-status-monitor-button").click();
      const statusModal = page.getByTestId("status-monitor-modal");
      await expect(statusModal).toBeVisible();
      await expect(statusModal.getByTestId("status-monitor")).toContainText(
        "Nexus Virtual CPU",
        { timeout: 15_000 },
      );
      await saveViewportScreenshot(page, "mobile-status-monitor.png");
      await statusModal.locator("button").first().click();
      await expect(statusModal).toBeHidden();

      await openConnectedFileManager(page);
      const fileManagerModal = page.getByTestId("file-manager-modal");
      await saveViewportScreenshot(page, "mobile-file-manager.png");

      const archiveRow = fileManagerRow(page, "archive-source.txt");
      const archiveBox = await archiveRow.boundingBox();
      expect(archiveBox).not.toBeNull();
      const archivePoint = {
        x: archiveBox!.x + archiveBox!.width / 2,
        y: archiveBox!.y + archiveBox!.height / 2,
      };
      await archiveRow.dispatchEvent("pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: archivePoint.x,
        clientY: archivePoint.y,
      });
      await page.waitForTimeout(620);
      await archiveRow.dispatchEvent("pointerup", {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: archivePoint.x,
        clientY: archivePoint.y,
      });
      const touchContextMenu = page.getByTestId("file-manager-context-menu");
      await expect(touchContextMenu).toBeVisible();
      await expect(
        touchContextMenu.getByText("Compress to zip", { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("file-manager-context-submenu")).toHaveCount(0);
      await saveViewportScreenshot(page, "mobile-context-menu.png");
      await touchContextMenu.getByText("Refresh", { exact: true }).click();
      await expect(touchContextMenu).toBeHidden();

      await fileManagerRow(page, "plainfile").click();
      const editor = page.getByTestId("file-editor-overlay");
      await expect(editor).toBeVisible({ timeout: 20_000 });
      await expect(editor.locator(".codemirror-mobile-editor-container")).toBeVisible();
      await expect
        .poll(async () => editor.locator(".cm-content").innerText(), {
          timeout: 15_000,
        })
        .toContain("plain-no-extension");
      await saveViewportScreenshot(page, "mobile-file-editor.png");

      await editor.getByTitle("Search").click();
      const mobileSearchPanel = editor.locator(".cm-panel.cm-search");
      await expect(mobileSearchPanel).toBeVisible();
      await mobileSearchPanel.locator('input[name="search"]').fill("plain-no-extension");
      await expect
        .poll(async () => editor.locator(".cm-searchMatch").count(), {
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
      await saveViewportScreenshot(page, "mobile-editor-search.png");
      await editor.getByTestId("file-editor-close").click();
      await expect(editor).toBeHidden();

      await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=260`, { method: "POST" });
      try {
        await fileManagerModal.getByTestId("file-upload-input").setInputFiles({
          name: "mobile-screenshot-upload.bin",
          mimeType: "application/octet-stream",
          buffer: Buffer.alloc(12 * 1024 * 1024, 0x4d),
        });
        const mobileUploadPopup = page.getByTestId("file-upload-progress-popup");
        await expect(mobileUploadPopup).toBeVisible({ timeout: 10_000 });
        await expect(mobileUploadPopup.getByTestId("file-upload-speed")).toBeVisible();
        await expect(mobileUploadPopup.getByTestId("file-upload-cancel-all")).toBeVisible();
        await page.waitForTimeout(500);
        await saveViewportScreenshot(page, "mobile-upload-progress.png");
        await mobileUploadPopup.getByTestId("file-upload-cancel-all").click();
        await expect(mobileUploadPopup).toBeHidden({ timeout: 10_000 });
      } finally {
        await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: "POST" });
      }

      await fileManagerModal.click({ position: { x: 8, y: 8 } });
      await expect(fileManagerModal).toBeHidden();

      await commandBar.locator("button:has(i.fa-keyboard)").click();
      const virtualKeyboard = page.locator(
        ".mobile-virtual-keyboard.virtual-keyboard-bar",
      );
      await expect(virtualKeyboard).toBeVisible();
      await expect(
        virtualKeyboard.getByRole("button", { name: "Ctrl", exact: true }),
      ).toBeVisible();
      await saveViewportScreenshot(page, "mobile-virtual-keyboard.png");
    } finally {
      await context.close();
    }
  });

  test("captures system and security settings as full-interface feature scenes", async ({
    page,
    context,
  }) => {
    await loginAsInitialAdmin(context.request);
    const language = await context.request.put("/api/v1/settings", {
      data: { language: "en-US", timezone: "UTC" },
    });
    expect(language.ok()).toBeTruthy();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings");

    await page.getByTestId("settings-tab-system").click();
    await expect(page.locator("#languageSelect")).toBeVisible();
    await expect(page.locator("#timezoneSelect")).toBeVisible();
    await saveViewportScreenshot(page, "system-settings.png");

    await page.getByTestId("settings-tab-security").click();
    await expect(page.getByTestId("change-password-settings")).toBeVisible();
    await expect(page.getByTestId("captcha-settings")).toBeVisible();
    await saveViewportScreenshot(page, "security-settings.png");
  });
});
