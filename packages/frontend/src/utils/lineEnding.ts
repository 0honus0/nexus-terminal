/**
 * 换行符处理工具函数
 * 支持 LF、CRLF、CR 三种换行符格式的检测和转换
 */

/** 换行符类型 */
export type LineEnding = 'lf' | 'crlf' | 'cr';

/**
 * 将内容转换为目标换行符格式
 * @param content 原始内容
 * @param targetEnding 目标换行符格式
 * @returns 转换后的内容
 */
export function convertLineEnding(content: string, targetEnding: LineEnding): string {
  // 第一步：归一化为 LF（移除所有 \r）
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 第二步：转换为目标格式
  switch (targetEnding) {
    case 'lf':
      return normalized;
    case 'crlf':
      return normalized.replace(/\n/g, '\r\n');
    case 'cr':
      return normalized.replace(/\n/g, '\r');
    default:
      return normalized;
  }
}

/**
 * 检测内容中的主导换行符类型
 * @param content 待检测的内容
 * @returns 主导的换行符类型，默认返回 'lf'
 */
export function detectLineEnding(content: string): LineEnding {
  if (!content) {
    return 'lf';
  }

  const crlfCount = (content.match(/\r\n/g) ?? []).length;
  const loneCrCount = (content.match(/\r(?!\n)/g) ?? []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) ?? []).length;

  if (crlfCount > lfCount && crlfCount > loneCrCount) {
    return 'crlf';
  }
  if (loneCrCount > crlfCount && loneCrCount > lfCount) {
    return 'cr';
  }
  return 'lf';
}
