import { Router } from 'express';
import type { AuditLogService } from '../../../modules/audit/audit.service';
import type { ProxyService } from '../../../modules/proxies/proxy.service';
import type { ProxyAuthMethod, ProxyInput, ProxyType } from '../../../modules/proxies/proxy.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, isRecord, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

const proxyTypes = new Set<ProxyType>(['SOCKS5', 'HTTP']);
const authMethods = new Set<ProxyAuthMethod>(['none', 'password', 'key']);
const optionalNullableString = (value: unknown, field: string): string | null | undefined => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串或 null。`);
  return value;
};
const proxyCreateInput = (body: unknown): ProxyInput => {
  if (!isRecord(body)) throw new Error('请求体必须是对象。');
  if (typeof body.name !== 'string' || typeof body.host !== 'string') throw new Error('name 和 host 必须是字符串。');
  if (typeof body.type !== 'string' || !proxyTypes.has(body.type as ProxyType)) throw new Error('无效的代理 type。');
  if (typeof body.port !== 'number' || !Number.isInteger(body.port)) throw new Error('port 必须是整数。');
  if (
    body.authMethod !== undefined &&
    (typeof body.authMethod !== 'string' || !authMethods.has(body.authMethod as ProxyAuthMethod))
  )
    throw new Error('无效的 authMethod。');
  return {
    name: body.name,
    type: body.type as ProxyType,
    host: body.host,
    port: body.port,
    username: optionalNullableString(body.username, 'username'),
    authMethod: body.authMethod as ProxyAuthMethod | undefined,
    password: optionalNullableString(body.password, 'password'),
    privateKey: optionalNullableString(body.privateKey, 'privateKey'),
    passphrase: optionalNullableString(body.passphrase, 'passphrase'),
  };
};
const proxyUpdateInput = (body: unknown): Partial<ProxyInput> => {
  if (!isRecord(body)) throw new Error('请求体必须是对象。');
  const input: Partial<ProxyInput> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') throw new Error('name 必须是字符串。');
    input.name = body.name;
  }
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !proxyTypes.has(body.type as ProxyType)) throw new Error('无效的代理 type。');
    input.type = body.type as ProxyType;
  }
  if (body.host !== undefined) {
    if (typeof body.host !== 'string') throw new Error('host 必须是字符串。');
    input.host = body.host;
  }
  if (body.port !== undefined) {
    if (typeof body.port !== 'number' || !Number.isInteger(body.port)) throw new Error('port 必须是整数。');
    input.port = body.port;
  }
  if (body.username !== undefined) input.username = optionalNullableString(body.username, 'username');
  if (body.authMethod !== undefined) {
    if (typeof body.authMethod !== 'string' || !authMethods.has(body.authMethod as ProxyAuthMethod))
      throw new Error('无效的 authMethod。');
    input.authMethod = body.authMethod as ProxyAuthMethod;
  }
  if (body.password !== undefined) input.password = optionalNullableString(body.password, 'password');
  if (body.privateKey !== undefined) input.privateKey = optionalNullableString(body.privateKey, 'privateKey');
  if (body.passphrase !== undefined) input.passphrase = optionalNullableString(body.passphrase, 'passphrase');
  return input;
};

export const createProxiesRouter = (dependencies: { proxies: ProxyService; audit: AuditLogService }): Router => {
  const router = Router();
  router.use(requireAuthenticated);

  router.get(
    '/',
    route(async (_request, response) => {
      response.json(await dependencies.proxies.list());
    }),
  );

  router.get(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的代理 ID' });
        return;
      }
      const proxy = await dependencies.proxies.get(id);
      if (!proxy) {
        response.status(404).json({ message: `未找到 ID 为 ${id} 的代理` });
        return;
      }
      response.json(proxy);
    }),
  );

  router.post(
    '/',
    route(async (request, response) => {
      try {
        const input = proxyCreateInput(request.body);
        const proxy = await dependencies.proxies.create(input);
        await dependencies.audit.logAction('PROXY_CREATED', { proxyId: proxy.id, name: proxy.name, type: proxy.type });
        response.status(201).json({ message: '代理创建成功', proxy });
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(
            message.includes('已存在')
              ? 409
              : message.includes('需要') || message.includes('无效') || message.includes('缺少')
                ? 400
                : 500,
          )
          .json({ message });
      }
    }),
  );

  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的代理 ID' });
        return;
      }
      if (!request.body || typeof request.body !== 'object' || !Object.keys(request.body).length) {
        response.status(400).json({ message: '没有提供任何要更新的字段' });
        return;
      }
      try {
        const updated = await dependencies.proxies.update(id, proxyUpdateInput(request.body));
        if (!updated) {
          response.status(404).json({ message: `未找到 ID 为 ${id} 的代理进行更新` });
          return;
        }
        await dependencies.audit.logAction('PROXY_UPDATED', { proxyId: id, updatedFields: Object.keys(request.body) });
        response.json({ message: '代理更新成功', proxy: updated });
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(
            message.includes('已存在')
              ? 409
              : message.includes('需要') || message.includes('无效') || message.includes('不能为空')
                ? 400
                : 500,
          )
          .json({ message });
      }
    }),
  );

  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的代理 ID' });
        return;
      }
      if (!(await dependencies.proxies.delete(id))) {
        response.status(404).json({ message: `未找到 ID 为 ${id} 的代理进行删除` });
        return;
      }
      await dependencies.audit.logAction('PROXY_DELETED', { proxyId: id });
      response.json({ message: `代理 ${id} 删除成功` });
    }),
  );

  return router;
};
