/// <reference types="vite/client" />

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
