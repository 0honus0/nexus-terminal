/**
 * OutputProcessor WebWorker
 *
 * 在 Worker 线程中执行终端输出的语法高亮处理，
 * 避免大量终端输出阻塞主线程。
 *
 * 支持的任务类型：
 * - process: 处理终端输出文本，返回高亮后的内容
 */

import type { WorkerRequest, WorkerResponse } from './types';

/** ANSI 转义码常量 */
const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  BLACK: '\x1b[30m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  BRIGHT_BLACK: '\x1b[90m',
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW: '\x1b[93m',
  BRIGHT_BLUE: '\x1b[94m',
  BRIGHT_MAGENTA: '\x1b[95m',
  BRIGHT_CYAN: '\x1b[96m',
  BRIGHT_WHITE: '\x1b[97m',
};

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;
const TABLE_SEPARATOR_REGEX = /^[\s|+\-.]*[-+|]{3,}[\s|+\-.]*$/;

/** 输出类型枚举 */
enum OutputType {
  JSON = 'json',
  YAML = 'yaml',
  TABLE = 'table',
  LOG = 'log',
  TEXT = 'text',
}

/** 处理结果接口 */
interface ProcessedOutput {
  type: OutputType;
  content: string;
  metadata?: {
    isLong?: boolean;
    lineCount?: number;
    shouldFold?: boolean;
    foldThreshold?: number;
  };
}

/** 处理配置 */
interface ProcessConfig {
  foldThreshold?: number;
  enableHighlight?: boolean;
  enableTableFormat?: boolean;
  enableLinkDetection?: boolean;
}

// 默认配置
let config: ProcessConfig = {
  foldThreshold: 500,
  enableHighlight: true,
  enableTableFormat: true,
  enableLinkDetection: true,
};

// ==================== 消息处理 ====================

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'process': {
        const { text, options } = payload as { text: string; options?: ProcessConfig };
        if (options) config = { ...config, ...options };
        const result = processOutput(text);
        const response: WorkerResponse = { id, type, payload: result };
        self.postMessage(response);
        break;
      }
      case 'configure': {
        const options = payload as ProcessConfig;
        config = { ...config, ...options };
        const response: WorkerResponse = { id, type, payload: { ok: true } };
        self.postMessage(response);
        break;
      }
      default: {
        const response: WorkerResponse = {
          id,
          type,
          payload: null,
          error: `未知任务类型: ${type}`,
        };
        self.postMessage(response);
      }
    }
  } catch (error) {
    const response: WorkerResponse = {
      id,
      type,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

/**
 * Process terminal output into a structured, display-ready representation.
 *
 * @param output - Raw terminal text to process
 * @returns A `ProcessedOutput` containing the detected `type`, the processed `content` (sanitized and optionally highlighted/formatted), and `metadata` with `lineCount`, `isLong`, `shouldFold`, and `foldThreshold`
 */

function processOutput(output: string): ProcessedOutput {
  const normalized = normalizeNewlines(output);
  const sanitized = stripAnsiCodes(normalized);
  const lineCount = sanitized.length ? sanitized.split('\n').length : 0;

  // 大文件保护：超过 5000 行跳过高亮处理
  if (lineCount > 5000) {
    return {
      type: OutputType.TEXT,
      content: sanitized,
      metadata: {
        lineCount,
        isLong: lineCount > (config.foldThreshold ?? 500),
        shouldFold: lineCount > (config.foldThreshold ?? 500),
        foldThreshold: config.foldThreshold ?? 500,
      },
    };
  }

  const detectedType = detectType(sanitized);
  let content = sanitized;

  switch (detectedType) {
    case OutputType.JSON:
      content = config.enableHighlight ? highlightJSON(sanitized) : sanitized;
      break;
    case OutputType.YAML:
      content = config.enableHighlight ? highlightYAML(sanitized) : sanitized;
      break;
    case OutputType.LOG:
      content = config.enableHighlight ? highlightLog(sanitized) : sanitized;
      break;
    case OutputType.TABLE:
      content = config.enableTableFormat ? formatTable(sanitized) : sanitized;
      break;
  }

  if (config.enableLinkDetection) {
    content = highlightLinks(content);
  }

  return {
    type: detectedType,
    content,
    metadata: {
      lineCount,
      isLong: lineCount > (config.foldThreshold ?? 500),
      shouldFold: lineCount > (config.foldThreshold ?? 500),
      foldThreshold: config.foldThreshold ?? 500,
    },
  };
}

/**
 * Detects the semantic format of a text blob for display and highlighting purposes.
 *
 * @param output - Raw text to analyze.
 * @returns The detected OutputType: `JSON`, `YAML`, `TABLE`, `LOG`, or `TEXT`.
 */
function detectType(output: string): OutputType {
  const trimmed = output.trim();
  if (!trimmed) return OutputType.TEXT;

  if (/^[\[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return OutputType.JSON;
    } catch {
      // 非合法 JSON，继续后续格式检测
    }
  }

  const yamlLines = trimmed.split('\n');
  const yamlMatches = yamlLines.filter((line) => /^(\s*)([\w.-]+):\s+.+$/.test(line));
  if (yamlLines.length > 2 && yamlMatches.length >= 2) {
    return OutputType.YAML;
  }

  if (TABLE_SEPARATOR_REGEX.test(trimmed)) {
    return OutputType.TABLE;
  }

  const candidateLines = yamlLines.filter((line) => line.trim().length);
  if (candidateLines.length > 2) {
    const counts = candidateLines.map((line) => line.split(/\s{2,}/).filter(Boolean).length);
    const first = counts[0];
    if (first >= 3 && counts.every((count) => count === first)) {
      return OutputType.TABLE;
    }
  }

  if (
    /\d{4}[-/]\d{2}[-/]\d{2}|\d{2}:\d{2}:\d{2}|\b(ERROR|WARN|INFO|DEBUG|TRACE|SUCCESS|FAIL)\b/i.test(
      trimmed
    )
  ) {
    return OutputType.LOG;
  }

  return OutputType.TEXT;
}

/**
 * Applies ANSI color styling to JSON for terminal syntax highlighting.
 *
 * @param jsonText - The JSON text to highlight.
 * @returns The JSON text reserialized with ANSI color codes applied to keys, string values, numeric values, booleans, `null`, and punctuation; returns `jsonText` unchanged if it is not valid JSON.
 */
function highlightJSON(jsonText: string): string {
  try {
    const parsed = JSON.parse(jsonText);
    const formatted = JSON.stringify(parsed, null, 2);
    return formatted
      .replace(/"([^"\\]+)":/g, `${ANSI.CYAN}${ANSI.BOLD}"$1"${ANSI.RESET}:`)
      .replace(/:\s*"([^"\\]*)"/g, `: ${ANSI.GREEN}"$1"${ANSI.RESET}`)
      .replace(/:\s*(-?\d+(?:\.\d+)?)/g, `: ${ANSI.YELLOW}$1${ANSI.RESET}`)
      .replace(/:\s*(true|false)/gi, `: ${ANSI.MAGENTA}$1${ANSI.RESET}`)
      .replace(/:\s*null/gi, `: ${ANSI.BRIGHT_BLACK}null${ANSI.RESET}`)
      .replace(/([{}\[\],])/g, `${ANSI.WHITE}$1${ANSI.RESET}`);
  } catch {
    return jsonText;
  }
}

/**
 * Apply ANSI styling to log text to emphasize timestamps, level tokens, IPv4 addresses, and HTTP-like status codes.
 *
 * @param logText - Log content to transform; may contain multiple lines.
 * @returns The input text with ANSI escape sequences applied to recognized timestamps, level tokens, IPv4 addresses, and three-digit status codes.
 */
function highlightLog(logText: string): string {
  return logText
    .split('\n')
    .map((line) => {
      let transformed = line.replace(
        /(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/g,
        `${ANSI.BRIGHT_BLACK}$1${ANSI.RESET}`
      );
      transformed = transformed
        .replace(/\b(ERROR|ERR)\b/gi, `${ANSI.BRIGHT_RED}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(WARN|WARNING)\b/gi, `${ANSI.BRIGHT_YELLOW}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(INFO)\b/gi, `${ANSI.BRIGHT_CYAN}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(DEBUG)\b/gi, `${ANSI.BRIGHT_BLACK}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(SUCCESS|OK)\b/gi, `${ANSI.BRIGHT_GREEN}${ANSI.BOLD}$1${ANSI.RESET}`);
      transformed = transformed.replace(
        /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g,
        `${ANSI.YELLOW}$1${ANSI.RESET}`
      );
      transformed = transformed.replace(/\b([2-5]\d{2})\b/g, (match) => {
        const code = Number(match);
        if (code >= 200 && code < 300) return `${ANSI.GREEN}${match}${ANSI.RESET}`;
        if (code >= 300 && code < 400) return `${ANSI.CYAN}${match}${ANSI.RESET}`;
        if (code >= 400 && code < 500) return `${ANSI.YELLOW}${match}${ANSI.RESET}`;
        if (code >= 500) return `${ANSI.RED}${match}${ANSI.RESET}`;
        return match;
      });
      return transformed;
    })
    .join('\n');
}

/**
 * Format raw table-like text into an aligned, ANSI-colored table.
 *
 * @param tableText - The raw table text to format; rows may use `|` separators or two-or-more spaces between columns.
 * @returns The formatted multi-line table with columns aligned and ANSI color codes applied. If the input contains no parsable table rows, the original `tableText` is returned unchanged.
 */
function formatTable(tableText: string): string {
  const lines = tableText.split('\n').filter((line) => line.trim().length);
  if (!lines.length) return tableText;

  type TableLine = { kind: 'separator'; raw: string } | { kind: 'row'; cells: string[] };

  const parsedLines: TableLine[] = lines.map((line) => {
    if (TABLE_SEPARATOR_REGEX.test(line.trim())) {
      return { kind: 'separator', raw: line };
    }
    return { kind: 'row', cells: parseTableCells(line) };
  });

  const rows = parsedLines.filter(
    (line): line is { kind: 'row'; cells: string[] } => line.kind === 'row' && line.cells.length > 0
  );
  if (!rows.length) return tableText;

  const columnCount = Math.max(...rows.map((row) => row.cells.length));
  if (columnCount === 0) return tableText;

  const columnWidths = Array(columnCount).fill(0);
  rows.forEach((row) => {
    row.cells.forEach((cell, index) => {
      if (cell.length > columnWidths[index]) {
        columnWidths[index] = cell.length;
      }
    });
  });

  let rowIndex = 0;
  const formatted = parsedLines.map((line) => {
    if (line.kind === 'separator') {
      return `${ANSI.BRIGHT_BLACK}${line.raw}${ANSI.RESET}`;
    }
    const paddedCells = columnWidths.map((width, index) => {
      const cell = line.cells[index] ?? '';
      return cell.padEnd(width);
    });
    const joined = paddedCells.join('  ').trimEnd();
    if (rowIndex === 0) {
      rowIndex += 1;
      return `${ANSI.CYAN}${ANSI.BOLD}${joined}${ANSI.RESET}`;
    }
    rowIndex += 1;
    return joined;
  });

  return formatted.join('\n');
}

/**
 * Colorizes full HTTP(S) URLs and eligible path-like fragments in the given text using ANSI styles.
 *
 * The function first colors complete `http://` and `https://` URLs, then colors path-like segments
 * that start with `/` when they are preceded by whitespace or certain punctuation. It does not
 * color a path when the prefix ends with `:` or when the path begins with `//`.
 *
 * @param text - Input text to scan for URLs and path-like segments
 * @returns The input string with matched URLs and eligible paths wrapped in ANSI color codes
 */
function highlightLinks(text: string): string {
  let result = text.replace(/(https?:\/\/[^\s]+)/g, `${ANSI.BLUE}${ANSI.BOLD}$1${ANSI.RESET}`);
  result = result.replace(
    /(^|[\s"'\(\[])(\/([\w.+-]+\/){0,20}[\w.+-]*)/g,
    (_match: string, prefix: string, path: string) => {
      if (prefix.endsWith(':') || path.startsWith('//')) {
        return `${prefix}${path}`;
      }
      return `${prefix}${ANSI.CYAN}${path}${ANSI.RESET}`;
    }
  );
  return result;
}

/**
 * Parse a single table row into an array of cell strings.
 *
 * Supports pipe-separated rows (cells delimited with `|`) and whitespace-separated rows (columns separated by two or more spaces).
 *
 * @param line - The raw table row text to parse.
 * @returns An array of trimmed cell strings. For pipe-separated rows, leading and trailing empty cells produced by surrounding `|` are removed. For whitespace-separated rows, splits on runs of two or more spaces; empty cells are omitted unless the original line contains two consecutive spaces, in which case empty segments are preserved.
 */
function parseTableCells(line: string): string[] {
  if (line.includes('|')) {
    const raw = line.split('|').map((cell) => cell.trim());
    if (raw.length > 1 && raw[0] === '') raw.shift();
    if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
    return raw.map((cell) => cell.trim());
  }
  return line
    .trim()
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length || line.includes('  '));
}

/**
 * Normalize newline sequences to LF (`\n`).
 *
 * @param value - The input text whose line endings should be normalized
 * @returns The input string with all CRLF (`\r\n`) and CR (`\r`) sequences replaced by LF (`\n`)
 */
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/**
 * Strip ANSI SGR (Select Graphic Rendition) escape sequences from the provided string.
 *
 * @param value - Input string that may contain ANSI SGR escape sequences (e.g., color or style codes like `\x1b[31m`)
 * @returns The input string with all ANSI SGR escape sequences removed
 */
function stripAnsiCodes(value: string): string {
  return value.replace(ANSI_ESCAPE_REGEX, '');
}
