/**
 * Shell 转义工具函数
 * 统一 SFTP 模块中的 shell 命令参数转义策略
 *
 * 使用单引号包裹 + 内部单引号转义（'\\''），这是最安全的 shell 转义方式：
 * - 单引号内所有字符都是字面量，无需担心特殊字符
 * - 遇到单引号时，先闭合当前单引号，转义单引号，再重新开启单引号
 */

/**
 * 将字符串安全转义为 shell 参数
 * 使用 POSIX 标准的单引号转义方式
 *
 * @example
 * shellEscape("hello world")  // "'hello world'"
 * shellEscape("it's")         // "'it'\\''s'"
 * shellEscape("")             // "''"
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
