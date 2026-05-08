import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_CLAUDE_BASE_URL,
  AI_PROVIDER_DEFAULTS,
} from './aiConstants';

describe('aiConstants', () => {
  describe('Base URL 常量', () => {
    it('DEFAULT_OPENAI_BASE_URL 应该是有效的 OpenAI URL', () => {
      expect(DEFAULT_OPENAI_BASE_URL).toBeDefined();
      expect(() => new URL(DEFAULT_OPENAI_BASE_URL)).not.toThrow();
      expect(DEFAULT_OPENAI_BASE_URL).toContain('openai.com');
    });

    it('DEFAULT_CLAUDE_BASE_URL 应该是有效的 Claude URL', () => {
      expect(DEFAULT_CLAUDE_BASE_URL).toBeDefined();
      expect(() => new URL(DEFAULT_CLAUDE_BASE_URL)).not.toThrow();
      expect(DEFAULT_CLAUDE_BASE_URL).toContain('anthropic.com');
    });
  });

  describe('AI_PROVIDER_DEFAULTS', () => {
    it('应该已定义', () => {
      expect(AI_PROVIDER_DEFAULTS).toBeDefined();
    });

    it('应该包含 openai 和 claude 两个提供者', () => {
      expect(AI_PROVIDER_DEFAULTS.openai).toBeDefined();
      expect(AI_PROVIDER_DEFAULTS.claude).toBeDefined();
    });

    describe('openai 默认配置', () => {
      it('应该包含有效的 baseUrl', () => {
        expect(AI_PROVIDER_DEFAULTS.openai.baseUrl).toBe(DEFAULT_OPENAI_BASE_URL);
      });

      it('应该包含 model 字段', () => {
        expect(typeof AI_PROVIDER_DEFAULTS.openai.model).toBe('string');
        expect(AI_PROVIDER_DEFAULTS.openai.model.length).toBeGreaterThan(0);
      });

      it('应该包含 endpoint 字段', () => {
        expect(typeof AI_PROVIDER_DEFAULTS.openai.endpoint).toBe('string');
        expect(AI_PROVIDER_DEFAULTS.openai.endpoint).toContain('completions');
      });
    });

    describe('claude 默认配置', () => {
      it('应该包含有效的 baseUrl', () => {
        expect(AI_PROVIDER_DEFAULTS.claude.baseUrl).toBe(DEFAULT_CLAUDE_BASE_URL);
      });

      it('应该包含 model 字段', () => {
        expect(typeof AI_PROVIDER_DEFAULTS.claude.model).toBe('string');
        expect(AI_PROVIDER_DEFAULTS.claude.model.length).toBeGreaterThan(0);
      });
    });
  });
});
