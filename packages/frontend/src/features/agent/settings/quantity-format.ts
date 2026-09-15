export type QuantityType = 'bytes' | 'tokens' | 'seconds' | 'number';

/**
 * 将用户输入的带有 K, M, G, B 等单位的文本或数字解析为精确的数值。
 *
 * 规则：
 * - bytes 类型：
 *   1k/1kb/1kib -> 1024
 *   1m/1mb/1mib -> 1024 * 1024 (1,048,576)
 *   1g/1gb/1gib -> 1024 * 1024 * 1024 (1,073,741,824)
 *   1t/1tb/1tib -> 1024 * 1024 * 1024 * 1024
 * - tokens 类型：
 *   1k -> 1,000
 *   1m -> 1,000,000
 *   1g -> 1,000,000,000
 * - seconds 类型：
 *   1s -> 1
 *   1m -> 60
 *   1h -> 3600
 *   1d -> 86400
 * - number 类型：
 *   1k -> 1,000
 *   1m -> 1,000,000
 */
export function parseQuantity(raw: string | number | null | undefined, type: QuantityType = 'bytes'): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (Number.isNaN(raw)) return null;
    return Number.isFinite(raw) ? Math.round(raw) : null;
  }

  const trimmed = raw.trim().toLowerCase().replace(/,/g, '');
  if (!trimmed) return null;

  // 匹配数值部分与单位部分，支持小数，如 "1.5m", "100kb", "32000"
  const match = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-z]*)$/i);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;

  const unit = match[2];

  if (type === 'bytes') {
    let multiplier = 1;
    if (unit === 'k' || unit === 'kb' || unit === 'kib') {
      multiplier = 1024;
    } else if (unit === 'm' || unit === 'mb' || unit === 'mib') {
      multiplier = 1024 * 1024;
    } else if (unit === 'g' || unit === 'gb' || unit === 'gib') {
      multiplier = 1024 * 1024 * 1024;
    } else if (unit === 't' || unit === 'tb' || unit === 'tib') {
      multiplier = 1024 * 1024 * 1024 * 1024;
    } else if (unit === 'b' || unit === 'byte' || unit === 'bytes' || unit === '') {
      multiplier = 1;
    } else {
      return null;
    }
    return Math.round(num * multiplier);
  }

  if (type === 'tokens') {
    let multiplier = 1;
    if (unit === 'k' || unit === 'kt' || unit === 'ktoken' || unit === 'ktokens') {
      multiplier = 1000;
    } else if (unit === 'm' || unit === 'mt' || unit === 'mtoken' || unit === 'mtokens') {
      multiplier = 1000000;
    } else if (unit === 'g' || unit === 'b') {
      // 1b tokens / 1g
      multiplier = 1000000000;
    } else if (unit === 't' || unit === 'token' || unit === 'tokens' || unit === '') {
      multiplier = 1;
    } else {
      return null;
    }
    return Math.round(num * multiplier);
  }

  if (type === 'seconds') {
    let multiplier = 1;
    if (unit === 's' || unit === 'sec' || unit === 'second' || unit === 'seconds' || unit === '') {
      multiplier = 1;
    } else if (unit === 'm' || unit === 'min' || unit === 'minute' || unit === 'minutes') {
      multiplier = 60;
    } else if (unit === 'h' || unit === 'hr' || unit === 'hour' || unit === 'hours') {
      multiplier = 3600;
    } else if (unit === 'd' || unit === 'day' || unit === 'days') {
      multiplier = 86400;
    } else {
      return null;
    }
    return Math.round(num * multiplier);
  }

  // Generic number
  let multiplier = 1;
  if (unit === 'k') multiplier = 1000;
  else if (unit === 'm') multiplier = 1000000;
  else if (unit === 'g') multiplier = 1000000000;
  else if (unit !== '') return null;

  return Math.round(num * multiplier);
}

/**
 * 格式化数值为友好的人类可读简写（如 "10 MiB", "128k Tokens", "30 分钟"）
 */
export function formatQuantity(value: number | null | undefined, type: QuantityType = 'bytes'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '不限';
  if (value === 0) return type === 'bytes' ? '0 B' : '0';

  if (type === 'bytes') {
    const absVal = Math.abs(value);
    if (absVal < 1024) return `${value} B`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let amount = absVal;
    let unitIdx = -1;
    while (amount >= 1024 && unitIdx < units.length - 1) {
      amount /= 1024;
      unitIdx++;
    }
    const formatted = amount >= 100 ? Math.round(amount) : Number(amount.toFixed(1));
    return `${formatted} ${units[unitIdx]}`;
  }

  if (type === 'tokens') {
    const absVal = Math.abs(value);
    if (absVal < 1000) return `${value}`;
    if (absVal < 1000000 && absVal % 1024 === 0 && absVal <= 131072) {
      return `${absVal / 1024}k`;
    }
    if (absVal < 1000000) {
      const k = absVal / 1000;
      return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`;
    }
    const m = absVal / 1000000;
    return `${m >= 100 ? Math.round(m) : Number(m.toFixed(1))}M`;
  }

  if (type === 'seconds') {
    if (value < 60) return `${value} 秒`;
    if (value < 3600) {
      const min = Math.round(value / 60);
      return `${min} 分钟`;
    }
    if (value < 86400) {
      const hr = Number((value / 3600).toFixed(1));
      return `${hr} 小时`;
    }
    const days = Number((value / 86400).toFixed(1));
    return `${days} 天`;
  }

  return String(value);
}

/**
 * 详细解析描述反馈，例如：
 * parseQuantityDescription("10m", "bytes") -> "10 MiB (10,485,760 字节)"
 * parseQuantityDescription("100k", "tokens") -> "100k Tokens (100,000)"
 */
export function getQuantityFeedback(
  raw: string | number,
  type: QuantityType = 'bytes',
): {
  valid: boolean;
  value: number | null;
  readable: string;
  exact: string;
} {
  const parsed = parseQuantity(raw, type);
  if (parsed === null) {
    return {
      valid: false,
      value: null,
      readable: '无效格式',
      exact: '',
    };
  }

  const readable = formatQuantity(parsed, type);
  let exact = '';
  if (type === 'bytes') {
    exact = `${parsed.toLocaleString()} 字节`;
  } else if (type === 'tokens') {
    exact = `${parsed.toLocaleString()} Tokens`;
  } else if (type === 'seconds') {
    exact = `${parsed.toLocaleString()} 秒`;
  } else {
    exact = `${parsed.toLocaleString()}`;
  }

  return {
    valid: true,
    value: parsed,
    readable,
    exact,
  };
}

/**
 * 将数值格式化为供输入框直接展示和编辑的紧凑单位字符串（例如 100000 -> "100k", 65536 -> "64K", 1800 -> "30m"）。
 * 与展示性的 formatQuantity 不同，此函数专门针对输入框进行了友好优化：
 * - 输出带标准单位后缀（k, M, G, K, m, h），以便输入框的单位药丸精准匹配并高亮；
 * - tokens 类型只在十进制单位可精确往返时使用 k/M（例如 32000 为 "32k"，4096 保持 "4096"）；
 * - bytes 类型以 1024 幂次转换为 K/M/G（例如 65536 为 "64K"，10485760 为 "10M"）；
 * - seconds 类型整分整时转换为 m/h（例如 1800 为 "30m"，60 为 "1m"）；
 * - number 纯计数值保持纯数字（例如 80、5）。
 */
export function toCompactQuantityString(
  value: number | string | null | undefined,
  type: QuantityType = 'bytes',
): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return String(value);
  if (num === 0) return '0';

  if (type === 'tokens') {
    const absVal = Math.abs(num);
    if (absVal >= 1_000_000 && absVal % 1_000_000 === 0) return `${num / 1_000_000}M`;
    if (absVal >= 1000 && absVal % 1000 === 0) return `${num / 1000}k`;
    // Token suffixes are decimal in parseQuantity. Preserve exact values such as 4096
    // instead of rendering a lossy shorthand that would parse back as 4000.
    return String(num);
  }

  if (type === 'bytes') {
    const absVal = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (absVal >= 1024 * 1024 * 1024) {
      const g = absVal / (1024 * 1024 * 1024);
      return `${sign}${Number.isInteger(g) ? g : Number(g.toFixed(1))}G`;
    }
    if (absVal >= 1024 * 1024) {
      const m = absVal / (1024 * 1024);
      return `${sign}${Number.isInteger(m) ? m : Number(m.toFixed(1))}M`;
    }
    if (absVal >= 1024) {
      const k = absVal / 1024;
      return `${sign}${Number.isInteger(k) ? k : Number(k.toFixed(1))}K`;
    }
    return String(num);
  }

  if (type === 'seconds') {
    const absVal = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (absVal >= 3600 && absVal % 3600 === 0) {
      return `${sign}${absVal / 3600}h`;
    }
    if (absVal >= 60 && absVal % 60 === 0) {
      return `${sign}${absVal / 60}m`;
    }
    return String(num);
  }

  return String(num);
}

/**
 * 语义等价比对：用于判断两个输入（数字、字符串或带单位表达式）在业务数值上是否实质等价。
 */
export function areQuantitiesEquivalent(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  type: QuantityType = 'bytes',
): boolean {
  if (a === b) return true;
  const isEmptyA = a === null || a === undefined || a === '';
  const isEmptyB = b === null || b === undefined || b === '';
  if (isEmptyA && isEmptyB) return true;
  if (isEmptyA || isEmptyB) return false;

  const parsedA = typeof a === 'number' ? a : parseQuantity(a, type);
  const parsedB = typeof b === 'number' ? b : parseQuantity(b, type);

  if (parsedA === null || parsedB === null) return false;
  return parsedA === parsedB;
}
