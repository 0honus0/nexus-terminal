/**
 * Lighthouse CI 配置文件
 *
 * 用于前端性能、可访问性、最佳实践和 SEO 自动化测试
 */

module.exports = {
  ci: {
    collect: {
      // 测试的 URL 列表
      url: [
        'http://localhost:5173/', // 开发服务器首页
        'http://localhost:5173/login', // 登录页
        'http://localhost:5173/workspace', // 工作区
        'http://localhost:5173/settings', // 设置页
      ],
      // 每个 URL 运行 3 次取平均值
      numberOfRuns: 3,
      // 启动服务器配置（可选）
      startServerCommand: 'npm run dev',
      startServerReadyPattern: 'Local:.*5173',
      startServerReadyTimeout: 30000,
      // 使用桌面模式（与移动端分开测试）
      settings: {
        preset: 'desktop',
        // 自定义设备配置
        screenEmulation: {
          mobile: false,
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1,
          disabled: false,
        },
        // 禁用存储清除（保持登录状态）
        disableStorageReset: false,
        // 扩展运行时间限制（用于复杂 SPA）
        maxWaitForLoad: 45000,
      },
    },
    assert: {
      // 性能预算断言
      assertions: {
        // 性能指标
        'categories:performance': ['error', { minScore: 0.8 }], // 性能评分 ≥ 80
        'categories:accessibility': ['warn', { minScore: 0.9 }], // 可访问性评分 ≥ 90
        'categories:best-practices': ['warn', { minScore: 0.85 }], // 最佳实践评分 ≥ 85
        'categories:seo': ['warn', { minScore: 0.8 }], // SEO 评分 ≥ 80

        // Core Web Vitals（核心网页指标）
        'first-contentful-paint': ['warn', { maxNumericValue: 2000 }], // FCP ≤ 2s
        'largest-contentful-paint': ['error', { maxNumericValue: 3500 }], // LCP ≤ 3.5s
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }], // CLS ≤ 0.1
        'total-blocking-time': ['warn', { maxNumericValue: 300 }], // TBT ≤ 300ms
        interactive: ['error', { maxNumericValue: 5000 }], // TTI ≤ 5s

        // 资源加载性能
        'speed-index': ['warn', { maxNumericValue: 4000 }], // 速度指数 ≤ 4s
        'max-potential-fid': ['warn', { maxNumericValue: 100 }], // 最大 FID ≤ 100ms

        // 资源优化
        'unused-css-rules': ['warn', { maxLength: 1 }], // 未使用的 CSS
        'unused-javascript': ['warn', { maxLength: 1 }], // 未使用的 JavaScript
        'modern-image-formats': ['warn', { maxLength: 0 }], // 使用现代图片格式
        'uses-optimized-images': ['warn', { maxLength: 0 }], // 图片优化
        'uses-text-compression': ['warn', { maxLength: 0 }], // 文本压缩
        'uses-responsive-images': ['warn', { maxLength: 0 }], // 响应式图片

        // 网络性能
        'uses-http2': ['warn', { minScore: 1 }], // 使用 HTTP/2
        'uses-long-cache-ttl': ['warn', { maxLength: 1 }], // 缓存策略
        'total-byte-weight': ['warn', { maxNumericValue: 3000000 }], // 总字节数 ≤ 3MB

        // 可访问性
        'aria-required-attr': ['error', { minScore: 1 }], // ARIA 必需属性
        'button-name': ['error', { minScore: 1 }], // 按钮名称
        'color-contrast': ['warn', { minScore: 1 }], // 颜色对比度
        'document-title': ['error', { minScore: 1 }], // 文档标题
        'html-has-lang': ['error', { minScore: 1 }], // HTML lang 属性
        'image-alt': ['error', { minScore: 1 }], // 图片 alt 属性
        label: ['error', { minScore: 1 }], // 表单 label
        'link-name': ['error', { minScore: 1 }], // 链接名称

        // 最佳实践
        'errors-in-console': ['warn', { maxLength: 0 }], // 控制台错误
        'is-on-https': ['off', {}], // HTTPS（本地开发可关闭）
        'no-vulnerable-libraries': ['error', { minScore: 1 }], // 漏洞依赖
        'uses-passive-event-listeners': ['warn', { minScore: 1 }], // 被动事件监听器
      },
    },
    upload: {
      // 上传结果到 Lighthouse CI 服务器（可选）
      target: 'temporary-public-storage',
    },
    server: {
      // 可选：启动本地 LHCI 服务器查看历史结果
      // port: 9001,
      // storage: {
      //   storageMethod: 'sql',
      //   sqlDialect: 'sqlite',
      //   sqlDatabasePath: './lhci-data.db',
      // },
    },
  },
};
