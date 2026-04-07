# 星枢终端 - 个人使用版功能规划路线图

> **定位说明**：本项目定位为个人使用的远程终端管理工具，不涉及多用户、权限管理、团队协作等功能，专注于提升个人运维效率与使用体验。

---

## 📋 目录

- [设计原则](#设计原则)
- [Phase 6: 个人工作流增强](#phase-6-个人工作流增强)
- [Phase 7: 智能化与自动化](#phase-7-智能化与自动化)
- [Phase 8: 数据洞察与可视化](#phase-8-数据洞察与可视化)
- [Phase 9: 跨平台与同步](#phase-9-跨平台与同步)
- [Phase 10: 高级终端能力](#phase-10-高级终端能力)
- [Phase 11: 个人知识库](#phase-11-个人知识库)
- [长期愿景功能](#长期愿景功能)
- [实施优先级矩阵](#实施优先级矩阵)
- [技术架构演进建议](#技术架构演进建议)

---

## 🎯 设计原则

### 核心理念

1. **个人优先**：所有功能围绕单用户体验设计，无需考虑权限分级
2. **效率至上**：减少重复操作，快捷键优先，自动化流程
3. **数据本地**：敏感数据本地存储，云端功能可选
4. **渐进增强**：功能分阶段实施，保持系统稳定性
5. **轻量灵活**：避免过度设计，保持部署简单

### 技术约束

- SQLite 作为唯一数据库，避免引入复杂存储
- 后端保持单进程架构，通过 WebSocket 长连接实现实时性
- 前端组件化开发，按需加载减少初始体积
- Docker 部署为主，支持本地开发环境

---

## Phase 6: 个人工作流增强

### 6.1 快速命令模板系统 ⭐⭐⭐

**功能描述**：

- 支持参数化命令模板（如 `docker logs -f {{container}}`）
- 模板分组管理（系统维护、开发调试、数据备份等）
- 模板变量提示与历史记录
- 支持模板链（多条命令序列执行）

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE command_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  template TEXT NOT NULL,          -- 命令模板，支持 {{var}} 占位符
  category TEXT DEFAULT 'general', -- 分组
  variables TEXT,                  -- JSON 数组，存储变量定义
  is_chain BOOLEAN DEFAULT 0,      -- 是否为命令链
  chain_delay INTEGER DEFAULT 1000,-- 命令链延迟（毫秒）
  order_index INTEGER DEFAULT 0,   -- 排序
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE template_variable_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  variable_name TEXT NOT NULL,
  variable_value TEXT NOT NULL,
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES command_templates(id) ON DELETE CASCADE
);

CREATE INDEX idx_template_category ON command_templates(category);
CREATE INDEX idx_variable_history ON template_variable_history(template_id, variable_name);
```

#### 后端模块 (`packages/backend/src/command-templates/`)

```
command-templates/
├── routes.ts           # RESTful API 路由
├── controller.ts       # 请求处理
├── service.ts          # 业务逻辑：模板解析、变量替换
├── repository.ts       # 数据访问
└── types.ts           # 类型定义
```

#### 关键接口

- `GET /api/v1/command-templates` - 获取所有模板（支持分类筛选）
- `POST /api/v1/command-templates` - 创建模板
- `PUT /api/v1/command-templates/:id` - 更新模板
- `DELETE /api/v1/command-templates/:id` - 删除模板
- `POST /api/v1/command-templates/:id/render` - 渲染模板（替换变量）
- `GET /api/v1/command-templates/:id/variable-history/:name` - 获取变量历史记录

#### 前端组件 (`packages/frontend/src/features/command-templates/`)

```
command-templates/
├── components/
│   ├── TemplateList.vue          # 模板列表（支持拖拽排序）
│   ├── TemplateEditor.vue        # 模板编辑器（Monaco Editor）
│   ├── VariableInput.vue         # 变量输入弹窗（支持历史记录自动完成）
│   └── ChainExecutor.vue         # 命令链执行器（显示进度）
├── stores/
│   └── template.store.ts         # Pinia Store
└── composables/
    ├── useTemplateParser.ts      # 模板解析逻辑
    └── useTemplateExecution.ts   # 执行逻辑
```

**预计工作量**：5-7 天

---

### 6.2 工作区快照与场景切换 ⭐⭐⭐

**功能描述**：

- 保存当前工作区状态（所有打开的连接、标签页、布局）
- 一键恢复工作区快照
- 场景预设（如"前端开发"、"服务器巡检"、"数据库维护"）
- 自动快照功能（每日自动保存）

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE workspace_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  snapshot_data TEXT NOT NULL,    -- JSON 格式存储完整工作区状态
  is_auto BOOLEAN DEFAULT 0,      -- 是否为自动快照
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_snapshot_auto ON workspace_snapshots(is_auto, created_at);
```

#### snapshot_data 结构示例

```json
{
  "layout": "three-column",
  "connections": [
    {
      "id": 123,
      "protocol": "ssh",
      "tabs": [
        { "type": "terminal", "title": "web-server", "suspended": false },
        { "type": "sftp", "path": "/var/www", "filters": ["*.log"] }
      ]
    }
  ],
  "appearance": {
    "theme": "dracula",
    "fontSize": 14
  },
  "metadata": {
    "totalConnections": 3,
    "openTabs": 8
  }
}
```

#### 后端模块 (`packages/backend/src/workspace/`)

```
workspace/
├── routes.ts
├── controller.ts
├── service.ts          # 快照创建、恢复逻辑
├── repository.ts
└── scheduler.ts        # 定时任务：自动快照（使用 node-cron）
```

#### 前端组件 (`packages/frontend/src/features/workspace/`)

```
workspace/
├── components/
│   ├── SnapshotManager.vue       # 快照管理面板
│   ├── SnapshotCard.vue          # 快照预览卡片
│   └── RestorePreview.vue        # 恢复预览对话框
└── composables/
    └── useWorkspaceRestore.ts    # 工作区恢复逻辑
```

**关键交互**：

1. 用户点击"保存工作区"，触发前端收集当前状态
2. 前端发送快照数据到后端存储
3. 恢复时，前端按快照数据依次重建连接和标签页

**预计工作量**：4-6 天

---

### 6.3 连接分组与标签系统 ⭐⭐

**功能描述**：

- 为 SSH 连接添加多标签（生产、测试、个人等）
- 按标签筛选连接
- 颜色标记（为不同标签设置颜色）
- 快速切换标签组

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE connection_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3B82F6',   -- 标签颜色（Hex）
  icon TEXT,                       -- 可选图标名称
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE connection_tag_mapping (
  connection_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (connection_id, tag_id),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES connection_tags(id) ON DELETE CASCADE
);
```

#### 后端接口

- `GET /api/v1/tags` - 获取所有标签
- `POST /api/v1/tags` - 创建标签
- `POST /api/v1/connections/:id/tags` - 为连接添加标签
- `GET /api/v1/connections?tags=prod,dev` - 按标签筛选连接

#### 前端实现

- 在连接列表中显示标签徽章
- 标签管理面板（拖拽排序、颜色选择器）
- 筛选器组件（支持多选标签）

**预计工作量**：2-3 天

---

### 6.4 命令书签与收藏夹 ⭐⭐

**功能描述**：

- 为常用命令添加书签
- 支持快捷键直接执行收藏命令
- 书签分组与搜索
- 命令执行统计（展示最常用命令）

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE command_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  hotkey TEXT,                     -- 快捷键（如 'Ctrl+Shift+1'）
  execute_count INTEGER DEFAULT 0, -- 执行次数
  last_executed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bookmark_category ON command_bookmarks(category);
CREATE INDEX idx_bookmark_execute_count ON command_bookmarks(execute_count DESC);
```

#### 前端快捷键集成

- 使用 `@vueuse/core` 的 `useMagicKeys` 绑定快捷键
- 快捷键冲突检测
- 全局快捷键面板（显示所有绑定）

**预计工作量**：2-3 天

---

## Phase 7: 智能化与自动化

### 7.1 智能命令推荐系统 ⭐⭐⭐

**功能描述**：

- 基于历史命令分析，推荐下一步可能的操作
- 上下文感知推荐（如在 Docker 目录下推荐 docker 命令）
- 错误命令纠正建议
- 命令补全增强（基于服务器环境）

**实施方案**：

#### 数据分析模块 (`packages/backend/src/analytics/`)

```typescript
// command-pattern.service.ts
class CommandPatternService {
  // 分析命令序列模式（如 git add -> git commit -> git push）
  async analyzeCommandSequences(connectionId: number): Promise<Pattern[]> {
    const history = await this.getRecentHistory(connectionId, 100);
    return this.findFrequentSequences(history, 3); // 找出3步命令序列
  }

  // 基于当前目录推荐命令
  async getContextualSuggestions(connectionId: number, currentPath: string): Promise<Suggestion[]> {
    // 检测 package.json -> 推荐 npm 命令
    // 检测 Dockerfile -> 推荐 docker 命令
    // 检测 .git -> 推荐 git 命令
  }

  // 命令纠错（使用 Levenshtein 距离）
  suggestCorrection(command: string): string | null {
    const commonCommands = ['docker', 'git', 'npm', 'systemctl', 'kubectl'];
    // 计算编辑距离，返回最接近的命令
  }
}
```

#### 前端智能提示 (`packages/frontend/src/features/smart-suggestions/`)

```vue
<!-- SmartSuggestionPanel.vue -->
<template>
  <div class="smart-suggestions">
    <div v-if="suggestions.length" class="suggestion-card">
      <div class="suggestion-header">💡 智能推荐</div>
      <div v-for="sug in suggestions" :key="sug.id" class="suggestion-item">
        <span class="suggestion-command">{{ sug.command }}</span>
        <span class="suggestion-reason">{{ sug.reason }}</span>
        <button @click="applySuggestion(sug)">执行</button>
      </div>
    </div>
  </div>
</template>
```

**关键技术**：

- 使用滑动窗口分析命令序列
- TF-IDF 算法提取命令特征
- 基于马尔可夫链预测下一个命令

**预计工作量**：6-8 天

---

### 7.2 自动化巡检任务 ⭐⭐⭐

**功能描述**：

- 定时执行健康检查脚本（磁盘空间、内存使用、服务状态）
- 异常自动告警（邮件/Webhook）
- 巡检报告生成（支持导出 PDF/Markdown）
- 历史趋势分析

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE patrol_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  target_connections TEXT NOT NULL, -- JSON 数组，目标连接 ID
  check_script TEXT NOT NULL,       -- 巡检脚本内容
  cron_expression TEXT NOT NULL,    -- Cron 表达式
  alert_threshold TEXT,             -- JSON，告警阈值配置
  is_enabled BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE patrol_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  connection_id INTEGER NOT NULL,
  status TEXT NOT NULL,             -- success / warning / error
  metrics TEXT,                     -- JSON，巡检指标数据
  alert_triggered BOOLEAN DEFAULT 0,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES patrol_tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_patrol_results_time ON patrol_results(executed_at DESC);
CREATE INDEX idx_patrol_results_status ON patrol_results(status);
```

#### 巡检脚本示例

```bash
#!/bin/bash
# disk_check.sh
df -h | awk '$5 > 80 {print "WARNING: " $1 " is " $5 " full"}'
free -m | awk 'NR==2{printf "Memory Usage: %.2f%%\n", $3*100/$2 }'
systemctl is-active docker nginx | grep -v active && echo "ERROR: Service down"
```

#### 后端调度器 (`packages/backend/src/patrol/scheduler.ts`)

```typescript
import cron from 'node-cron';

class PatrolScheduler {
  async scheduleTask(task: PatrolTask): Promise<void> {
    cron.schedule(task.cronExpression, async () => {
      const results = await this.executePatrol(task);
      await this.saveResults(results);
      await this.checkAlerts(results, task.alertThreshold);
    });
  }

  async executePatrol(task: PatrolTask): Promise<PatrolResult[]> {
    const results: PatrolResult[] = [];
    for (const connId of task.targetConnections) {
      const output = await this.sshService.executeCommand(connId, task.checkScript);
      results.push(this.parseOutput(output, connId));
    }
    return results;
  }
}
```

#### 前端巡检面板 (`packages/frontend/src/features/patrol/`)

```
patrol/
├── components/
│   ├── PatrolDashboard.vue       # 巡检仪表盘（显示最新状态）
│   ├── PatrolTaskEditor.vue      # 任务编辑器
│   ├── PatrolHistory.vue         # 历史记录（图表展示）
│   └── AlertRuleEditor.vue       # 告警规则配置
└── composables/
    └── usePatrolScheduler.ts
```

**关键功能**：

- 支持预设巡检模板（系统资源、服务健康、日志分析）
- 趋势图表（使用 Chart.js 绘制时间序列）
- 报告导出（使用 jsPDF 生成 PDF）

**预计工作量**：7-10 天

---

### 7.3 文件自动备份与同步 ⭐⭐

**功能描述**：

- 定时备份指定远程目录到本地
- 支持增量备份（rsync 模式）
- 备份版本管理（保留最近 N 个版本）
- 远程目录变化监控（类似 inotify）

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE backup_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  connection_id INTEGER NOT NULL,
  remote_path TEXT NOT NULL,
  local_path TEXT NOT NULL,         -- 本地存储路径（相对于 data 目录）
  backup_mode TEXT DEFAULT 'full',  -- full / incremental
  schedule TEXT NOT NULL,           -- Cron 表达式
  retention_count INTEGER DEFAULT 7,-- 保留版本数
  is_enabled BOOLEAN DEFAULT 1,
  last_backup_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

CREATE TABLE backup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  backup_path TEXT NOT NULL,
  backup_size INTEGER,
  file_count INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES backup_jobs(id) ON DELETE CASCADE
);
```

#### 后端备份服务 (`packages/backend/src/backup/service.ts`)

```typescript
import { Client } from 'ssh2';
import fs from 'fs-extra';
import archiver from 'archiver';

class BackupService {
  async executeBackup(job: BackupJob): Promise<void> {
    const sftp = await this.connectSFTP(job.connectionId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = `${job.localPath}/${timestamp}`;

    await fs.ensureDir(backupDir);

    if (job.backupMode === 'incremental') {
      await this.incrementalBackup(sftp, job.remotePath, backupDir);
    } else {
      await this.fullBackup(sftp, job.remotePath, backupDir);
    }

    // 压缩备份
    await this.compressBackup(backupDir);

    // 清理旧备份
    await this.cleanOldBackups(job);
  }

  async incrementalBackup(sftp: any, remotePath: string, localPath: string) {
    // 比较文件修改时间，只下载变化的文件
    const remoteFiles = await this.listRemoteFiles(sftp, remotePath);
    const lastBackup = await this.getLastBackupManifest(localPath);

    for (const file of remoteFiles) {
      if (!lastBackup[file.path] || file.mtime > lastBackup[file.path].mtime) {
        await this.downloadFile(sftp, file.path, localPath);
      }
    }
  }
}
```

**前端界面**：

- 备份任务管理列表
- 备份历史查看器（可预览备份内容）
- 一键还原功能

**预计工作量**：5-7 天

---

## Phase 8: 数据洞察与可视化

### 8.1 个人运维仪表盘 ⭐⭐⭐

**功能描述**：

- 实时展示所有服务器关键指标（CPU、内存、磁盘、网络）
- 连接活动热力图（显示每天最活跃的时间段）
- 命令执行统计（Top 10 命令、错误率趋势）
- 个性化组件布局（拖拽调整仪表盘）

**实施方案**：

#### 前端仪表盘 (`packages/frontend/src/features/dashboard/`)

```
dashboard/
├── components/
│   ├── DashboardGrid.vue         # 网格布局容器（vue-grid-layout）
│   ├── widgets/
│   │   ├── SystemMetricsWidget.vue    # 系统指标卡片
│   │   ├── ActivityHeatmapWidget.vue  # 活动热力图
│   │   ├── CommandStatsWidget.vue     # 命令统计
│   │   ├── ConnectionStatusWidget.vue # 连接状态总览
│   │   └── QuickActionWidget.vue      # 快速操作面板
│   └── WidgetSelector.vue        # 组件选择器
└── stores/
    └── dashboard.store.ts        # 保存布局配置
```

#### 数据采集

```typescript
// packages/backend/src/metrics/collector.ts
class MetricsCollector {
  async collectSystemMetrics(connectionId: number): Promise<Metrics> {
    const commands = {
      cpu: "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'",
      memory: "free | grep Mem | awk '{print ($3/$2)*100}'",
      disk: "df -h / | tail -1 | awk '{print $5}'",
      network: "cat /proc/net/dev | grep eth0 | awk '{print $2, $10}'",
    };

    const metrics: Metrics = {};
    for (const [key, cmd] of Object.entries(commands)) {
      metrics[key] = await this.executeAndParse(connectionId, cmd);
    }

    return metrics;
  }
}
```

#### WebSocket 实时推送

```typescript
// 每 10 秒推送一次指标数据
setInterval(async () => {
  const connections = await getActiveConnections();
  for (const conn of connections) {
    const metrics = await metricsCollector.collect(conn.id);
    wsManager.sendToUser(conn.userId, {
      type: 'metrics-update',
      data: { connectionId: conn.id, metrics },
    });
  }
}, 10000);
```

**图表库**：

- Chart.js（时间序列折线图、饼图）
- Apache ECharts（热力图、仪表盘）

**预计工作量**：6-8 天

---

### 8.2 命令执行分析报告 ⭐⭐

**功能描述**：

- 每周/每月自动生成运维报告
- 统计数据：命令执行次数、连接时长、错误率、活跃服务器
- 可视化报告（图表 + Markdown）
- 导出功能（PDF/HTML）

**实施方案**：

#### 报告生成器 (`packages/backend/src/reports/generator.ts`)

```typescript
interface WeeklyReport {
  period: { start: string; end: string };
  totalCommands: number;
  topCommands: Array<{ command: string; count: number }>;
  connectionStats: {
    totalSessions: number;
    avgDuration: number;
    topServers: string[];
  };
  errorRate: number;
  insights: string[]; // AI 生成的洞察
}

class ReportGenerator {
  async generateWeeklyReport(): Promise<WeeklyReport> {
    const startDate = dayjs().subtract(7, 'day').toDate();
    const endDate = new Date();

    const commands = await this.queryCommands(startDate, endDate);
    const sessions = await this.querySessions(startDate, endDate);

    return {
      period: { start: startDate.toISOString(), end: endDate.toISOString() },
      totalCommands: commands.length,
      topCommands: this.aggregateTopCommands(commands, 10),
      connectionStats: this.calculateConnectionStats(sessions),
      errorRate: this.calculateErrorRate(commands),
      insights: await this.aiOpsService.generateInsights(commands, sessions),
    };
  }

  async exportToPDF(report: WeeklyReport): Promise<Buffer> {
    // 使用 puppeteer 将 HTML 报告转为 PDF
  }
}
```

#### 前端报告查看器

```vue
<!-- ReportViewer.vue -->
<template>
  <div class="report-viewer">
    <div class="report-header">
      <h2>运维周报 - {{ report.period.start }} 至 {{ report.period.end }}</h2>
      <button @click="exportPDF">导出 PDF</button>
    </div>

    <div class="report-section">
      <h3>命令执行统计</h3>
      <BarChart :data="report.topCommands" />
    </div>

    <div class="report-section">
      <h3>AI 洞察</h3>
      <ul>
        <li v-for="insight in report.insights" :key="insight">
          {{ insight }}
        </li>
      </ul>
    </div>
  </div>
</template>
```

**预计工作量**：4-5 天

---

### 8.3 日志聚合与搜索 ⭐⭐

**功能描述**：

- 自动收集远程服务器日志（syslog、应用日志）
- 全文搜索与筛选（支持正则表达式）
- 日志高亮显示（错误、警告、调试）
- 日志统计分析（错误频率、关键字趋势）

**实施方案**：

#### 日志收集器 (`packages/backend/src/logs/collector.ts`)

```typescript
class LogCollector {
  async collectLogs(connectionId: number, logPath: string): Promise<void> {
    const sftp = await this.connectSFTP(connectionId);
    const logContent = await sftp.readFile(logPath);

    // 解析日志并存储
    const entries = this.parseLogEntries(logContent);
    await this.saveToDatabase(entries, connectionId);
  }

  parseLogEntries(content: string): LogEntry[] {
    // 支持多种日志格式：syslog、JSON、自定义正则
    const patterns = {
      syslog: /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+):\s+(.+)$/,
      json: /^{.*}$/,
      nginx: /^(\S+)\s+-\s+-\s+\[(.*?)\]\s+"(.*?)"\s+(\d+)\s+(\d+)/,
    };

    // 自动检测格式并解析
  }
}
```

#### 数据库设计（使用 FTS5 全文搜索）

```sql
CREATE VIRTUAL TABLE logs_fts USING fts5(
  connection_id,
  log_path,
  level,        -- INFO / WARN / ERROR / DEBUG
  timestamp,
  message,
  tokenize='porter'
);

-- 搜索示例
SELECT * FROM logs_fts WHERE message MATCH 'error OR exception'
ORDER BY timestamp DESC LIMIT 100;
```

#### 前端日志查看器 (`packages/frontend/src/features/logs/`)

```
logs/
├── components/
│   ├── LogViewer.vue          # 日志列表（虚拟滚动）
│   ├── LogSearchBar.vue       # 搜索框（支持高级筛选）
│   ├── LogLevelFilter.vue     # 日志级别筛选器
│   └── LogStatistics.vue      # 统计图表
└── composables/
    └── useLogSearch.ts        # 搜索逻辑（debounce）
```

**关键技术**：

- 使用 `virtual-scroller` 渲染大量日志条目
- 日志高亮使用 `highlight.js` 或自定义正则
- 实时日志流（WebSocket 推送）

**预计工作量**：6-8 天

---

## Phase 9: 跨平台与同步

### 9.1 浏览器扩展版本 ⭐⭐

**功能描述**：

- Chrome/Edge/Firefox 浏览器扩展
- 快速连接到收藏的服务器（无需打开完整 Web 应用）
- 全局快捷键唤起终端面板
- 与 Web 版数据同步

**实施方案**：

#### 扩展架构

```
browser-extension/
├── manifest.json              # 扩展配置
├── background.js              # 后台脚本（监听快捷键）
├── popup/
│   ├── index.html             # 弹窗界面
│   └── popup.vue              # 连接列表
└── content/
    └── inject.js              # 注入脚本（可选）
```

#### manifest.json 示例

```json
{
  "manifest_version": 3,
  "name": "Nexus Terminal QuickConnect",
  "version": "1.0.0",
  "permissions": ["storage", "tabs"],
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+T"
      }
    }
  },
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": "icon.png"
  }
}
```

#### 数据同步方案

- 使用 `chrome.storage.sync` 存储连接列表（加密）
- 扩展与 Web 应用通过 API 同步数据
- 可选：支持导出/导入配置文件

**预计工作量**：4-6 天

---

### 9.2 移动端适配优化 ⭐⭐⭐

**功能描述**：

- PWA 离线支持增强
- 移动端手势优化（滑动切换标签、双指缩放）
- 移动端专属布局（简化版界面）
- 触控键盘定制（Ctrl/Alt/Esc 等特殊键）

**实施方案**：

#### PWA 增强 (`packages/frontend/public/service-worker.js`)

```javascript
// 缓存策略：Network First for API, Cache First for static assets
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});
```

#### 移动端检测

```typescript
// packages/frontend/src/composables/useDeviceDetection.ts
export function useDeviceDetection() {
  const isMobile = computed(() => {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  });

  const isTouchDevice = computed(() => {
    return 'ontouchstart' in window;
  });

  const deviceType = computed(() => {
    if (isMobile.value) return 'mobile';
    if (isTouchDevice.value) return 'tablet';
    return 'default';
  });

  return { isMobile, isTouchDevice, deviceType };
}
```

#### 移动端终端键盘 (`packages/frontend/src/components/mobile/VirtualKeyboard.vue`)

```vue
<template>
  <div class="virtual-keyboard">
    <div class="keyboard-row">
      <button @click="sendKey('Ctrl')">Ctrl</button>
      <button @click="sendKey('Alt')">Alt</button>
      <button @click="sendKey('Esc')">Esc</button>
      <button @click="sendKey('Tab')">Tab</button>
    </div>
    <div class="keyboard-row">
      <button @click="sendKey('ArrowUp')">↑</button>
      <button @click="sendKey('ArrowDown')">↓</button>
      <button @click="sendKey('ArrowLeft')">←</button>
      <button @click="sendKey('ArrowRight')">→</button>
    </div>
  </div>
</template>
```

**手势支持**：

- 使用 `@vueuse/gesture` 或 `hammer.js`
- 双指捏合缩放终端字体
- 左右滑动切换标签页
- 长按显示右键菜单

**预计工作量**：5-7 天

---

### 9.3 配置云同步（可选） ⭐

**功能描述**：

- 支持将配置同步到云端（自建或第三方 S3）
- 多设备配置同步（连接列表、主题设置、快捷键）
- 端到端加密（本地加密后上传）
- 冲突解决策略（时间戳优先）

**实施方案**：

#### 后端同步服务 (`packages/backend/src/sync/`)

```typescript
interface SyncPayload {
  version: number;
  timestamp: string;
  encrypted_data: string; // AES-256 加密
  checksum: string; // SHA-256 校验
}

class SyncService {
  async uploadConfig(userId: string, config: any): Promise<void> {
    const encrypted = await this.encrypt(JSON.stringify(config));
    const payload: SyncPayload = {
      version: Date.now(),
      timestamp: new Date().toISOString(),
      encrypted_data: encrypted,
      checksum: this.calculateChecksum(encrypted),
    };

    // 上传到 S3 或本地存储
    await this.storage.put(`sync/${userId}/config.json`, payload);
  }

  async downloadConfig(userId: string): Promise<any> {
    const payload = await this.storage.get(`sync/${userId}/config.json`);
    const decrypted = await this.decrypt(payload.encrypted_data);
    return JSON.parse(decrypted);
  }
}
```

#### 前端同步触发器

- 登录后自动拉取最新配置
- 配置修改后延迟 5 秒自动上传
- 手动同步按钮（立即推送/拉取）

**隐私保护**：

- 加密密钥由用户设置的主密码派生（PBKDF2）
- 服务器无法解密用户数据
- 可选：完全禁用云同步，仅本地存储

**预计工作量**：6-8 天

---

## Phase 10: 高级终端能力

### 10.1 终端录制与回放 ⭐⭐⭐

**功能描述**：

- 录制完整终端会话（包括颜色、光标移动）
- 回放录制内容（支持暂停、倍速播放）
- 导出为 asciinema 格式或 GIF
- 自动录制重要会话

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE session_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL,
  title TEXT,
  duration INTEGER NOT NULL,       -- 录制时长（秒）
  recording_data TEXT NOT NULL,    -- JSON 格式，存储事件流
  file_path TEXT,                  -- 可选：存储为文件
  is_auto BOOLEAN DEFAULT 0,       -- 是否为自动录制
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);
```

#### recording_data 格式（兼容 asciinema）

```json
{
  "version": 2,
  "width": 80,
  "height": 24,
  "timestamp": 1234567890,
  "events": [
    [0.5, "o", "$ ls -la\r\n"],
    [1.2, "o", "total 48\r\n"],
    [1.3, "o", "drwxr-xr-x  5 user  staff  160 Jan 1 12:00 .\r\n"]
  ]
}
```

#### 后端录制服务 (`packages/backend/src/recordings/service.ts`)

```typescript
class RecordingService {
  private recordings = new Map<string, RecordingSession>();

  startRecording(sessionId: string): void {
    const recording: RecordingSession = {
      startTime: Date.now(),
      events: [],
      metadata: { width: 80, height: 24 },
    };
    this.recordings.set(sessionId, recording);
  }

  captureEvent(sessionId: string, data: string): void {
    const recording = this.recordings.get(sessionId);
    if (!recording) return;

    const elapsed = (Date.now() - recording.startTime) / 1000;
    recording.events.push([elapsed, 'o', data]);
  }

  async stopRecording(sessionId: string): Promise<void> {
    const recording = this.recordings.get(sessionId);
    if (!recording) return;

    await this.saveToDatabase({
      connectionId: sessionId,
      duration: (Date.now() - recording.startTime) / 1000,
      recordingData: JSON.stringify(recording),
    });

    this.recordings.delete(sessionId);
  }
}
```

#### 前端播放器 (`packages/frontend/src/features/recordings/Player.vue`)

```vue
<template>
  <div class="recording-player">
    <div ref="terminalContainer" class="terminal-container"></div>
    <div class="player-controls">
      <button @click="togglePlayPause">{{ isPlaying ? '⏸' : '▶' }}</button>
      <input
        type="range"
        :value="currentTime"
        :max="duration"
        @input="seekTo($event.target.value)"
      />
      <select v-model="playbackSpeed">
        <option value="0.5">0.5x</option>
        <option value="1">1x</option>
        <option value="2">2x</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Terminal } from 'xterm';
import AsciinemaPlayer from 'asciinema-player';

const player = ref<AsciinemaPlayer>();

const loadRecording = async (recordingId: number) => {
  const data = await api.getRecording(recordingId);
  player.value = AsciinemaPlayer.create(data, terminalContainer.value, {
    speed: playbackSpeed.value,
    autoPlay: false,
  });
};
</script>
```

**导出功能**：

- asciinema 格式（`.cast` 文件）
- GIF 动图（使用 `asciicast2gif`）
- HTML 嵌入代码（可分享）

**预计工作量**：7-10 天

---

### 10.2 终端分屏与布局增强 ⭐⭐

**功能描述**：

- 单个标签页内支持多终端分屏（类似 tmux）
- 预设布局模板（两列、三列、田字格）
- 分屏间快捷键切换
- 同步输入模式（多个终端同时输入）

**实施方案**：

#### 前端分屏组件 (`packages/frontend/src/components/terminal/SplitTerminal.vue`)

```vue
<template>
  <div class="split-terminal" :style="gridStyle">
    <div
      v-for="(pane, index) in panes"
      :key="pane.id"
      class="terminal-pane"
      :class="{ active: activePane === index }"
    >
      <TerminalView :session-id="pane.sessionId" />
      <div class="pane-actions">
        <button @click="splitHorizontal(index)">➖</button>
        <button @click="splitVertical(index)">|</button>
        <button @click="closePane(index)">✖</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Pane {
  id: string;
  sessionId: string;
  position: { row: number; col: number };
  size: { width: number; height: number };
}

const panes = ref<Pane[]>([
  {
    id: 'pane-1',
    sessionId: 'session-1',
    position: { row: 0, col: 0 },
    size: { width: 100, height: 100 },
  },
]);

const splitHorizontal = (index: number) => {
  const pane = panes.value[index];
  // 将当前 pane 高度减半，新增下方 pane
  pane.size.height = 50;
  panes.value.push({
    id: `pane-${Date.now()}`,
    sessionId: `session-${Date.now()}`,
    position: { row: pane.position.row + 1, col: pane.position.col },
    size: { width: pane.size.width, height: 50 },
  });
};
</script>
```

#### 同步输入模式

```typescript
// packages/frontend/src/composables/useSyncInput.ts
export function useSyncInput(panes: Ref<Pane[]>) {
  const isSyncMode = ref(false);

  const handleInput = (data: string) => {
    if (!isSyncMode.value) return;

    // 向所有 pane 的终端发送相同输入
    panes.value.forEach((pane) => {
      sendToTerminal(pane.sessionId, data);
    });
  };

  return { isSyncMode, handleInput };
}
```

**快捷键**：

- `Ctrl+Shift+D`：水平分割
- `Ctrl+Shift+E`：垂直分割
- `Ctrl+Shift+W`：关闭当前面板
- `Ctrl+Shift+Arrow`：切换焦点

**预计工作量**：6-8 天

---

### 10.3 命令输出增强 ⭐⭐

**功能描述**：

- 命令输出语法高亮（JSON、YAML、日志等）
- 表格自动格式化（检测列对齐）
- 链接自动检测（URL、文件路径）
- 输出折叠（长输出自动折叠，可展开）

**实施方案**：

#### 输出处理器 (`packages/frontend/src/utils/output-processor.ts`)

```typescript
class OutputProcessor {
  process(output: string): ProcessedOutput {
    // 1. 检测输出类型
    const type = this.detectType(output);

    // 2. 应用对应处理
    switch (type) {
      case 'json':
        return this.highlightJSON(output);
      case 'table':
        return this.formatTable(output);
      case 'log':
        return this.highlightLog(output);
      default:
        return this.linkify(output);
    }
  }

  detectType(output: string): OutputType {
    if (/^\s*[{\[]/.test(output)) return 'json';
    if (/^(\S+\s+){3,}\n-+\n/.test(output)) return 'table';
    if (/\d{4}-\d{2}-\d{2}/.test(output)) return 'log';
    return 'text';
  }

  highlightJSON(json: string): string {
    try {
      const parsed = JSON.parse(json);
      return `<pre class="json-output">${highlight(JSON.stringify(parsed, null, 2), 'json')}</pre>`;
    } catch {
      return json;
    }
  }

  formatTable(table: string): string {
    // 检测列宽，添加 CSS 对齐
    const lines = table.split('\n');
    const columns = this.detectColumns(lines);
    return this.renderTable(lines, columns);
  }
}
```

#### Xterm 插件集成

```typescript
// packages/frontend/src/features/terminal/addons/output-enhancer.ts
import { Terminal, ITerminalAddon } from 'xterm';

export class OutputEnhancerAddon implements ITerminalAddon {
  activate(terminal: Terminal): void {
    const originalWrite = terminal.write.bind(terminal);

    terminal.write = (data: string | Uint8Array) => {
      if (typeof data === 'string') {
        data = this.processOutput(data);
      }
      return originalWrite(data);
    };
  }

  processOutput(data: string): string {
    // 应用输出增强
    return outputProcessor.process(data);
  }
}
```

**预计工作量**：4-6 天

---

## Phase 11: 个人知识库

### 11.1 内置文档与笔记系统 ⭐⭐⭐

**功能描述**：

- Markdown 笔记编辑器（集成到侧边栏）
- 支持代码块高亮与运行
- 笔记与连接关联（为每个服务器创建笔记）
- 全文搜索笔记内容

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,         -- Markdown 内容
  connection_id INTEGER,         -- 可选：关联连接
  tags TEXT,                     -- JSON 数组，标签
  is_pinned BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, tags);
```

#### 前端编辑器 (`packages/frontend/src/features/notes/`)

```
notes/
├── components/
│   ├── NoteEditor.vue         # Markdown 编辑器（TipTap 或 Toast UI）
│   ├── NoteList.vue           # 笔记列表（侧边栏）
│   ├── NotePreview.vue        # 预览模式
│   └── CodeBlockRunner.vue    # 代码块执行器
└── stores/
    └── notes.store.ts
```

#### 代码块执行功能

````vue
<!-- 在 Markdown 中标记可执行代码块 -->
```bash {runnable} df -h
````

<!-- 前端检测到 {runnable} 标记，显示"运行"按钮 -->

<button @click="runCodeBlock(codeBlock)">▶ 运行</button>

````

**快捷键**：
- `Ctrl+N`：新建笔记
- `Ctrl+P`：快速搜索笔记
- `Ctrl+L`：插入当前连接信息

**预计工作量**：6-8 天

---

### 11.2 常见问题与解决方案库 ⭐⭐

**功能描述**：
- 记录遇到的问题与解决方案
- 自动关联命令历史（从失败命令创建问题记录）
- 问题分类与标签
- AI 辅助生成解决方案

**实施方案**：

#### 数据库设计
```sql
CREATE TABLE troubleshooting_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  problem_description TEXT NOT NULL,
  solution TEXT NOT NULL,
  related_commands TEXT,        -- JSON 数组，相关命令
  category TEXT,
  severity TEXT,                -- low / medium / high / critical
  occurrence_count INTEGER DEFAULT 1,
  last_occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
````

#### 自动问题检测

```typescript
// packages/backend/src/troubleshooting/detector.ts
class ProblemDetector {
  async analyzeFailedCommand(command: string, output: string): Promise<Problem | null> {
    // 检测常见错误模式
    const patterns = {
      permission_denied: /permission denied/i,
      command_not_found: /command not found/i,
      disk_full: /no space left on device/i,
      connection_refused: /connection refused/i,
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(output)) {
        return {
          type,
          command,
          output,
          suggestedSolution: await this.getSolution(type),
        };
      }
    }

    return null;
  }

  async getSolution(problemType: string): Promise<string> {
    // 从知识库查询或调用 AI
    const entry = await this.repository.findByType(problemType);
    return entry?.solution || (await this.aiOpsService.generateSolution(problemType));
  }
}
```

#### 前端问题面板

```vue
<!-- ErrorAssistantPanel.vue -->
<template>
  <div v-if="detectedProblem" class="error-assistant">
    <div class="problem-card">
      <h4>❌ 检测到问题：{{ detectedProblem.type }}</h4>
      <p>{{ detectedProblem.command }}</p>
      <div class="solution">
        <h5>💡 建议解决方案：</h5>
        <Markdown :content="detectedProblem.suggestedSolution" />
      </div>
      <button @click="saveToLibrary">保存到知识库</button>
    </div>
  </div>
</template>
```

**预计工作量**：5-7 天

---

### 11.3 服务器运维手册 ⭐⭐

**功能描述**：

- 为每个服务器创建运维文档
- 记录服务架构、部署信息、常用操作
- 自动生成服务器拓扑图
- 版本历史记录

**实施方案**：

#### 数据库设计

```sql
CREATE TABLE server_documentation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL,
  sections TEXT NOT NULL,        -- JSON，文档分节
  topology_data TEXT,            -- JSON，拓扑图数据
  version INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

CREATE TABLE documentation_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  changed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES server_documentation(id)
);
```

#### sections 结构

```json
{
  "basic_info": {
    "os": "Ubuntu 22.04",
    "role": "Web Server",
    "owner": "personal"
  },
  "architecture": {
    "services": ["nginx", "docker", "postgresql"],
    "ports": [80, 443, 5432]
  },
  "operations": {
    "deployment": "git pull && docker-compose up -d",
    "backup": "pg_dump database > backup.sql",
    "monitoring": "systemctl status nginx"
  },
  "notes": "Markdown content here..."
}
```

#### 前端文档编辑器

```
documentation/
├── components/
│   ├── DocEditor.vue          # 多节编辑器
│   ├── TopologyEditor.vue     # 拓扑图编辑器（使用 D3.js/Cytoscape）
│   └── VersionHistory.vue     # 版本历史查看器
```

**预计工作量**：6-8 天

---

## 长期愿景功能

### L1: 终端 AI Copilot ⭐⭐⭐

**功能描述**：

- 实时分析命令意图，提供下一步建议
- 自然语言转命令（"列出所有大于 100MB 的文件" → `find . -size +100M`）
- 命令解释器（解释复杂命令的含义）
- 错误诊断与自动修复

**技术方案**：

- 集成本地 LLM（llama.cpp + Mistral/Llama 3）
- 或调用 OpenAI/Claude API（用户配置）
- 使用 RAG（检索增强生成）从历史命令学习

**预计工作量**：10-15 天

---

### L2: 远程协作（屏幕共享） ⭐⭐

**功能描述**：

- 生成临时分享链接，允许他人查看终端会话
- 只读模式（他人无法输入）
- 可选：协作模式（多人同时操作）

**技术方案**：

- WebRTC 实现屏幕共享
- 后端生成一次性 Token
- 前端使用 Canvas 渲染终端内容并流式传输

**预计工作量**：8-10 天

---

### L3: 插件系统 ⭐⭐

**功能描述**：

- 支持用户编写自定义插件（JavaScript/TypeScript）
- 插件 Hook 系统（命令执行前后、连接建立等）
- 插件市场（内置常用插件）

**技术方案**：

- 插件沙箱（使用 VM2 或 Web Worker）
- 插件 API 设计（暴露受限的系统接口）
- 插件配置界面

**预计工作量**：12-15 天

---

### L4: 性能监控与告警 ⭐⭐⭐

**功能描述**：

- 实时监控服务器性能指标
- 自定义告警规则（如 CPU > 80% 持续 5 分钟）
- 告警通知（邮件、Telegram、钉钉、企业微信）
- 历史数据可视化

**技术方案**：

- 后端定时采集指标（InfluxDB 或 SQLite 存储时序数据）
- 告警引擎（基于规则引擎）
- 前端 WebSocket 实时推送告警

**预计工作量**：10-12 天

---

### L5: 容器与 Kubernetes 集成 ⭐⭐

**功能描述**：

- 可视化管理 Docker 容器（启动、停止、日志查看）
- Kubernetes 集群管理（Pod 列表、日志、端口转发）
- 容器终端快速进入（`docker exec`）

**技术方案**：

- 后端集成 Dockerode（Docker API 客户端）
- 后端集成 @kubernetes/client-node
- 前端容器管理面板

**预计工作量**：10-15 天

---

## 实施优先级矩阵

| 功能                     | 优先级    | 实施难度 | 用户价值 | 预计工作量 | 建议开始时间 |
| ------------------------ | --------- | -------- | -------- | ---------- | ------------ |
| **快速命令模板系统**     | P0 ⭐⭐⭐ | 中       | 极高     | 5-7 天     | 立即         |
| **工作区快照与场景切换** | P0 ⭐⭐⭐ | 中       | 极高     | 4-6 天     | 立即         |
| **智能命令推荐系统**     | P0 ⭐⭐⭐ | 高       | 高       | 6-8 天     | Phase 7      |
| **个人运维仪表盘**       | P0 ⭐⭐⭐ | 中       | 极高     | 6-8 天     | Phase 8      |
| **终端录制与回放**       | P0 ⭐⭐⭐ | 中       | 高       | 7-10 天    | Phase 10     |
| **内置文档与笔记系统**   | P0 ⭐⭐⭐ | 中       | 极高     | 6-8 天     | Phase 11     |
| **自动化巡检任务**       | P1 ⭐⭐⭐ | 高       | 高       | 7-10 天    | Phase 7      |
| **移动端适配优化**       | P1 ⭐⭐⭐ | 中       | 高       | 5-7 天     | Phase 9      |
| **性能监控与告警**       | P1 ⭐⭐⭐ | 高       | 极高     | 10-12 天   | 长期         |
| **连接分组与标签系统**   | P1 ⭐⭐   | 低       | 中       | 2-3 天     | Phase 6      |
| **命令书签与收藏夹**     | P1 ⭐⭐   | 低       | 中       | 2-3 天     | Phase 6      |
| **文件自动备份与同步**   | P1 ⭐⭐   | 中       | 高       | 5-7 天     | Phase 7      |
| **日志聚合与搜索**       | P1 ⭐⭐   | 高       | 中       | 6-8 天     | Phase 8      |
| **命令执行分析报告**     | P1 ⭐⭐   | 中       | 中       | 4-5 天     | Phase 8      |
| **终端分屏与布局增强**   | P1 ⭐⭐   | 中       | 中       | 6-8 天     | Phase 10     |
| **命令输出增强**         | P1 ⭐⭐   | 中       | 中       | 4-6 天     | Phase 10     |
| **常见问题与解决方案库** | P1 ⭐⭐   | 中       | 高       | 5-7 天     | Phase 11     |
| **服务器运维手册**       | P1 ⭐⭐   | 中       | 中       | 6-8 天     | Phase 11     |
| **浏览器扩展版本**       | P2 ⭐⭐   | 中       | 低       | 4-6 天     | Phase 9      |
| **配置云同步**           | P2 ⭐     | 中       | 低       | 6-8 天     | Phase 9      |
| **终端 AI Copilot**      | P2 ⭐⭐⭐ | 极高     | 极高     | 10-15 天   | 长期         |
| **容器与 K8s 集成**      | P2 ⭐⭐   | 高       | 中       | 10-15 天   | 长期         |
| **远程协作（屏幕共享）** | P2 ⭐⭐   | 高       | 低       | 8-10 天    | 长期         |
| **插件系统**             | P2 ⭐⭐   | 极高     | 中       | 12-15 天   | 长期         |

**优先级说明**：

- **P0**：核心功能，应优先实施
- **P1**：重要功能，提升使用体验
- **P2**：增强功能，可后期实施

---

## 技术架构演进建议

### 1. 数据库优化

**当前问题**：

- SQLite 单文件数据库，数据量增长可能影响性能

**优化方案**：

- 启用 WAL 模式（Write-Ahead Logging）提升并发性能
  ```sql
  PRAGMA journal_mode=WAL;
  ```
- 为高频查询添加索引（已部分实施）
- 定期 VACUUM 清理碎片
- 考虑将时序数据（指标、日志）单独存储（SQLite 或 InfluxDB）

---

### 2. 前端性能优化

**当前问题**：

- 多标签页打开时内存占用较高
- 大量历史命令渲染可能卡顿

**优化方案**：

- 实施虚拟滚动（`vue-virtual-scroller`）
- 标签页懒加载（非活动标签页不渲染终端）
- 使用 Web Worker 处理耗时计算（如命令分析）
- 启用 Vite 代码分割（动态 import）

---

### 3. WebSocket 连接管理

**当前问题**：

- 大量连接时 WebSocket 管理复杂

**优化方案**：

- 实施连接池管理
- 心跳机制优化（已实施，持续监控）
- 支持断线重连（指数退避策略）

---

### 4. 安全加固

**当前问题**：

- 敏感数据加密（已部分实施）
- XSS/CSRF 防护需持续关注

**优化方案**：

- 定期审计依赖漏洞（`npm audit`）
- 实施 CSP（Content Security Policy）
- 敏感操作添加二次确认（删除连接、清空日志等）
- API 请求签名（防止重放攻击）

---

### 5. 可观测性

**当前问题**：

- 缺乏系统运行时监控
- 错误日志分散

**优化方案**：

- 集成应用性能监控（APM）：Sentry / Datadog
- 结构化日志（使用 Winston 或 Pino）
- 添加健康检查端点（`/health`）
- 前端错误捕获与上报

---

### 6. 测试覆盖率

**当前问题**：

- 无自动化测试

**优化方案**：

- **Phase 1**：关键模块单元测试（认证、命令执行、文件上传）
- **Phase 2**：API 集成测试（Supertest）
- **Phase 3**：前端组件测试（Vitest + Vue Test Utils）
- **Phase 4**：E2E 测试（Cypress / Playwright）

---

## 实施建议

### 短期目标（1-2 个月）

1. 实施 **Phase 6**（个人工作流增强）
   - 快速命令模板系统
   - 工作区快照
   - 连接分组与标签
   - 命令书签

2. 完善现有功能
   - 修复已知 Bug
   - 优化移动端体验
   - 添加单元测试

### 中期目标（3-6 个月）

1. 实施 **Phase 7**（智能化与自动化）
   - 智能命令推荐
   - 自动化巡检任务

2. 实施 **Phase 8**（数据洞察与可视化）
   - 个人运维仪表盘
   - 命令执行分析报告

3. 实施 **Phase 10**（高级终端能力）
   - 终端录制与回放

### 长期目标（6-12 个月）

1. 实施 **Phase 11**（个人知识库）
   - 内置文档与笔记系统
   - 常见问题库

2. 探索长期愿景功能
   - 终端 AI Copilot
   - 性能监控与告警
   - 容器与 K8s 集成

---

## 结语

本路线图基于当前项目定位（个人使用），避免了多用户权限管理等复杂功能，专注于提升个人运维效率。

**核心理念**：

- 🚀 **效率优先**：减少重复操作，自动化流程
- 🧠 **智能化**：AI 辅助运维，智能推荐
- 📊 **可视化**：数据洞察，趋势分析
- 📚 **知识沉淀**：内置笔记系统，问题解决方案库

**下一步行动**：

1. 与项目维护者讨论优先级
2. 创建 GitHub Issues 跟踪各 Phase 任务
3. 按 Phase 6 开始实施
4. 每完成一个 Phase 更新本文档

---

**文档版本**：v1.0  
**创建时间**：2025-12-22  
**最后更新**：2025-12-22  
**维护者**：Nexus Terminal Team
