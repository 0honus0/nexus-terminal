/**
 * vue-i18n 翻译函数类型
 * 使用方法签名重载匹配 vue-i18n t 函数的实际调用方式
 */
export interface TranslateFn {
  (key: string): string;
  (key: string, named: Record<string, unknown>): string;
  (key: string, list: unknown[]): string;
  (key: string, plural: number): string;
  (key: string, defaultMsg: string): string;
  (key: string, named: Record<string, unknown>, defaultMsg: string): string;
  (key: string, list: unknown[], defaultMsg: string): string;
}
