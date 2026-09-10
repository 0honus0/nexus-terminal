import { Router, type Request } from 'express';
import { create as createContentDisposition } from 'content-disposition';
import parseRange from 'range-parser';
import type { AgentArtifactFacade } from '../../../modules/agent/public';
import { agentData, agentError, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppArtifactsRouterDependencies {
  artifacts: AgentArtifactFacade;
  nodeEnv: string;
  publicOrigin?: string;
}

const pathParam = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error('VALIDATION_FAILED');
  return value;
};

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

const parseExpectedVersion = (request: Request): number => {
  const raw = Array.isArray(request.query.expectedVersion)
    ? request.query.expectedVersion[0]
    : request.query.expectedVersion;
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!positiveInteger(value)) throw new Error('VALIDATION_FAILED');
  return value;
};

const rangeFor = (
  header: string | undefined,
  sizeBytes: number,
): { start: number; endInclusive: number; partial: boolean } => {
  if (sizeBytes === 0) return { start: 0, endInclusive: -1, partial: false };
  if (!header)
    return { start: 0, endInclusive: Math.min(sizeBytes - 1, 1024 * 1024 - 1), partial: sizeBytes > 1024 * 1024 };
  const parsed = parseRange(sizeBytes, header, { combine: false });
  if (parsed === -1 || parsed === -2 || parsed.type !== 'bytes' || parsed.length !== 1) {
    throw new Error('ARTIFACT_RANGE_INVALID');
  }
  const requested = parsed[0]!;
  const start = requested.start;
  const openEnded = /^bytes=\d+-$/.test(header.trim());
  const endInclusive = openEnded ? Math.min(requested.end, start + 8 * 1024 * 1024 - 1) : requested.end;
  if (endInclusive - start + 1 > 8 * 1024 * 1024) throw new Error('ARTIFACT_RANGE_INVALID');
  return { start, endInclusive, partial: true };
};

const contentDisposition = (name: string): string =>
  createContentDisposition(name.slice(0, 180) || 'artifact', { type: 'attachment' });

export const createAppArtifactsRouter = (dependencies: AppArtifactsRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
  });

  router.use(requireAgentAuthenticated);

  router.post(
    '/',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const appId = pathParam(request.params.appId);
      const reservation = await dependencies.artifacts.begin({ userId: agentUserId(request), appId }, request.body);
      agentData(
        request,
        response,
        {
          artifactId: reservation.artifactId,
          uploadUrl: `/api/v1/apps/${encodeURIComponent(appId)}/artifacts/${reservation.artifactId}/content`,
          expiresAt: reservation.expiresAt,
        },
        201,
      );
    }),
  );

  router.put(
    '/:artifactId/content',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const contentLength = request.header('content-length');
      if (!contentLength || !/^\d+$/.test(contentLength)) {
        agentError(request, response, 411, 'CONTENT_LENGTH_REQUIRED', 'Artifact upload requires Content-Length.');
        return;
      }
      const declared = Number(contentLength);
      if (!Number.isSafeInteger(declared) || declared < 0) throw new Error('VALIDATION_FAILED');
      if (declared > 50 * 1024 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const artifactId = pathParam(request.params.artifactId);
      const current = await dependencies.artifacts.get(scope, artifactId);
      if (!current) throw new Error('NOT_FOUND');
      if (current.status !== 'staging') throw new Error('STATE_CONFLICT');
      const result = await dependencies.artifacts.write(scope, artifactId, request, AbortSignal.timeout(120_000));
      agentData(request, response, result);
    }),
  );

  router.get(
    '/:artifactId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const artifact = await dependencies.artifacts.get(scope, pathParam(request.params.artifactId));
      if (!artifact) throw new Error('NOT_FOUND');
      if (artifact.status === 'unavailable') throw new Error('ARTIFACT_UNAVAILABLE');
      agentData(request, response, artifact);
    }),
  );

  router.get(
    '/:artifactId/content',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const artifact = await dependencies.artifacts.get(scope, pathParam(request.params.artifactId));
      if (!artifact) throw new Error('NOT_FOUND');
      if (artifact.status === 'unavailable') throw new Error('ARTIFACT_UNAVAILABLE');
      if (artifact.status !== 'ready' || !artifact.sha256) throw new Error('STATE_CONFLICT');
      if (request.header('if-none-match') === `"${artifact.sha256}"`) {
        response.status(304).end();
        return;
      }
      if (artifact.sizeBytes === 0) {
        response.setHeader('ETag', `"${artifact.sha256}"`);
        response.setHeader('Content-Type', artifact.mediaType);
        response.setHeader('Content-Length', '0');
        response.setHeader('Content-Disposition', contentDisposition(artifact.originalName));
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.status(200).end();
        return;
      }
      const range = rangeFor(request.header('range'), artifact.sizeBytes);
      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('ETag', `"${artifact.sha256}"`);
      response.setHeader('Content-Type', artifact.mediaType);
      response.setHeader('Content-Disposition', contentDisposition(artifact.originalName));
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Length', String(range.endInclusive - range.start + 1));
      if (range.partial) {
        response.status(206);
        response.setHeader('Content-Range', `bytes ${range.start}-${range.endInclusive}/${artifact.sizeBytes}`);
      }
      for await (const chunk of dependencies.artifacts.read(scope, artifact.id, range)) response.write(chunk);
      response.end();
    }),
  );

  router.patch(
    '/:artifactId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body))
        throw new Error('VALIDATION_FAILED');
      const body = request.body as Record<string, unknown>;
      if (Object.keys(body).some((key) => !['retained', 'expectedVersion'].includes(key)))
        throw new Error('VALIDATION_FAILED');
      if (typeof body.retained !== 'boolean' || !positiveInteger(body.expectedVersion))
        throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.artifacts.retain(
          scope,
          pathParam(request.params.artifactId),
          body.retained,
          body.expectedVersion,
        ),
      );
    }),
  );

  router.delete(
    '/:artifactId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      await dependencies.artifacts.delete(scope, pathParam(request.params.artifactId), parseExpectedVersion(request));
      agentData(request, response, { deleted: true }, 202);
    }),
  );

  return router;
};
