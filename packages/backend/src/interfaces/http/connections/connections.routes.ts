import { Router } from 'express';
import multer from 'multer';
import type { ConnectionExportService } from '../../../modules/connections/connection-export.service';
import type {
  CreateConnectionInput,
  UnsavedSshConnectionInput,
  UpdateConnectionInput,
} from '../../../modules/connections/connection.types';
import type { ConnectionService } from '../../../modules/connections/connection.service';
import type { SshConnectionTestService } from '../../../modules/connections/services/ssh-connection-test.service';
import type { ProxyService } from '../../../modules/proxies/proxy.service';
import type { RemoteDesktopSessionService } from '../../../modules/remote-desktop/remote-desktop-session.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { importConnections } from './connection-import';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

export interface ConnectionsRouterDependencies {
  connections: ConnectionService;
  connectionExport: ConnectionExportService;
  proxies: ProxyService;
  sshConnectionTest: SshConnectionTestService;
  remoteDesktop: RemoteDesktopSessionService;
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype === 'application/json' || file.originalname.toLowerCase().endsWith('.json')) callback(null, true);
    else callback(new Error('只允许上传 JSON 文件。'));
  },
});

const statusForConnectionError = (message: string): number => {
  if (message.includes('未找到')) return 404;
  if (
    message.includes('缺少') ||
    message.includes('需要') ||
    message.includes('必须') ||
    message.includes('无效') ||
    message.includes('不能同时') ||
    message.includes('不能为空')
  )
    return 400;
  if (message.includes('已存在')) return 409;
  return 500;
};

const displayOptions = (query: Record<string, unknown>) => ({
  width: typeof query.width === 'string' ? Number(query.width) : undefined,
  height: typeof query.height === 'string' ? Number(query.height) : undefined,
  dpi: typeof query.dpi === 'string' ? Number(query.dpi) : undefined,
});

export const createConnectionsRouter = (dependencies: ConnectionsRouterDependencies): Router => {
  const router = Router();
  router.use(requireAuthenticated);

  // Concrete routes must remain before /:id.
  router.get(
    '/export',
    route(async (_request, response) => {
      const bytes = await dependencies.connectionExport.export(false);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      response.setHeader('Content-Type', 'application/zip');
      response.setHeader('Content-Disposition', `attachment; filename="nexus-terminal-connections-${timestamp}.zip"`);
      response.send(Buffer.from(bytes));
    }),
  );

  router.post(
    '/import',
    importUpload.single('connectionsFile'),
    route(async (request, response) => {
      if (!request.file?.buffer) {
        response.status(400).json({ message: '未找到上传的文件 (需要名为 "connectionsFile" 的文件)。' });
        return;
      }
      try {
        const result = await importConnections(request.file.buffer, {
          connections: dependencies.connections,
          proxies: dependencies.proxies,
        });
        response.status(result.failureCount > 0 ? 400 : 200).json({
          message:
            result.failureCount > 0
              ? `导入完成，但存在 ${result.failureCount} 个错误。成功导入 ${result.successCount} 条。`
              : `导入成功完成。共导入 ${result.successCount} 条连接。`,
          ...result,
        });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('解析 JSON 文件失败') ? 400 : 500).json({ message });
      }
    }),
  );

  router.post(
    '/test-unsaved',
    route(async (request, response) => {
      const body = request.body as Partial<CreateConnectionInput>;
      if (!body?.host || !Number.isInteger(body.port) || !body.username || !body.authMethod) {
        response
          .status(400)
          .json({ success: false, message: '缺少必要的连接信息 (host, port, username, authMethod)。' });
        return;
      }
      if (body.authMethod === 'password' && body.password === undefined) {
        response.status(400).json({ success: false, message: '密码认证方式需要提供 password 字段 (可以为空字符串)。' });
        return;
      }
      if (body.authMethod === 'key' && !body.sshKeyId && !body.privateKey) {
        response.status(400).json({ success: false, message: '密钥认证方式需要提供 sshKeyId 或 privateKey。' });
        return;
      }
      const port = body.port as number;
      const input: UnsavedSshConnectionInput = {
        host: body.host,
        port,
        username: body.username,
        authMethod: body.authMethod,
        password: body.password,
        privateKey: body.sshKeyId ? undefined : body.privateKey,
        passphrase: body.sshKeyId ? undefined : body.passphrase,
        sshKeyId: body.sshKeyId ?? null,
        proxyId: body.proxyId ?? null,
      };
      if (input.port <= 0 || input.port > 65535) {
        response.status(400).json({ success: false, message: '端口号必须是 1-65535。' });
        return;
      }
      if (input.proxyId !== null && input.proxyId !== undefined && !Number.isInteger(input.proxyId)) {
        response.status(400).json({ success: false, message: '代理 ID 必须是有效的数字。' });
        return;
      }
      if (input.sshKeyId !== null && input.sshKeyId !== undefined && !Number.isInteger(input.sshKeyId)) {
        response.status(400).json({ success: false, message: 'SSH 密钥 ID 必须是有效的数字。' });
        return;
      }
      try {
        const { latency } = await dependencies.sshConnectionTest.testUnsaved(input);
        response.json({ success: true, message: '连接测试成功。', latency });
      } catch (error) {
        response.status(500).json({ success: false, message: errorMessage(error) });
      }
    }),
  );

  router.post(
    '/add-tag',
    route(async (request, response) => {
      const connectionIds = request.body?.connectionIds;
      const tagId = request.body?.tagId;
      if (!Array.isArray(connectionIds) || connectionIds.length === 0 || !connectionIds.every(Number.isInteger)) {
        response.status(400).json({ message: 'connectionIds 必须是一个非空数字数组。' });
        return;
      }
      if (!Number.isInteger(tagId) || tagId <= 0) {
        response.status(400).json({ message: 'tagId 必须是一个有效的正整数。' });
        return;
      }
      try {
        await dependencies.connections.addTagToConnections(connectionIds, tagId);
        response.json({ message: '标签已成功添加到指定连接。' });
      } catch (error) {
        const message = errorMessage(error);
        response.status(statusForConnectionError(message)).json({ message });
      }
    }),
  );

  router.get(
    '/',
    route(async (_request, response) => {
      response.json(await dependencies.connections.list());
    }),
  );

  router.post(
    '/',
    route(async (request, response) => {
      const body = request.body as CreateConnectionInput;
      if (!body || typeof body !== 'object' || !body.type || !body.host || !body.username) {
        response.status(400).json({ message: '缺少必要的连接信息 (type, host, username)。' });
        return;
      }
      try {
        const created = await dependencies.connections.create(body);
        response.status(201).json({ message: '连接创建成功。', connection: created });
      } catch (error) {
        const message = errorMessage(error);
        response.status(statusForConnectionError(message)).json({ message });
      }
    }),
  );

  router.post(
    '/:id/rdp-session',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的连接 ID。' });
        return;
      }
      try {
        response.json(
          await dependencies.remoteDesktop.create(id, 'RDP', displayOptions(request.query as Record<string, unknown>)),
        );
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(
            message.includes('连接未找到')
              ? 404
              : message.includes('不是 RDP') || message.includes('密码') || message.includes('参数无效')
                ? 400
                : message.includes('网关')
                  ? 502
                  : 500,
          )
          .json({ message });
      }
    }),
  );

  router.post(
    '/:id/vnc-session',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的连接 ID。' });
        return;
      }
      try {
        response.json(
          await dependencies.remoteDesktop.create(id, 'VNC', displayOptions(request.query as Record<string, unknown>)),
        );
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(
            message.includes('连接未找到')
              ? 404
              : message.includes('不是 VNC') || message.includes('密码') || message.includes('参数无效')
                ? 400
                : message.includes('网关')
                  ? 502
                  : 500,
          )
          .json({ message });
      }
    }),
  );

  router.post(
    '/:id/test',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ success: false, message: '无效的连接 ID。' });
        return;
      }
      try {
        const { latency } = await dependencies.sshConnectionTest.testStored(id);
        response.json({ success: true, message: '连接测试成功。', latency });
      } catch (error) {
        response.status(500).json({ success: false, message: errorMessage(error) });
      }
    }),
  );

  router.post(
    '/:id/clone',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      const name = request.body?.name;
      if (!id) {
        response.status(400).json({ message: '无效的原始连接 ID。' });
        return;
      }
      if (typeof name !== 'string' || !name.trim()) {
        response.status(400).json({ message: '需要提供有效的字符串类型的新连接名称 (name)。' });
        return;
      }
      try {
        const cloned = await dependencies.connections.clone(id, name);
        response.status(201).json({ message: '连接克隆成功。', connection: cloned });
      } catch (error) {
        const message = errorMessage(error);
        response.status(statusForConnectionError(message)).json({ message });
      }
    }),
  );

  router.get(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的连接 ID。' });
        return;
      }
      const connection = await dependencies.connections.get(id);
      if (!connection) {
        response.status(404).json({ message: '连接未找到。' });
        return;
      }
      response.json(connection);
    }),
  );

  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的连接 ID。' });
        return;
      }
      try {
        const updated = await dependencies.connections.update(id, (request.body ?? {}) as UpdateConnectionInput);
        if (!updated) {
          response.status(404).json({ message: '连接未找到。' });
          return;
        }
        response.json({ message: '连接更新成功。', connection: updated });
      } catch (error) {
        const message = errorMessage(error);
        response.status(statusForConnectionError(message)).json({ message });
      }
    }),
  );

  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的连接 ID。' });
        return;
      }
      if (!(await dependencies.connections.delete(id))) {
        response.status(404).json({ message: '连接未找到。' });
        return;
      }
      response.json({ message: '连接删除成功。' });
    }),
  );

  return router;
};
