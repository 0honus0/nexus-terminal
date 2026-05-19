import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Nexus Terminal',
  description: '现代化、功能丰富的 Web SSH / RDP / VNC 客户端，提供高度可定制的远程连接体验',

  head: [
    ['meta', { name: 'theme-color', content: '#3c8dbc' }],
    // Canonical URL
    ['link', { rel: 'canonical', href: 'https://nexus.cosr.eu.org' }],
    // Preconnect
    ['link', { rel: 'preconnect', href: 'https://github.com' }],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: '星枢终端 - Web SSH/RDP/VNC 远程连接客户端' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          '现代化 Web SSH / RDP / VNC 客户端，支持 Docker 一键部署、2FA 安全认证、AI 智能助手',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://nexus.cosr.eu.org' }],
    ['meta', { property: 'og:site_name', content: 'Nexus Terminal' }],
    ['meta', { property: 'og:locale', content: 'zh_CN' }],
    ['meta', { property: 'og:image', content: 'https://nexus.cosr.eu.org/og-image.png' }],
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: 'https://nexus.cosr.eu.org/og-image.png' }],
    ['meta', { name: 'twitter:title', content: '星枢终端 - Web SSH/RDP/VNC 远程连接客户端' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content: '现代化 Web SSH / RDP / VNC 客户端，支持 Docker 一键部署、2FA 安全认证',
      },
    ],
    // JSON-LD 结构化数据
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Nexus Terminal',
        description: '现代化、功能丰富的 Web SSH / RDP / VNC 客户端，提供高度可定制的远程连接体验',
        url: 'https://nexus.cosr.eu.org',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Linux, macOS, Windows',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
        softwareVersion: '1.2.0',
        author: { '@type': 'Person', name: 'Silentely' },
      }),
    ],
    // WebMCP — 供 AI 代理在浏览器中发现和调用站点工具
    ['script', { src: '/webmcp.js', defer: true }],
    // RFC 8288 Link headers — 供 AI 代理发现 API 目录和 MCP 服务
    [
      'link',
      {
        rel: 'api-catalog',
        href: '/.well-known/api-catalog.json',
        type: 'application/linkset+json',
      },
    ],
    [
      'link',
      {
        rel: 'mcp-server-card',
        href: '/.well-known/mcp/server-card.json',
        type: 'application/json',
      },
    ],
    [
      'link',
      {
        rel: 'agent-skills',
        href: '/.well-known/agent-skills/index.json',
        type: 'application/json',
      },
    ],
  ],

  cleanUrls: true,

  themeConfig: {
    logo: '/favicon.ico',
    siteTitle: 'Nexus Terminal',

    nav: [
      { text: '首页', link: '/' },
      { text: '功能介绍', link: '/features' },
      { text: '使用场景', link: '/use-cases' },
      { text: '部署教程', link: '/deployment' },
      { text: '高级配置', link: '/configuration' },
      { text: '常见问题', link: '/faq' },
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '功能介绍', link: '/features' },
          { text: '使用场景', link: '/use-cases' },
          { text: '部署教程', link: '/deployment' },
        ],
      },
      {
        text: '配置',
        items: [
          { text: '环境变量配置', link: '/configuration/docker' },
          { text: 'CORS 跨域配置', link: '/configuration/cors' },
        ],
      },
      {
        text: '部署',
        items: [
          { text: 'Nginx 反向代理', link: '/deployment/nginx' },
          { text: 'CDN 边缘部署', link: '/deployment/cdn' },
        ],
      },
      {
        text: '技术文档',
        items: [{ text: '技术债务报告', link: '/technical/debt' }],
      },
      {
        text: '帮助',
        items: [
          { text: '常见问题', link: '/faq' },
          { text: '贡献指南', link: '/contributing' },
          { text: '提交规范', link: '/contributing/commit' },
          { text: '问题分类策略', link: '/contributing/triage' },
          { text: '更新日志', link: '/changelog' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/Silentely/nexus-terminal' }],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: { selectText: '选择', navigateText: '切换' },
          },
        },
      },
    },

    footer: {
      message: 'IP 地理位置数据由 <a href="https://iplocate.io" target="_blank" rel="noopener">IPLocate</a> 提供',
      copyright: 'Copyright © 2024-2026 Silentely',
    },

    editLink: {
      pattern: 'https://github.com/Silentely/nexus-terminal/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页面',
    },

    lastUpdated: { text: '最后更新于' },

    outline: { level: [2, 3], label: '页面导航' },

    docFooter: { prev: '上一页', next: '下一页' },

    returnToTopLabel: '回到顶部',
  },

  markdown: {
    lineNumbers: true,
    shiki: {
      langs: ['dotenv'],
    },
  },
});
