// WebMCP — 供 AI 代理发现和调用站点工具
// 参考: https://webmachinelearning.github.io/webmcp/
(function () {
  if (!navigator.modelContext) return;

  navigator.modelContext.provideContext({
    tools: [
      {
        name: 'get-features',
        description: '获取 Nexus Terminal 的所有功能列表',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: async function () {
          return {
            features: [
              'SSH 终端（多标签、会话挂起、分屏）',
              'SFTP 文件管理（双面板、拖拽上传）',
              'RDP 远程桌面（基于 Guacamole）',
              'VNC 远程桌面',
              'AI 智能助手（自然语言交互）',
              '批量命令执行',
              '2FA / Passkey 安全认证',
              '审计日志',
              'Docker 一键部署',
              '移动端适配',
            ],
          };
        },
      },
      {
        name: 'get-deployment-guide',
        description: '获取 Nexus Terminal 的部署指南',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: async function () {
          return {
            quickStart:
              'mkdir nexus-terminal && cd nexus-terminal && wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml && wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/.env -O .env && docker compose up -d',
            defaultPort: 18111,
            docsUrl: 'https://nexus.cosr.eu.org/deployment',
          };
        },
      },
      {
        name: 'get-comparison',
        description: '获取 Nexus Terminal 与同类工具的对比信息',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: async function () {
          return {
            alternatives: ['Apache Guacamole', 'Nexterm', 'Termix', 'ShellNGN', 'PuTTY', 'Termius'],
            advantages: [
              '支持 SSH/SFTP/RDP/VNC 全协议',
              'Docker 一键部署',
              '内置 AI 智能助手',
              '2FA + Passkey 安全认证',
              '会话挂起与恢复',
              '完整审计日志',
              '原生中文支持',
              '免费开源（MIT）',
            ],
            docsUrl: 'https://nexus.cosr.eu.org/features',
          };
        },
      },
      {
        name: 'get-use-cases',
        description: '获取 Nexus Terminal 的使用场景',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: async function () {
          return {
            scenarios: [
              '运维管理 — 服务器批量管理、故障排查、监控巡检',
              'NAS 管理 — 家庭/企业 NAS 文件管理',
              '开发调试 — 远程开发、CI/CD 管理、数据库管理',
              '团队协作 — 多人运维、权限管理',
              '教学演示 — 在线教学、屏幕共享',
            ],
            docsUrl: 'https://nexus.cosr.eu.org/use-cases',
          };
        },
      },
    ],
  });
})();
