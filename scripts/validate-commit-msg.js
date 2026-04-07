#!/usr/bin/env node

const fs = require('node:fs');

const commitMsgFile = process.argv[2];

if (!commitMsgFile) {
  console.error('缺少 commit message 文件路径参数');
  process.exit(1);
}

const content = fs.readFileSync(commitMsgFile, 'utf8').trim();
const header = content.split('\n')[0].trim();

if (!header) {
  console.error('提交信息不能为空');
  process.exit(1);
}

const ignoredPrefixes = [/^Merge\b/i, /^WIP\b/i, /^Revert\b/];
if (ignoredPrefixes.some((pattern) => pattern.test(header))) {
  process.exit(0);
}

const headerPattern =
  /^(:[\w+-]+:|[\p{Extended_Pictographic}\uFE0F](?:[\u200D\p{Extended_Pictographic}\uFE0F])*)\s+(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|security|release)(?:\([^)]+\))?!?:\s(.+)$/u;

const matched = header.match(headerPattern);

if (!matched) {
  console.error('提交信息格式不符合要求。');
  console.error('允许格式：<emoji> <type>(<scope>): <中文描述>');
  console.error('示例：✨ feat(websocket): 增加静默执行路径同步');
  process.exit(1);
}

const subject = matched[3];
if (!/[\u4e00-\u9fff]/.test(subject)) {
  console.error('提交主题必须包含中文描述。');
  console.error('示例：🐛 fix(lint): 修复 eslint-plugin-import 异常');
  process.exit(1);
}
