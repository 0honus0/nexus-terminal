import { Router } from 'express';
import type { SshKeyService } from '../../../modules/ssh-keys/ssh-key.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { fromLegacySshKeyCreateDto, fromLegacySshKeyUpdateDto } from '../legacy-api/ssh-key-http.mapper';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

export const createSshKeysRouter = (sshKeys: SshKeyService): Router => {
  const router = Router();
  router.use(requireAuthenticated);

  router.get(
    '/',
    route(async (_request, response) => {
      response.json(await sshKeys.list());
    }),
  );
  router.post(
    '/',
    route(async (request, response) => {
      try {
        const key = await sshKeys.create(fromLegacySshKeyCreateDto(request.body ?? {}));
        response.status(201).json({ message: 'SSH 密钥创建成功。', key });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('已存在') || message.includes('必须提供') ? 400 : 500).json({ message });
      }
    }),
  );
  router.get(
    '/:id/details',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的密钥 ID。' });
        return;
      }
      const key = await sshKeys.getDecrypted(id);
      if (!key) {
        response.status(404).json({ message: 'SSH 密钥未找到。' });
        return;
      }
      response.json(key);
    }),
  );
  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的密钥 ID。' });
        return;
      }
      if (!request.body || typeof request.body !== 'object' || !Object.keys(request.body).length) {
        response.status(400).json({ message: '请求体不能为空。' });
        return;
      }
      try {
        const key = await sshKeys.update(id, fromLegacySshKeyUpdateDto(request.body));
        if (!key) {
          response.status(404).json({ message: 'SSH 密钥未找到。' });
          return;
        }
        response.json({ message: 'SSH 密钥更新成功。', key });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('已存在') || message.includes('不能为空') ? 400 : 500).json({ message });
      }
    }),
  );
  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的密钥 ID。' });
        return;
      }
      if (!(await sshKeys.delete(id))) {
        response.status(404).json({ message: 'SSH 密钥未找到。' });
        return;
      }
      response.json({ message: 'SSH 密钥删除成功。' });
    }),
  );
  return router;
};
