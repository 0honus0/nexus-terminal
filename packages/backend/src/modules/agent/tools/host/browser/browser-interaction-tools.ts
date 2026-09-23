import type { JsonValue } from '../../../agent.types';
import type { BrowserGatewayPort } from '../../../ai/integrations.types';
import type { AgentTool } from '../../../capabilities/tool.types';
import type { BrowserSessionBindingAuthority } from './browser-session-binding-authority';
import {
  MAX_ID_BYTES,
  MAX_OPTION_BYTES,
  MAX_SCROLL_DELTA,
  MAX_SETTLE_MS,
  MAX_TYPE_BYTES,
  MAX_URL_BYTES,
  MAX_WAIT_MS,
  TOOL_VERSION,
  browserToolInteger as integer,
  browserToolObject as object,
  browserToolResult as result,
  browserToolString as string,
  browserToolStringArray as stringArray,
} from './browser-tool-common';

export const createBrowserInteractionTools = (
  authority: BrowserSessionBindingAuthority,
  gateway: BrowserGatewayPort,
): AgentTool[] => [
  ...(['navigate', 'click', 'type'] as const).map((action): AgentTool => ({
    descriptor: {
      name: `browser_${action}`,
      version: TOOL_VERSION,
      description:
        action === 'navigate'
          ? 'Navigate an existing Browser session to an allowlisted URL and return bounded post-action state.'
          : action === 'click'
            ? 'Click an opaque nodeRef from the latest Browser snapshot and return bounded post-action state.'
            : 'Type bounded text into an opaque nodeRef from the latest Browser snapshot and return bounded post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
          ...(action === 'navigate'
            ? { url: { type: 'string', minLength: 1, maxLength: MAX_URL_BYTES } }
            : {
                snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
                nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
                ...(action === 'type' ? { text: { type: 'string', maxLength: MAX_TYPE_BYTES } } : {}),
              }),
        },
        required: [
          'sessionId',
          ...(action === 'navigate' ? ['url'] : ['snapshotId', 'nodeRef', ...(action === 'type' ? ['text'] : [])]),
        ],
      },
      riskClass: 'mutate',
      capability: action === 'navigate' ? 'browser.read' : 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      const normalized: Record<string, JsonValue> = {
        sessionId,
        settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
      };
      if (action === 'navigate') normalized.url = string(args.url, MAX_URL_BYTES);
      else {
        normalized.snapshotId = string(args.snapshotId, MAX_ID_BYTES);
        normalized.nodeRef = string(args.nodeRef, MAX_ID_BYTES);
        if (action === 'type') normalized.text = string(args.text, MAX_TYPE_BYTES, true);
      }
      return authority.inspection(
        context,
        `browser_${action}`,
        normalized,
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const settleMs = integer(args.settleMs, 250, 0, MAX_SETTLE_MS);
      if (action === 'navigate') {
        const state = await gateway.navigate(sessionId, string(args.url, MAX_URL_BYTES), { settleMs }, context.signal);
        return result('Browser navigation completed.', state as unknown as JsonValue, {
          key: 'agent.conversation.toolSummary.browserNavigationCompleted',
        });
      }
      const snapshotId = string(args.snapshotId, MAX_ID_BYTES);
      const nodeRef = string(args.nodeRef, MAX_ID_BYTES);
      const state =
        action === 'click'
          ? await gateway.click(sessionId, snapshotId, nodeRef, { settleMs }, context.signal)
          : await gateway.type(
              sessionId,
              snapshotId,
              nodeRef,
              string(args.text, MAX_TYPE_BYTES, true),
              { settleMs },
              context.signal,
            );
      return result(`Browser ${action} completed.`, state as unknown as JsonValue, {
        key: 'agent.conversation.toolSummary.browserActionCompleted',
        params: { actionKey: `agent.conversation.toolSummary.labels.browserAction.${action}` },
      });
    },
  })),
  {
    descriptor: {
      name: 'browser_scroll',
      version: TOOL_VERSION,
      description:
        'Scroll the current Browser page by bounded CSS-pixel deltas and return lightweight post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          deltaX: { type: 'integer', minimum: -MAX_SCROLL_DELTA, maximum: MAX_SCROLL_DELTA },
          deltaY: { type: 'integer', minimum: -MAX_SCROLL_DELTA, maximum: MAX_SCROLL_DELTA },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'deltaY'],
      },
      riskClass: 'mutate',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_scroll',
        {
          sessionId,
          deltaX: integer(args.deltaX, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          deltaY: integer(args.deltaY, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const state = await gateway.scroll(
        sessionId,
        {
          deltaX: integer(args.deltaX, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          deltaY: integer(args.deltaY, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        context.signal,
      );
      return result('Browser scroll completed.', state as unknown as JsonValue, {
        key: 'agent.conversation.toolSummary.browserScrollCompleted',
      });
    },
  },
  {
    descriptor: {
      name: 'browser_press',
      version: TOOL_VERSION,
      description:
        'Press a bounded keyboard key or shortcut at page level or on an opaque nodeRef, then return lightweight post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          key: { type: 'string', minLength: 1, maxLength: 32 },
          modifiers: {
            type: 'array',
            maxItems: 4,
            uniqueItems: true,
            items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] },
          },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'key'],
      },
      riskClass: 'mutate',
      capability: 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const hasSnapshot = args.snapshotId !== undefined;
      const hasNode = args.nodeRef !== undefined;
      if (hasSnapshot !== hasNode) throw new Error('TOOL_ARGUMENTS_INVALID');
      const { binding } = await authority.session(context, sessionId);
      const modifiers =
        args.modifiers === undefined ? [] : stringArray(args.modifiers, { minItems: 0, maxItems: 4, maxBytes: 16 });
      if (modifiers.some((modifier) => !['Alt', 'Control', 'Meta', 'Shift'].includes(modifier))) {
        throw new Error('TOOL_ARGUMENTS_INVALID');
      }
      const normalized: Record<string, JsonValue> = {
        sessionId,
        key: string(args.key, 32),
        modifiers,
        settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
      };
      if (hasSnapshot) {
        normalized.snapshotId = string(args.snapshotId, MAX_ID_BYTES);
        normalized.nodeRef = string(args.nodeRef, MAX_ID_BYTES);
      }
      return authority.inspection(
        context,
        'browser_press',
        normalized,
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const state = await gateway.press(
        sessionId,
        {
          key: string(args.key, 32),
          modifiers: stringArray(args.modifiers, { minItems: 0, maxItems: 4, maxBytes: 16 }),
          ...(args.snapshotId !== undefined
            ? {
                snapshotId: string(args.snapshotId, MAX_ID_BYTES),
                nodeRef: string(args.nodeRef, MAX_ID_BYTES),
              }
            : {}),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        context.signal,
      );
      return result('Browser key press completed.', state as unknown as JsonValue, {
        key: 'agent.conversation.toolSummary.browserKeyPressCompleted',
      });
    },
  },
  {
    descriptor: {
      name: 'browser_back',
      version: TOOL_VERSION,
      description: 'Navigate one history entry back and return lightweight post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId'],
      },
      riskClass: 'mutate',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_back',
        { sessionId, settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const state = await gateway.back(
        sessionId,
        { settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
        context.signal,
      );
      return result('Browser back navigation completed.', state as unknown as JsonValue, {
        key: 'agent.conversation.toolSummary.browserBackCompleted',
      });
    },
  },
  {
    descriptor: {
      name: 'browser_select',
      version: TOOL_VERSION,
      description:
        'Select one or more option values on an opaque select nodeRef from the latest Browser snapshot and return post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          values: {
            type: 'array',
            minItems: 1,
            maxItems: 16,
            items: { type: 'string', maxLength: MAX_OPTION_BYTES },
          },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'snapshotId', 'nodeRef', 'values'],
      },
      riskClass: 'mutate',
      capability: 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_select',
        {
          sessionId,
          snapshotId: string(args.snapshotId, MAX_ID_BYTES),
          nodeRef: string(args.nodeRef, MAX_ID_BYTES),
          values: stringArray(args.values, { minItems: 1, maxItems: 16, maxBytes: MAX_OPTION_BYTES }),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const state = await gateway.select(
        sessionId,
        string(args.snapshotId, MAX_ID_BYTES),
        string(args.nodeRef, MAX_ID_BYTES),
        stringArray(args.values, { minItems: 1, maxItems: 16, maxBytes: MAX_OPTION_BYTES }),
        { settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
        context.signal,
      );
      return result('Browser selection completed.', state as unknown as JsonValue, {
        key: 'agent.conversation.toolSummary.browserSelectionCompleted',
      });
    },
  },
  {
    descriptor: {
      name: 'browser_wait',
      version: TOOL_VERSION,
      description:
        'Wait for a bounded timeout or network-idle condition. Waiting invalidates old nodeRefs because the page may change asynchronously.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          mode: { type: 'string', enum: ['timeout', 'networkIdle'] },
          maxMillis: { type: 'integer', minimum: 1, maximum: MAX_WAIT_MS },
        },
        required: ['sessionId', 'mode', 'maxMillis'],
      },
      riskClass: 'control',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const mode = string(args.mode, 32);
      if (mode !== 'timeout' && mode !== 'networkIdle') throw new Error('TOOL_ARGUMENTS_INVALID');
      const { binding } = await authority.session(context, sessionId);
      return authority.inspection(
        context,
        'browser_wait',
        { sessionId, mode, maxMillis: integer(args.maxMillis, 1000, 1, MAX_WAIT_MS) },
        binding,
        sessionId,
        'control',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await authority.session(context, sessionId);
      const mode = string(args.mode, 32);
      if (mode !== 'timeout' && mode !== 'networkIdle') throw new Error('TOOL_ARGUMENTS_INVALID');
      const state = await gateway.wait(
        sessionId,
        { mode, maxMillis: integer(args.maxMillis, 1000, 1, MAX_WAIT_MS) },
        context.signal,
      );
      return result('Browser wait completed.', state as unknown as JsonValue, {
        key: 'agent.conversation.toolSummary.browserWaitCompleted',
      });
    },
  },
];
