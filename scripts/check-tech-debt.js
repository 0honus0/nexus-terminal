#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const CHECKS = [
  {
    key: 'todo',
    name: 'TODO/FIXME/HACK',
    description: '代码标记债务',
    args: ['-n', '\\b(TODO|FIXME|HACK)\\b', 'packages', '--glob', '!**/*.md'],
  },
  {
    key: 'skip',
    name: 'test.skip/it.skip',
    description: 'E2E 跳过用例',
    args: ['-n', '\\b(test|it)\\.skip\\(', 'packages/frontend/e2e/tests'],
  },
  {
    key: 'console',
    name: 'console.log(',
    description: '业务源码日志治理',
    args: [
      '-n',
      'console\\.log\\(',
      'packages/backend/src',
      'packages/frontend/src',
      'packages/remote-gateway/src',
    ],
  },
  {
    key: 'any',
    name: ': any / <any> / any[]',
    description: '业务源码 any 类型治理',
    args: [
      '-n',
      '(:\\s*any\\b|<any>|\\bany\\[\\])',
      'packages/backend/src',
      'packages/frontend/src',
      'packages/remote-gateway/src',
      '--glob',
      '!**/*.d.ts',
    ],
  },
];

function runRipgrep(args) {
  const result = spawnSync('rg', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error('未找到 rg（ripgrep），请先安装后再执行 debt:check。');
      process.exit(2);
    }
    console.error(`执行 rg 失败: ${result.error.message}`);
    process.exit(2);
  }

  if (result.status === 0) {
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (result.status === 1) {
    return [];
  }

  console.error(result.stderr || result.stdout);
  process.exit(result.status || 2);
}

function printSection(title, lines, max = 20) {
  console.error(`\n- ${title}: ${lines.length}`);
  lines.slice(0, max).forEach((line) => {
    console.error(`  ${line}`);
  });
  if (lines.length > max) {
    console.error(`  ... 其余 ${lines.length - max} 条已省略`);
  }
}

function main() {
  const results = CHECKS.map((check) => {
    const lines = runRipgrep(check.args);
    return { ...check, lines };
  });

  const total = results.reduce((acc, item) => acc + item.lines.length, 0);

  console.log('技术债务回归扫描结果:');
  results.forEach((item) => {
    console.log(`- ${item.description}: ${item.lines.length}`);
  });

  if (total > 0) {
    console.error('\n检测到技术债务回归，请先修复后再提交:');
    results
      .filter((item) => item.lines.length > 0)
      .forEach((item) => printSection(item.name, item.lines));
    process.exit(1);
  }

  console.log('\n✅ 技术债务检查通过（TODO/skip/console.log/any 均为 0）');
}

main();
