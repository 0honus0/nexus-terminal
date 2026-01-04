import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { EDGE_CASE_DATA } from '../fixtures/test-data';

test.describe('连接管理边缘场景测试', () => {
  test.describe('连接超时处理', () => {
    test('连接到不可达主机应显示超时错误', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 点击新建连接
      await workspace.newConnectionButton.click();

      // 填写无效连接信息
      await authenticatedPage.fill('input[name="name"]', EDGE_CASE_DATA.invalidConnection.name);
      await authenticatedPage.fill('input[name="host"]', EDGE_CASE_DATA.invalidConnection.host);
      await authenticatedPage.fill(
        'input[name="port"]',
        EDGE_CASE_DATA.invalidConnection.port.toString()
      );
      await authenticatedPage.fill(
        'input[name="username"]',
        EDGE_CASE_DATA.invalidConnection.username
      );
      await authenticatedPage.fill(
        'input[name="password"]',
        EDGE_CASE_DATA.invalidConnection.password
      );

      // 保存连接
      await authenticatedPage.click('button:has-text("保存"), button:has-text("Save")');

      // 尝试连接
      await authenticatedPage.dblclick(`text=${EDGE_CASE_DATA.invalidConnection.name}`);

      // 应该显示超时或连接失败错误
      await expect(
        authenticatedPage.locator('text=/连接失败|Connection failed|Timeout|超时/i')
      ).toBeVisible({
        timeout: 30000,
      });
    });

    test('连接建立后网络断开应触发重连机制', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 假设有一个有效连接
      const firstConnection = authenticatedPage.locator(
        '.connection-list .connection-item:first-child'
      );
      if (await firstConnection.isVisible()) {
        await firstConnection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 模拟网络断开
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(5000);

        // 应该显示断连状态
        await expect(
          authenticatedPage.locator('[data-status="disconnected"], .connection-status-disconnected')
        ).toBeVisible({ timeout: 10000 });

        // 恢复网络
        await context.setOffline(false);

        // 应该尝试自动重连
        await expect(
          authenticatedPage.locator('[data-status="reconnecting"], text=/重连|Reconnecting/i')
        ).toBeVisible({ timeout: 5000 });
      }
    });

    test('连接中取消操作应正常工作', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 创建一个慢连接
      await workspace.newConnectionButton.click();
      await authenticatedPage.fill('input[name="name"]', 'Slow Connection Test');
      await authenticatedPage.fill('input[name="host"]', EDGE_CASE_DATA.shortTimeout.host);
      await authenticatedPage.fill('input[name="port"]', '22');
      await authenticatedPage.fill('input[name="username"]', 'test');
      await authenticatedPage.fill('input[name="password"]', 'test');
      await authenticatedPage.click('button:has-text("保存")');

      // 开始连接
      await authenticatedPage.dblclick('text=Slow Connection Test');

      // 立即点击取消
      const cancelButton = authenticatedPage.locator(
        'button:has-text("取消"), button:has-text("Cancel")'
      );
      if (await cancelButton.isVisible({ timeout: 2000 })) {
        await cancelButton.click();

        // 验证连接已取消
        await expect(workspace.terminalContainer).not.toBeVisible();
      }
    });
  });

  test.describe('无效凭证处理', () => {
    test('SSH 密码错误应显示认证失败', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      await workspace.newConnectionButton.click();
      await authenticatedPage.fill('input[name="name"]', 'Invalid Credentials Test');
      await authenticatedPage.fill('input[name="host"]', 'localhost');
      await authenticatedPage.fill('input[name="port"]', '22');
      await authenticatedPage.fill('input[name="username"]', 'nonexistent');
      await authenticatedPage.fill('input[name="password"]', 'wrong-password');
      await authenticatedPage.click('button:has-text("保存")');

      await authenticatedPage.dblclick('text=Invalid Credentials Test');

      // 应该显示认证失败
      await expect(
        authenticatedPage.locator('text=/认证失败|Authentication failed|Permission denied/i')
      ).toBeVisible({ timeout: 15000 });
    });

    test('SSH 密钥文件不存在应提示错误', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      await workspace.newConnectionButton.click();
      await authenticatedPage.fill('input[name="name"]', 'Invalid Key Test');
      await authenticatedPage.fill('input[name="host"]', 'localhost');
      await authenticatedPage.fill('input[name="port"]', '22');
      await authenticatedPage.fill('input[name="username"]', 'test');

      // 选择密钥认证
      await authenticatedPage.click('text=密钥认证, text=Key Authentication');
      await authenticatedPage.fill('input[name="privateKey"]', '/nonexistent/key.pem');

      await authenticatedPage.click('button:has-text("保存")');
      await authenticatedPage.dblclick('text=Invalid Key Test');

      // 应该显示密钥文件错误
      await expect(
        authenticatedPage.locator('text=/密钥文件|Key file|not found|找不到/i')
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('代理连接场景', () => {
    test.skip('通过无效代理连接应失败', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 先创建一个无效代理
      await authenticatedPage.goto('/proxies');
      await authenticatedPage.click('button:has-text("添加代理")');
      await authenticatedPage.fill('input[name="name"]', 'Invalid Proxy');
      await authenticatedPage.fill('input[name="host"]', EDGE_CASE_DATA.invalidConnection.host);
      await authenticatedPage.fill('input[name="port"]', '1080');
      await authenticatedPage.click('button:has-text("保存")');

      // 回到工作区
      await workspace.goto();
      await workspace.newConnectionButton.click();
      await authenticatedPage.fill('input[name="name"]', 'Proxy Connection Test');
      await authenticatedPage.fill('input[name="host"]', 'localhost');
      await authenticatedPage.selectOption('select[name="proxyId"]', { label: 'Invalid Proxy' });
      await authenticatedPage.click('button:has-text("保存")');

      await authenticatedPage.dblclick('text=Proxy Connection Test');

      // 应该显示代理连接失败
      await expect(
        authenticatedPage.locator('text=/代理连接失败|Proxy connection failed/i')
      ).toBeVisible({
        timeout: 30000,
      });
    });

    test.skip('代理中途断开应有提示', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 假设已有通过代理的连接
      const proxyConnection = authenticatedPage.locator('[data-proxy="true"]');
      if (await proxyConnection.isVisible()) {
        await proxyConnection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 模拟代理断开
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(3000);

        await expect(authenticatedPage.locator('text=/代理断开|Proxy disconnected/i')).toBeVisible({
          timeout: 10000,
        });

        await context.setOffline(false);
      }
    });
  });

  test.describe('并发连接限制', () => {
    test.skip('同时打开过多连接应有限制', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 尝试打开10个连接
      const connections = await authenticatedPage
        .locator('.connection-list .connection-item')
        .all();
      const maxConnections = Math.min(connections.length, 10);

      for (let i = 0; i < maxConnections; i++) {
        await connections[i].dblclick();
        await authenticatedPage.waitForTimeout(500);
      }

      // 应该显示连接数限制提示
      await expect(
        authenticatedPage.locator('text=/连接数已达上限|Maximum connections reached/i')
      ).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('连接配置验证', () => {
    test('端口号超出范围应提示错误', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      await workspace.newConnectionButton.click();
      await authenticatedPage.fill('input[name="name"]', 'Invalid Port Test');
      await authenticatedPage.fill('input[name="host"]', 'localhost');
      await authenticatedPage.fill('input[name="port"]', '99999'); // 超出有效范围

      // 应该显示验证错误
      await expect(
        authenticatedPage.locator('.el-form-item__error, [role="alert"]:has-text("端口")')
      ).toBeVisible();
    });

    test('主机名为空应禁用保存按钮', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      await workspace.newConnectionButton.click();
      await authenticatedPage.fill('input[name="name"]', 'Empty Host Test');
      await authenticatedPage.fill('input[name="host"]', '');

      const saveButton = authenticatedPage.locator(
        'button:has-text("保存"), button:has-text("Save")'
      );
      await expect(saveButton).toBeDisabled();
    });

    test('用户名包含特殊字符应正常处理', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      await workspace.newConnectionButton.click();
      await authenticatedPage.fill('input[name="name"]', 'Special Username Test');
      await authenticatedPage.fill('input[name="host"]', 'localhost');
      await authenticatedPage.fill('input[name="username"]', 'user@domain.com');
      await authenticatedPage.fill('input[name="password"]', 'password');

      const saveButton = authenticatedPage.locator('button:has-text("保存")');
      await expect(saveButton).toBeEnabled();
      await saveButton.click();

      // 应该成功保存
      await expect(authenticatedPage.locator('text=Special Username Test')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe('连接重连策略', () => {
    test.skip('自动重连次数达到上限后停止', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 持续模拟网络不稳定
        for (let i = 0; i < 5; i++) {
          await context.setOffline(true);
          await authenticatedPage.waitForTimeout(2000);
          await context.setOffline(false);
          await authenticatedPage.waitForTimeout(2000);
        }

        // 应该显示放弃重连的提示
        await expect(
          authenticatedPage.locator('text=/重连失败|Reconnection failed|已停止重连/i')
        ).toBeVisible({ timeout: 10000 });
      }
    });

    test.skip('手动重连按钮功能正常', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator('.connection-list .connection-item:first-child');
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 断开连接
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(5000);
        await context.setOffline(false);

        // 点击手动重连
        const reconnectButton = authenticatedPage.locator(
          'button:has-text("重连"), button:has-text("Reconnect")'
        );
        await reconnectButton.click();

        // 应该开始重连
        await expect(
          authenticatedPage.locator('[data-status="connected"], [data-status="reconnecting"]')
        ).toBeVisible({ timeout: 15000 });
      }
    });
  });
});
