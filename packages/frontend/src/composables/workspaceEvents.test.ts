/**
 * workspaceEvents 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  workspaceEmitter,
  useWorkspaceEventEmitter,
  useWorkspaceEventSubscriber,
  useWorkspaceEventOff,
} from './workspaceEvents';

describe('workspaceEvents', () => {
  beforeEach(() => {
    workspaceEmitter.all.clear();
  });

  describe('workspaceEmitter', () => {
    it('应支持 emit 和 on 事件订阅', () => {
      const handler = vi.fn();
      workspaceEmitter.on('terminal:input', handler);

      workspaceEmitter.emit('terminal:input', { sessionId: 's1', data: 'ls' });

      expect(handler).toHaveBeenCalledWith({ sessionId: 's1', data: 'ls' });
    });

    it('应支持 off 取消订阅', () => {
      const handler = vi.fn();
      workspaceEmitter.on('terminal:input', handler);
      workspaceEmitter.off('terminal:input', handler);

      workspaceEmitter.emit('terminal:input', { sessionId: 's1', data: 'ls' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('应支持多个事件类型', () => {
      const inputHandler = vi.fn();
      const resizeHandler = vi.fn();
      workspaceEmitter.on('terminal:input', inputHandler);
      workspaceEmitter.on('terminal:resize', resizeHandler);

      workspaceEmitter.emit('terminal:input', { sessionId: 's1', data: 'ls' });
      workspaceEmitter.emit('terminal:resize', { sessionId: 's1', dims: { cols: 80, rows: 24 } });

      expect(inputHandler).toHaveBeenCalledTimes(1);
      expect(resizeHandler).toHaveBeenCalledTimes(1);
    });

    it('应支持 session:activate 事件', () => {
      const handler = vi.fn();
      workspaceEmitter.on('session:activate', handler);

      workspaceEmitter.emit('session:activate', { sessionId: 'session-123' });

      expect(handler).toHaveBeenCalledWith({ sessionId: 'session-123' });
    });

    it('应支持 search:start 事件', () => {
      const handler = vi.fn();
      workspaceEmitter.on('search:start', handler);

      workspaceEmitter.emit('search:start', { term: 'keyword' });

      expect(handler).toHaveBeenCalledWith({ term: 'keyword' });
    });

    it('应支持 void 类型事件', () => {
      const handler = vi.fn();
      workspaceEmitter.on('terminal:clear', handler);

      workspaceEmitter.emit('terminal:clear', undefined);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('useWorkspaceEventEmitter', () => {
    it('应返回 emit 函数', () => {
      const emit = useWorkspaceEventEmitter();

      expect(typeof emit).toBe('function');
    });

    it('返回的 emit 函数应能发送事件', () => {
      const emit = useWorkspaceEventEmitter();
      const handler = vi.fn();
      workspaceEmitter.on('editor:closeTab', handler);

      emit('editor:closeTab', { tabId: 'tab-1' });

      expect(handler).toHaveBeenCalledWith({ tabId: 'tab-1' });
    });
  });

  describe('useWorkspaceEventSubscriber', () => {
    it('应返回 on 函数', () => {
      const on = useWorkspaceEventSubscriber();

      expect(typeof on).toBe('function');
    });

    it('返回的 on 函数应能订阅事件', () => {
      const on = useWorkspaceEventSubscriber();
      const handler = vi.fn();

      on('connection:connect', handler);
      workspaceEmitter.emit('connection:connect', { connectionId: 42 });

      expect(handler).toHaveBeenCalledWith({ connectionId: 42 });
    });
  });

  describe('useWorkspaceEventOff', () => {
    it('应返回 off 函数', () => {
      const off = useWorkspaceEventOff();

      expect(typeof off).toBe('function');
    });

    it('返回的 off 函数应能取消订阅', () => {
      const off = useWorkspaceEventOff();
      const handler = vi.fn();
      workspaceEmitter.on('session:close', handler);

      off('session:close', handler);
      workspaceEmitter.emit('session:close', { sessionId: 's1' });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
