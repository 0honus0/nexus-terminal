<template>
  <div class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      AI 助手配置
    </h2>
    <div class="p-6 space-y-6">
      <!-- 启用开关 -->
      <div>
        <div class="flex items-center">
          <input
            type="checkbox"
            id="enableAI"
            v-model="localSettings.enabled"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
          />
          <label
            for="enableAI"
            class="text-sm font-medium text-foreground cursor-pointer select-none"
          >
            启用 AI 助手
          </label>
        </div>
        <p class="text-xs text-muted-foreground mt-1 ml-6">
          启用后可在终端界面点击 AI 助手图标唤起功能
        </p>
      </div>

      <hr class="border-border/50" />

      <!-- Provider 选择 -->
      <div>
        <label for="ai-provider-select" class="text-sm font-medium text-foreground"
          >AI Provider</label
        >
        <div class="relative mt-2">
          <select
            id="ai-provider-select"
            v-model="localSettings.provider"
            @change="handleProviderChange"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
            style="
              background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
              background-position: right 0.75rem center;
              background-size: 16px 12px;
            "
          >
            <option value="openai">OpenAI</option>
            <option value="claude">Anthropic Claude</option>
          </select>
        </div>
      </div>

      <!-- OpenAI Endpoint 路径（仅 OpenAI 可见） -->
      <div v-if="localSettings.provider === 'openai'">
        <label class="text-sm font-medium text-foreground">API Endpoint 路径</label>
        <input
          v-model="localSettings.openaiEndpoint"
          type="text"
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary mt-2"
          :placeholder="getEndpointPlaceholder()"
        />
        <p class="text-xs text-muted-foreground mt-1">
          完整路径（如 <code>/chat/completions</code>），将拼接到 Base URL 后。确保路径准确。
        </p>
      </div>

      <!-- Base URL -->
      <div>
        <label class="text-sm font-medium text-foreground">Base URL</label>
        <input
          v-model="localSettings.baseUrl"
          class="w-full mt-2 px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
          :placeholder="DEFAULT_OPENAI_BASE_URL"
        />
        <p class="text-xs text-muted-foreground mt-1">
          {{ getBaseUrlPlaceholder() }}
        </p>
      </div>

      <!-- API Key -->
      <div>
        <label class="text-sm font-medium text-foreground">API Key</label>
        <div class="relative mt-2">
          <input
            v-model="localSettings.apiKey"
            :type="showPassword ? 'text' : 'password'"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground pr-10"
            placeholder="sk-..."
          />
          <button
            type="button"
            @click="showPassword = !showPassword"
            class="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <span v-if="showPassword">🙈</span>
            <span v-else>👁️</span>
          </button>
        </div>
        <p
          v-if="localSettings.apiKey && localSettings.apiKey.includes('...')"
          class="text-xs text-warning mt-1"
        >
          为确保安全，已保存的 Key 仅显示部分内容。如需修改请直接输入新 Key。
        </p>
        <p v-else class="text-xs text-muted-foreground mt-1">您的 API Key 将被安全加密存储</p>
      </div>

      <!-- Model -->
      <div>
        <label class="text-sm font-medium text-foreground">模型</label>
        <input
          v-model="localSettings.model"
          class="w-full mt-2 px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
          :placeholder="getModelPlaceholder()"
        />
        <p class="text-xs text-muted-foreground mt-1">
          {{ getModelHint() }}
        </p>
      </div>

      <hr class="border-border/50" />

      <!-- 速率限制开关 -->
      <div>
        <div class="flex items-center">
          <input
            type="checkbox"
            id="rateLimit"
            v-model="localSettings.rateLimitEnabled"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
          />
          <label
            for="rateLimit"
            class="text-sm font-medium text-foreground cursor-pointer select-none"
          >
            启用速率限制
          </label>
        </div>
        <p class="text-xs text-muted-foreground mt-1 ml-6">
          限制每分钟最多 10 次请求，防止 API 配额快速耗尽
        </p>
      </div>

      <!-- 流式响应开关（仅 OpenAI 支持） -->
      <div v-if="localSettings.provider === 'openai'">
        <div class="flex items-center">
          <input
            type="checkbox"
            id="streaming"
            v-model="localSettings.streamingEnabled"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
          />
          <label
            for="streaming"
            class="text-sm font-medium text-foreground cursor-pointer select-none"
          >
            启用流式响应
          </label>
        </div>
        <p class="text-xs text-muted-foreground mt-1 ml-6">
          启用后命令会逐步显示，有更好的交互体验（仅支持 OpenAI Chat Completions）
        </p>
      </div>

      <!-- 操作按钮 -->
      <div class="flex items-center justify-between pt-4">
        <div class="flex items-center space-x-3">
          <button
            type="button"
            @click="handleSave"
            :disabled="aiSettingsStore.isLoading"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ aiSettingsStore.isLoading ? '保存中...' : '保存配置' }}
          </button>

          <button
            type="button"
            @click="handleTest"
            :disabled="aiSettingsStore.isTesting"
            class="px-4 py-2 bg-background border border-border text-foreground rounded-md shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ aiSettingsStore.isTesting ? '测试中...' : '测试连接' }}
          </button>

          <button
            type="button"
            @click="handleReset"
            :disabled="aiSettingsStore.isLoading"
            class="px-4 py-2 bg-background border border-border text-foreground rounded-md shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            重置
          </button>
        </div>

        <!-- 消息提示 -->
        <p
          v-if="statusMessage"
          :class="[
            'text-sm transition-opacity duration-300',
            statusSuccess ? 'text-success' : 'text-error',
          ]"
        >
          {{ statusMessage }}
        </p>
      </div>

      <!-- 提示信息 -->
      <div class="mt-4 p-4 bg-info/10 border border-info/30 rounded-md">
        <p class="text-sm text-foreground">
          <strong>使用说明：</strong>
        </p>
        <ul class="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
          <li>配置完成后，在终端界面点击 AI 助手图标唤起功能</li>
          <li>输入自然语言描述（如"查找大于100M的文件"），AI 将生成对应命令</li>
          <li>生成的命令会自动填入终端输入行，您可以审核后再执行</li>
          <li>危险命令会有警告提示，请务必仔细检查后再执行</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useAISettingsStore } from '../../stores/aiSettings.store';
import type { AISettings } from '../../types/nl2cmd.types';
import { DEFAULT_OPENAI_BASE_URL, AI_PROVIDER_DEFAULTS } from '../../utils/aiConstants';

const aiSettingsStore = useAISettingsStore();

// 本地设置（用于编辑）
const localSettings = ref<AISettings>({
  enabled: false,
  provider: 'openai',
  baseUrl: DEFAULT_OPENAI_BASE_URL,
  apiKey: '',
  model: AI_PROVIDER_DEFAULTS.openai.model,
  openaiEndpoint: AI_PROVIDER_DEFAULTS.openai.endpoint,
  rateLimitEnabled: true,
  streamingEnabled: false,
});

const showPassword = ref(false);
const statusMessage = ref('');
const statusSuccess = ref(false);

// 设置状态消息并自动清除
function setStatus(message: string, isSuccess: boolean) {
  statusMessage.value = message;
  statusSuccess.value = isSuccess;
  setTimeout(() => {
    statusMessage.value = '';
  }, 5000);
}

// 初始化：加载配置
onMounted(async () => {
  try {
    await aiSettingsStore.loadSettings();
    localSettings.value = { ...aiSettingsStore.settings };
  } catch (error: unknown) {
    setStatus('加载 AI 配置失败', false);
  }
});

// 监听 store 变化，同步到本地
watch(
  () => aiSettingsStore.settings,
  (newSettings) => {
    localSettings.value = { ...newSettings };
  },
  { deep: true }
);

// Provider 切换时更新默认值
function handleProviderChange() {
  switch (localSettings.value.provider) {
    case 'openai':
      localSettings.value.baseUrl = AI_PROVIDER_DEFAULTS.openai.baseUrl;
      localSettings.value.model = AI_PROVIDER_DEFAULTS.openai.model;
      localSettings.value.openaiEndpoint = AI_PROVIDER_DEFAULTS.openai.endpoint;
      break;
    case 'claude':
      localSettings.value.baseUrl = AI_PROVIDER_DEFAULTS.claude.baseUrl;
      localSettings.value.model = AI_PROVIDER_DEFAULTS.claude.model;
      delete localSettings.value.openaiEndpoint;
      break;
  }
}

// 获取 Base URL 占位符
function getBaseUrlPlaceholder(): string {
  switch (localSettings.value.provider) {
    case 'openai':
      return `OpenAI API 地址，默认为 ${AI_PROVIDER_DEFAULTS.openai.baseUrl}`;
    case 'claude':
      return `Claude API 地址，默认为 ${AI_PROVIDER_DEFAULTS.claude.baseUrl}`;
    default:
      return '';
  }
}

// 获取 Endpoint 占位符
function getEndpointPlaceholder(): string {
  return '/v1/chat/completions';
}

// 获取模型占位符
function getModelPlaceholder(): string {
  switch (localSettings.value.provider) {
    case 'openai':
      return 'gpt-4o, gpt-4o-mini, gpt-4-turbo 等';
    case 'claude':
      return 'claude-sonnet-4, claude-3-5-haiku-20241022 等';
    default:
      return '';
  }
}

// 获取模型提示
function getModelHint(): string {
  switch (localSettings.value.provider) {
    case 'openai':
      return '推荐使用 gpt-4o-mini（经济高效）或 gpt-4o';
    case 'claude':
      return '推荐使用 claude-sonnet-4-6（平衡性能与成本）';
    default:
      return '';
  }
}

// 保存配置
async function handleSave() {
  try {
    // 验证必填项
    if (!localSettings.value.baseUrl || !localSettings.value.model) {
      setStatus('请填写完整的配置信息', false);
      return;
    }

    if (localSettings.value.enabled && !localSettings.value.apiKey) {
      setStatus('启用 AI 助手需要填写 API Key', false);
      return;
    }

    await aiSettingsStore.saveSettings(localSettings.value);
    setStatus('AI 配置已保存', true);
  } catch (error: unknown) {
    setStatus('保存 AI 配置失败', false);
  }
}

// 测试连接
async function handleTest() {
  try {
    // 验证必填项
    if (!localSettings.value.baseUrl || !localSettings.value.apiKey || !localSettings.value.model) {
      setStatus('请填写完整的配置信息', false);
      return;
    }

    const success = await aiSettingsStore.testConnection(localSettings.value);
    if (success) {
      setStatus('连接测试成功！AI 服务可用', true);
    } else {
      setStatus('连接测试失败，请检查配置', false);
    }
  } catch (error: unknown) {
    setStatus('测试连接时发生错误', false);
  }
}

// 重置配置
function handleReset() {
  localSettings.value = { ...aiSettingsStore.settings };
  setStatus('已恢复为上次保存的配置', true);
}
</script>

<style scoped>
code {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}
</style>
