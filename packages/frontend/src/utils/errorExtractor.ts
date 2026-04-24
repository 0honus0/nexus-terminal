/**
 * 统一的 API 错误消息提取器
 * 从 Axios 错误对象中提取用户友好的错误消息
 */

interface ApiError {
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
    status?: number;
  };
  message?: string;
}

/**
 * 从 API 错误中提取消息
 * 优先使用 data.error（新格式 { success: false, error, code }），
 * 回退到 data.message（旧格式），最后使用 Axios 错误消息或后备文本。
 * @param err 捕获的错误对象
 * @param fallback 后备消息（当无法提取时使用）
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  const apiErr = err as ApiError;
  return (
    apiErr?.response?.data?.error || apiErr?.response?.data?.message || apiErr?.message || fallback
  );
}
