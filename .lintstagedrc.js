module.exports = {
  // locale 文件：按 zh-CN 同步其他语言并校验 JSON 语法
  'packages/frontend/src/locales/*.json': ['node scripts/sync-locales.js --write --stage'],

  // TypeScript 和 JavaScript 文件
  '*.{js,ts}': ['eslint --fix', 'prettier --write'],

  // Vue 文件：同时执行 eslint 与 prettier
  '*.vue': ['eslint --fix', 'prettier --write'],

  // JSON、CSS、Markdown 等文件
  '*.{json,css,md}': ['prettier --write'],
};
