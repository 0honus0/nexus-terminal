declare module 'vue3-recaptcha2' {
  import type { DefineComponent } from 'vue';
  const VueRecaptcha: DefineComponent<{
    sitekey: string;
    theme?: 'light' | 'dark';
  }>;
  export default VueRecaptcha;
}
