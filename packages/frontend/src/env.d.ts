/// <reference types="vite/client" />

// Worker 构造函数类型声明（Vite 的 new URL 模式）
interface WorkerConstructor {
  new (url: URL | string, options?: { type?: 'module' | 'classic'; name?: string }): Worker;
}

// requestIdleCallback 非标准 API 类型声明（Safari 不支持，需运行时检测）
interface IdleRequestCallback {
  (deadline: IdleDeadline): void;
}

interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
}

interface Window {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

// vue3-recaptcha2 包的 package.json exports 未正确暴露类型声明（bundler moduleResolution）
declare module 'vue3-recaptcha2' {
  import type { DefineComponent } from 'vue';
  const VueRecaptcha: DefineComponent<
    {
      sitekey: { type: StringConstructor; required: true };
      size: { type: StringConstructor; required: false; default: string };
      theme: { type: StringConstructor; required: false; default: string };
      hl: { type: StringConstructor; required: false };
      loadingTimeout: { type: NumberConstructor; required: false; default: number };
    },
    { execute: () => void; reset: () => void }
  >;
  export default VueRecaptcha;
}
