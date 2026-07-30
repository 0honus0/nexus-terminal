declare module 'vue3-recaptcha2' {
  import type { DefineComponent } from 'vue';

  const VueRecaptcha: DefineComponent<any, {
    execute: () => void;
    reset: () => void;
  }, any>;

  export default VueRecaptcha;
}
