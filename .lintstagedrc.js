module.exports = {
  // 债务回归门禁：阻止 TODO/skip/console.log/any 回流
  '*.{js,ts,vue,md}': ['npm run -s debt:check --'],

  // locale 文件：按 zh-CN 同步其他语言并校验 JSON 语法
  'packages/frontend/src/locales/*.json': ['node scripts/sync-locales.js --write --stage'],

  // 代码文件：拦截智能引号 + 安全格式化
  '*.{js,jsx,ts,tsx,mjs,cjs,vue}': [
    'node scripts/check-smart-quotes.js',
    'eslint --fix',
    'prettier --write',
  ],

  // JSON、CSS、Markdown 等文件
  '*.{json,css,md}': ['prettier --write'],
};
