import type { JsonValue } from '../../../agent.types';
import type { ArtifactService } from '../../../ai/artifact.service';
import type { BrowserGatewayPort } from '../../../ai/integrations.types';
import type { AgentTool } from '../../../capabilities/tool.types';
import type { BrowserSessionBindingAuthority } from './browser-session-binding-authority';
import {
  MAX_ID_BYTES,
  MAX_SCREENSHOT_BYTES,
  MIN_SCREENSHOT_BYTES,
  TOOL_VERSION,
  browserByteSource as byteSource,
  browserToolInteger as integer,
  browserToolObject as object,
  browserToolResult as result,
  browserToolString as string,
} from './browser-tool-common';

export const createBrowserObservationTools = (
  authority: BrowserSessionBindingAuthority,
  gateway: BrowserGatewayPort,
  artifacts?: ArtifactService,
): AgentTool[] => [
  {
    descriptor: {
      name: 'browser_snapshot',
      version: TOOL_VERSION,
      description: 'Capture a bounded semantic snapshot of a Browser session and return opaque node references.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          maxNodes: { type: 'integer', minimum: 1, maximum: 2000 },
          maxBytes: { type: 'integer', minimum: 1024, maximum: 65536 },
        },
        required: ['sessionId'],
      },
      riskClass: 'read',
      parallelSafe: true,
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      const normalized: JsonValue = {
        sessionId,
        maxNodes: integer(args.maxNodes, 1000, 1, 2000),
        maxBytes: integer(args.maxBytes, Math.min(65536, context.maxOutputBytes), 1024, 65536),
      };
      return authority.inspection(
        context,
        'browser_snapshot',
        normalized,
        binding,
        sessionId,
        'read',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const snapshot = await gateway.snapshot(
        sessionId,
        {
          maxNodes: integer(args.maxNodes, 1000, 1, 2000),
          maxBytes: integer(args.maxBytes, 65536, 1024, 65536),
        },
        context.signal,
      );
      return {
        ...result('Browser snapshot captured.', snapshot as unknown as JsonValue),
        truncated: snapshot.truncated,
      };
    },
  },
  {
    descriptor: {
      name: 'browser_screenshot',
      version: TOOL_VERSION,
      description:
        'Capture the current Browser viewport as a bounded PNG Artifact for on-demand visual inspection. Use semantic browser_snapshot by default and call this only when page pixels are needed.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          maxBytes: {
            type: 'integer',
            minimum: MIN_SCREENSHOT_BYTES,
            maximum: MAX_SCREENSHOT_BYTES,
          },
        },
        required: ['sessionId'],
      },
      riskClass: 'read',
      parallelSafe: true,
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      const normalized: JsonValue = {
        sessionId,
        maxBytes: integer(args.maxBytes, MAX_SCREENSHOT_BYTES, MIN_SCREENSHOT_BYTES, MAX_SCREENSHOT_BYTES),
      };
      return authority.inspection(
        context,
        'browser_screenshot',
        normalized,
        binding,
        sessionId,
        'read',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      if (!artifacts) throw new Error('BROWSER_SCREENSHOT_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const maxBytes = integer(args.maxBytes, MAX_SCREENSHOT_BYTES, MIN_SCREENSHOT_BYTES, MAX_SCREENSHOT_BYTES);
      const capture = await gateway.screenshot(sessionId, { maxBytes }, context.signal);
      if (
        capture.mediaType !== 'image/png' ||
        capture.bytes.byteLength < 1 ||
        capture.bytes.byteLength > maxBytes ||
        !Number.isSafeInteger(capture.width) ||
        capture.width < 1 ||
        !Number.isSafeInteger(capture.height) ||
        capture.height < 1
      ) {
        throw new Error('BROWSER_SCREENSHOT_INVALID');
      }
      const reservation = await artifacts.begin(context, {
        name: `browser-${sessionId}.png`,
        mediaType: capture.mediaType,
        declaredBytes: capture.bytes.byteLength,
      });
      const artifact = await artifacts.write(
        context,
        reservation.artifactId,
        byteSource(capture.bytes),
        context.signal,
      );
      if (artifact.status !== 'ready' || !artifact.sha256) throw new Error('BROWSER_SCREENSHOT_ARTIFACT_UNAVAILABLE');
      return {
        ok: true,
        summary: 'Browser viewport screenshot captured as an image Artifact.',
        data: {
          type: 'browser_screenshot',
          sessionId: capture.sessionId,
          targetId: capture.targetId,
          generation: capture.generation,
          url: capture.url,
          title: capture.title,
          viewport: { width: capture.width, height: capture.height },
          artifact: {
            id: artifact.id,
            mediaType: artifact.mediaType,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes,
          },
        },
        artifactRefs: [artifact.id],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary:
            'The screenshot bytes were captured from the current Browser viewport and persisted as a ready Artifact.',
          evidenceRefs: [artifact.id],
        },
      };
    },
  },
  {
    descriptor: {
      name: 'browser_console',
      version: TOOL_VERSION,
      description:
        'Read a bounded cursor-based slice of Browser console output. This is read-only and does not expose JavaScript evaluation.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          afterCursor: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          maxBytes: { type: 'integer', minimum: 256, maximum: 65536 },
        },
        required: ['sessionId'],
      },
      riskClass: 'read',
      parallelSafe: true,
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_console',
        {
          sessionId,
          afterCursor: integer(args.afterCursor, 0, 0, Number.MAX_SAFE_INTEGER),
          limit: integer(args.limit, 50, 1, 100),
          maxBytes: integer(args.maxBytes, Math.min(16 * 1024, context.maxOutputBytes), 256, 65536),
        },
        binding,
        sessionId,
        'read',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const view = await gateway.console(
        sessionId,
        {
          afterCursor: integer(args.afterCursor, 0, 0, Number.MAX_SAFE_INTEGER),
          limit: integer(args.limit, 50, 1, 100),
          maxBytes: integer(args.maxBytes, Math.min(16 * 1024, context.maxOutputBytes), 256, 65536),
        },
        context.signal,
      );
      return {
        ...result('Browser console read completed.', view as unknown as JsonValue),
        truncated: view.truncated,
      };
    },
  },
];
