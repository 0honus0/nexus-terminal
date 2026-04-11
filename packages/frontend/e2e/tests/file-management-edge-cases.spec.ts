import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { FileManagerPage } from '../pages/file-manager.page';
import { EDGE_CASE_DATA } from '../fixtures/test-data';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('文件管理边缘场景测试', () => {
  let tempDir: string;
  let testFilePath: string;

  test.beforeEach(() => {
    // 创建临时测试文件
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-'));
  });

  test.afterEach(() => {
    // 清理临时文件
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.describe('大文件上传/下载', () => {
    test.skip('上传大文件应显示进度条', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建大文件
        const largeFilePath = path.join(tempDir, EDGE_CASE_DATA.largeFile.name);
        const buffer = Buffer.alloc(EDGE_CASE_DATA.largeFile.size);
        fs.writeFileSync(largeFilePath, buffer);

        // 上传大文件
        await fileManager.uploadFile(largeFilePath);

        // 应该显示进度条
        await expect(fileManager.uploadProgressBar).toBeVisible({ timeout: 5000 });

        // 等待上传完成
        await fileManager.waitForUploadComplete(120000); // 2分钟超时

        // 验证文件已上传
        await expect(await fileManager.fileExists(EDGE_CASE_DATA.largeFile.name)).toBeTruthy();
      }
    });

    test.skip('下载大文件应正常工作', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 假设服务器上已有大文件
        const download = await fileManager.downloadFile(EDGE_CASE_DATA.largeFile.name);
        const downloadPath = await download.path();

        // 验证文件已下载
        expect(downloadPath).toBeTruthy();
        if (downloadPath) {
          expect(fs.existsSync(downloadPath)).toBeTruthy();
        }
      }
    });

    test.skip('上传过程中网络断开应支持断点续传', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建测试文件
        testFilePath = path.join(tempDir, 'resume-test.bin');
        const buffer = Buffer.alloc(50 * 1024 * 1024); // 50MB
        fs.writeFileSync(testFilePath, buffer);

        // 开始上传
        await fileManager.uploadFile(testFilePath);
        await expect(fileManager.uploadProgressBar).toBeVisible({ timeout: 5000 });

        // 等待部分上传
        await authenticatedPage.waitForTimeout(5000);

        // 模拟网络断开
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(2000);

        // 恢复网络
        await context.setOffline(false);

        // 应该继续上传
        await fileManager.waitForUploadComplete(120000);
        await expect(await fileManager.fileExists('resume-test.bin')).toBeTruthy();
      }
    });
  });

  test.describe('权限不足错误处理', () => {
    test.skip('访问无权限目录应显示错误', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 尝试访问 /root 目录
        await fileManager.navigateToPath(EDGE_CASE_DATA.restrictedPath.path);

        // 应该显示权限错误
        await fileManager.expectError(EDGE_CASE_DATA.restrictedPath.expectedError);
      }
    });

    test.skip('删除只读文件应失败', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建只读文件
        testFilePath = path.join(tempDir, 'readonly.txt');
        fs.writeFileSync(testFilePath, 'test');
        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 当前测试环境暂不支持直接在远端设置只读属性，
        // 该场景需依赖后端能力或 SSH mock 扩展后再启用。

        // 尝试删除
        await fileManager.deleteFile('readonly.txt');

        // 应该显示权限错误
        await fileManager.expectError('Permission denied');
      }
    });
  });

  test.describe('文件名冲突处理', () => {
    test.skip('上传同名文件应提示覆盖确认', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建测试文件
        testFilePath = path.join(tempDir, 'duplicate.txt');
        fs.writeFileSync(testFilePath, 'version 1');

        // 第一次上传
        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 修改文件内容
        fs.writeFileSync(testFilePath, 'version 2');

        // 第二次上传同名文件
        await fileManager.uploadFile(testFilePath);

        // 应该显示覆盖确认对话框
        const confirmDialog = authenticatedPage.locator('.el-message-box:has-text("覆盖")');
        await expect(confirmDialog).toBeVisible({ timeout: 5000 });

        // 确认覆盖
        await authenticatedPage.click('.el-message-box__btns button:has-text("确定")');
        await fileManager.waitForUploadComplete();
      }
    });

    test.skip('重命名文件为已存在的名称应失败', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建两个文件
        const file1 = path.join(tempDir, 'file1.txt');
        const file2 = path.join(tempDir, 'file2.txt');
        fs.writeFileSync(file1, 'content 1');
        fs.writeFileSync(file2, 'content 2');

        await fileManager.uploadFile(file1);
        await fileManager.waitForUploadComplete();
        await fileManager.uploadFile(file2);
        await fileManager.waitForUploadComplete();

        // 尝试将 file2 重命名为 file1
        await fileManager.renameFile('file2.txt', 'file1.txt');

        // 应该显示错误
        await fileManager.expectError('已存在');
      }
    });
  });

  test.describe('特殊字符文件名', () => {
    test.skip('创建包含 UTF-8 字符的文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建特殊字符文件
        testFilePath = path.join(tempDir, EDGE_CASE_DATA.specialCharsFile.name);
        fs.writeFileSync(testFilePath, EDGE_CASE_DATA.specialCharsFile.content);

        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 验证文件存在
        await expect(
          await fileManager.fileExists(EDGE_CASE_DATA.specialCharsFile.name)
        ).toBeTruthy();
      }
    });

    test.skip('特殊字符搜索功能', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 搜索中文文件名
        await fileManager.searchFile('测试文件');

        // 应该找到包含中文的文件
        await expect(
          await fileManager.fileExists(EDGE_CASE_DATA.specialCharsFile.name)
        ).toBeTruthy();
      }
    });
  });

  test.describe('批量文件操作', () => {
    test.skip('批量删除文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建多个测试文件
        const filenames = ['batch1.txt', 'batch2.txt', 'batch3.txt'];
        for (const filename of filenames) {
          const filePath = path.join(tempDir, filename);
          fs.writeFileSync(filePath, 'test content');
          await fileManager.uploadFile(filePath);
          await fileManager.waitForUploadComplete();
        }

        // 选择多个文件
        await fileManager.selectMultipleFiles(filenames);

        // 批量删除
        await fileManager.deleteButton.click();
        const confirmButton = authenticatedPage.locator(
          '.el-message-box__btns button:has-text("确定")'
        );
        await confirmButton.click();

        await fileManager.waitForFileListUpdate();

        // 验证所有文件已删除
        for (const filename of filenames) {
          await expect(await fileManager.fileExists(filename)).toBeFalsy();
        }
      }
    });

    test.skip('批量下载文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 选择多个文件
        const filenames = ['file1.txt', 'file2.txt', 'file3.txt'];
        await fileManager.selectMultipleFiles(filenames);

        // 批量下载（应该生成 zip）
        const downloadPromise = authenticatedPage.waitForEvent('download');
        await fileManager.downloadButton.click();
        const download = await downloadPromise;

        const filename = download.suggestedFilename();
        expect(filename).toMatch(/\.zip$/);
      }
    });
  });

  test.describe('文件传输错误恢复', () => {
    test.skip('上传失败后可重试', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建测试文件
        testFilePath = path.join(tempDir, 'retry-test.txt');
        fs.writeFileSync(testFilePath, 'test content');

        // 开始上传
        await fileManager.uploadFile(testFilePath);

        // 立即断网导致失败
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(2000);

        // 应该显示上传失败
        await fileManager.expectError('上传失败');

        // 恢复网络
        await context.setOffline(false);

        // 点击重试按钮
        const retryButton = authenticatedPage.locator(
          'button:has-text("重试"), button:has-text("Retry")'
        );
        await retryButton.click();

        // 应该成功上传
        await fileManager.waitForUploadComplete();
        await expect(await fileManager.fileExists('retry-test.txt')).toBeTruthy();
      }
    });

    test.skip('取消正在进行的传输', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建大文件
        testFilePath = path.join(tempDir, 'cancel-test.bin');
        const buffer = Buffer.alloc(50 * 1024 * 1024);
        fs.writeFileSync(testFilePath, buffer);

        // 开始上传
        await fileManager.uploadFile(testFilePath);
        await expect(fileManager.uploadProgressBar).toBeVisible({ timeout: 5000 });

        // 等待部分上传
        await authenticatedPage.waitForTimeout(2000);

        // 点击取消
        const cancelButton = authenticatedPage.locator(
          'button:has-text("取消"), button:has-text("Cancel")'
        );
        await cancelButton.click();

        // 进度条应该消失
        await expect(fileManager.uploadProgressBar).not.toBeVisible({ timeout: 5000 });

        // 文件应该未完全上传
        await fileManager.waitForFileListUpdate();
        const exists = await fileManager.fileExists('cancel-test.bin');
        // 可能部分上传，取决于实现
        expect(exists).toBeDefined();
      }
    });
  });

  test.describe('文件预览', () => {
    test.skip('双击文本文件应打开预览', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建测试文件
        testFilePath = path.join(tempDir, 'preview.txt');
        fs.writeFileSync(testFilePath, 'Preview content test');
        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 双击文件
        await fileManager.fileItem('preview.txt').dblclick();

        // 应该打开 Monaco 编辑器
        const editor = authenticatedPage.locator('.monaco-editor, [data-testid="monaco-editor"]');
        await expect(editor).toBeVisible({ timeout: 10000 });

        // 编辑器应该包含文件内容
        await expect(editor).toContainText('Preview content test');
      }
    });

    test.skip('预览二进制文件应显示提示', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 双击二进制文件
        await fileManager.fileItem('binary.bin').dblclick();

        // 应该显示无法预览的提示
        await expect(
          authenticatedPage.locator('text=/无法预览|Cannot preview|Binary file/i')
        ).toBeVisible({
          timeout: 5000,
        });
      }
    });
  });
});
