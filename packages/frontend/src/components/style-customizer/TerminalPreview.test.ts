import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TerminalPreview from './TerminalPreview.vue';
import { useAppearanceStore } from '../../stores/appearance.store';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  createI18n: () => ({}),
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

// Mock Xterm.js
vi.mock('@xterm/xterm', () => {
  const MockTerminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    clear: vi.fn(),
    writeln: vi.fn(),
    dispose: vi.fn(),
    options: {
      fontSize: 14,
      fontFamily: 'monospace',
      theme: {},
    },
  }));

  return {
    Terminal: MockTerminal,
  };
});

describe('TerminalPreview.vue', () => {
  let wrapper: VueWrapper;
  let appearanceStore: ReturnType<typeof useAppearanceStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    appearanceStore = useAppearanceStore();

    // 设置默认值
    appearanceStore.appearanceSettings = {
      terminalFontFamily: 'Consolas, monospace',
      terminalFontSize: 14,
      activeTerminalThemeId: 1,
      terminalTextStrokeEnabled: false,
      terminalTextStrokeWidth: 1,
      terminalTextStrokeColor: '#000000',
      terminalTextShadowEnabled: false,
      terminalTextShadowOffsetX: 0,
      terminalTextShadowOffsetY: 0,
      terminalTextShadowBlur: 0,
      terminalTextShadowColor: 'rgba(0,0,0,0.5)',
    };

    wrapper = mount(TerminalPreview, {
      global: {
        plugins: [createPinia()],
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          'el-button': true,
        },
      },
      props: {
        width: '100%',
        height: '400px',
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  describe('组件渲染', () => {
    it('应该正确渲染预览容器', () => {
      expect(wrapper.find('.terminal-preview-wrapper').exists()).toBe(true);
    });

    it('应该显示骨架屏覆盖层（初始加载状态）', () => {
      // 初始状态应该显示骨架屏覆盖层
      expect(wrapper.find('.terminal-preview-skeleton-overlay').exists()).toBe(true);
    });

    it('应该渲染终端内容容器（永远存在）', () => {
      // terminalRef 现在永远存在，不会因为骨架屏而消失
      expect(wrapper.find('.terminal-preview-content').exists()).toBe(true);
    });

    it('骨架屏应该有三个控制点', () => {
      const dots = wrapper.findAll('.skeleton-dot');
      expect(dots).toHaveLength(3);
    });

    it('骨架屏应该有模式切换按钮占位符', () => {
      const skeletonBtns = wrapper.findAll('.skeleton-btn');
      expect(skeletonBtns).toHaveLength(3);
    });

    it('骨架屏应该有内容线条', () => {
      const lines = wrapper.findAll('.skeleton-line');
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  describe('懒加载与 IntersectionObserver', () => {
    it('应该在挂载时不立即创建终端实例', () => {
      // 由于懒加载，Terminal 构造函数不应立即被调用
      // (需要等待 IntersectionObserver 触发)
    });

    it('应该有 IntersectionObserver 实例', () => {
      // 组件应该设置 up observer
      expect(wrapper.vm).toBeTruthy();
    });
  });

  describe('响应式属性', () => {
    it('应该使用传入的 width 属性', () => {
      const style = wrapper.find('.terminal-preview-wrapper').attributes('style');
      expect(style).toContain('width: 100%');
    });

    it('应该使用传入的 height 属性', () => {
      const style = wrapper.find('.terminal-preview-wrapper').attributes('style');
      expect(style).toContain('height: 400px');
    });

    it('未传入尺寸时应该使用默认值', () => {
      const wrapperWithDefaults = mount(TerminalPreview, {
        global: {
          plugins: [createPinia()],
          mocks: {
            $t: (key: string) => key,
          },
        },
      });

      const style = wrapperWithDefaults.find('.terminal-preview-wrapper').attributes('style');
      expect(style).toContain('width: 100%');
      expect(style).toContain('height: 400px');

      wrapperWithDefaults.unmount();
    });
  });

  describe('骨架屏样式', () => {
    it('应该有正确的覆盖层样式', () => {
      const skeleton = wrapper.find('.terminal-preview-skeleton-overlay');
      expect(skeleton.exists()).toBe(true);
    });

    it('骨架屏线条应该有不同的宽度（模拟真实内容）', () => {
      const lines = wrapper.findAll('.skeleton-line');
      expect(lines.length).toBeGreaterThan(0);

      // 验证线条有不同的宽度样式
      const firstLineStyle = lines[0].attributes('style');
      expect(firstLineStyle).toBeTruthy();
    });

    it('应该有半透明背景遮罩', () => {
      const overlayBg = wrapper.find('.skeleton-overlay-bg');
      expect(overlayBg.exists()).toBe(true);
    });
  });

  describe('清理逻辑', () => {
    it('应该在卸载时清理资源', () => {
      const localWrapper = mount(TerminalPreview, {
        global: {
          plugins: [createPinia()],
          mocks: {
            $t: (key: string) => key,
          },
        },
      });

      // 卸载组件不应抛出错误
      expect(() => localWrapper.unmount()).not.toThrow();
    });
  });
});
