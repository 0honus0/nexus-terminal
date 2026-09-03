import { Router } from 'express';
import type { AuditLogService } from '../../../modules/audit/audit.service';
import type { ProxyService } from '../../../modules/proxies/proxy.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import {
  fromLegacyProxyCreateDto,
  fromLegacyProxyUpdateDto,
  toLegacyProxyDto,
  type LegacyProxyWriteDto,
} from '../legacy-api/proxy-http.mapper';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

export const createProxiesRouter = (dependencies: { proxies: ProxyService; audit: AuditLogService }): Router => {
  const router = Router();
  router.use(requireAuthenticated);

  router.get(
    '/',
    route(async (_request, response) => {
      response.json((await dependencies.proxies.list()).map(toLegacyProxyDto));
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
      response.json(toLegacyProxyDto(proxy));
    }),
  );

  router.post(
    '/',
    route(async (request, response) => {
      const dto = request.body as LegacyProxyWriteDto;
      if (!dto?.name || !dto.type || !dto.host || !dto.port) {
        response.status(400).json({ message: '缺少必要的代理信息 (name, type, host, port)' });
        return;
      }
      try {
        const proxy = await dependencies.proxies.create(fromLegacyProxyCreateDto(dto));
        await dependencies.audit.logAction('PROXY_CREATED', { proxyId: proxy.id, name: proxy.name, type: proxy.type });
        response.status(201).json({ message: '代理创建成功', proxy: toLegacyProxyDto(proxy) });
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
        const updated = await dependencies.proxies.update(id, fromLegacyProxyUpdateDto(request.body));
        if (!updated) {
          response.status(404).json({ message: `未找到 ID 为 ${id} 的代理进行更新` });
          return;
        }
        await dependencies.audit.logAction('PROXY_UPDATED', { proxyId: id, updatedFields: Object.keys(request.body) });
        response.json({ message: '代理更新成功', proxy: toLegacyProxyDto(updated) });
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
