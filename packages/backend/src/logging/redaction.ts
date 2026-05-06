/**
 * 日志敏感信息脱敏模块（独立模块，无外部依赖）
 *
 * 从 logging/logger.ts 抽离，消除 utils/logger.ts 与 logging/logger.ts 的循环依赖。
 * 依赖方向：logging/redaction.ts ← utils/logger.ts ← logging/logger.ts（单向）
 */

// --- 敏感信息脱敏配置 ---
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passwd/i,
  /pwd/i,
  /token/i,
  /secret/i,
  /auth/i,
  /authorization/i,
  /credential/i,
  /passphrase/i,
  /private/i,
  /cookie/i,
  /session/i,
  /apikey/i,
  /api_key/i,
  /key/i,
  /username/i,
];

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * 增强的敏感信息脱敏函数
 * 支持：1) 对象 key 脱敏 2) 字符串内容脱敏 3) 循环引用保护 4) 深度限制 5) 大小限制
 */
export function redactSensitiveData(value: unknown, depth = 0, seen = new WeakSet()): unknown {
  const MAX_DEPTH = 10;
  const MAX_KEYS = 100;

  if (value === null || value === undefined) {
    return value;
  }

  // 处理字符串：对敏感模式进行脱敏
  if (typeof value === 'string') {
    let redactedStr = value;
    redactedStr = redactedStr.replace(
      /(\b(?:cookie|authorization|token|api[_-]?key|password|secret|passwd|pwd)\s*[:=]\s*["']?)([^\s;,&"']+)/gi,
      '$1[REDACTED]'
    );
    redactedStr = redactedStr.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [REDACTED]');
    return redactedStr;
  }

  if (typeof value !== 'object') {
    return value;
  }

  // 循环引用检测
  if (seen.has(value)) {
    return '[Circular Reference]';
  }

  // 深度限制
  if (depth >= MAX_DEPTH) {
    return '[Max Depth Exceeded]';
  }

  // 处理数组
  if (Array.isArray(value)) {
    seen.add(value);
    try {
      return value.map((item) => redactSensitiveData(item, depth + 1, seen));
    } catch {
      return '[Array Processing Error]';
    }
  }

  // 处理对象：包括普通对象、null-prototype 对象和类实例
  // 只要对象有可枚举的自有属性就尝试脱敏，避免类实例中的敏感字段泄露
  try {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      seen.add(value);
      const objectValue = value as Record<string, unknown>;
      const redacted: Record<string, unknown> = {};
      const processKeys = keys.slice(0, MAX_KEYS);
      if (keys.length > MAX_KEYS) {
        redacted['[truncated]'] = `${keys.length - MAX_KEYS} more keys...`;
      }

      for (const key of processKeys) {
        try {
          const isSensitive = SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key));
          if (isSensitive) {
            redacted[key] = REDACTED_PLACEHOLDER;
          } else {
            redacted[key] = redactSensitiveData(objectValue[key], depth + 1, seen);
          }
        } catch {
          redacted[key] = '[Access Error]';
        }
      }
      return redacted;
    }
  } catch {
    return '[Object Processing Error]';
  }

  // Error 对象：保持原样，交给 pino 原生 serializers 处理
  // 避免脱敏将其转为普通对象 {name,message,stack}，破坏 pino 的 err.* 结构化语义
  if (value instanceof Error) {
    return value;
  }

  return value;
}

/**
 * 脱敏所有日志参数
 */
export function redactLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactSensitiveData(arg));
}
