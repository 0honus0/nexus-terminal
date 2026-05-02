/**
 * Docker 安全工具函数
 * 提供容器 ID 净化和命令白名单校验，防止命令注入
 */

/** 合法的 Docker 命令动作 */
type DockerCommandAction = 'start' | 'stop' | 'restart' | 'remove';

const ALLOWED_DOCKER_COMMANDS: ReadonlySet<string> = new Set([
  'start',
  'stop',
  'restart',
  'remove',
]);

/**
 * 净化容器 ID，仅保留安全字符（字母、数字、下划线、连字符）
 * 防止命令注入攻击
 */
export function sanitizeDockerContainerId(containerId: string): string {
  return containerId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * 校验 Docker 命令是否在白名单中
 */
export function isValidDockerCommand(command: string): command is DockerCommandAction {
  return ALLOWED_DOCKER_COMMANDS.has(command);
}
