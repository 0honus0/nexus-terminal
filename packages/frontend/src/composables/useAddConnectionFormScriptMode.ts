/**
 * 连接表单 - 脚本模式子模块
 * 职责：SSH 命令行解析、IP 范围解析、批量连接创建
 */
import { useI18n } from 'vue-i18n';
import type { Ref } from 'vue';
import type { useConnectionsStore } from '../stores/connections.store';
import type { useProxiesStore } from '../stores/proxies.store';
import type { useTagsStore } from '../stores/tags.store';
import type { useSshKeysStore } from '../stores/sshKeys.store';
import type { useUiNotificationsStore } from '../stores/uiNotifications.store';

type ConnectionType = 'SSH' | 'RDP' | 'VNC';
type AuthMethod = 'password' | 'key';

interface ConnectionPayload {
  type: ConnectionType;
  name: string;
  host: string;
  port: number;
  username: string;
  notes?: string;
  proxy_id?: number | null;
  proxy_type?: 'proxy' | 'jump' | null;
  tag_ids?: number[];
  jump_chain?: number[] | null;
  force_keyboard_interactive?: boolean;
  auth_method: AuthMethod;
  password?: string;
  ssh_key_id?: number | null;
}

interface ScriptConnectionDraft extends ConnectionPayload {
  tag_names?: string[];
  proxy_name?: string | null;
  ssh_key_name?: string;
}

/** 脚本模式子模块依赖 */
export interface ScriptModeDeps {
  scriptInputText: { value: string };
  emit: (e: 'connection-added') => void;
  connectionsStore: ReturnType<typeof useConnectionsStore>;
  proxiesStore: ReturnType<typeof useProxiesStore>;
  tagsStore: ReturnType<typeof useTagsStore>;
  sshKeysStore: ReturnType<typeof useSshKeysStore>;
  uiNotificationsStore: ReturnType<typeof useUiNotificationsStore>;
  proxies: Ref<Array<{ id: number; name: string; host: string; port: number; type: string }>>;
  tags: Ref<Array<{ id: number; name: string }>>;
  sshKeys: Ref<Array<{ id: number; name: string }>>;
}

/**
 * 解析 IP 范围字符串 (e.g., "192.168.1.1~192.168.1.10")
 * @returns IP 数组或错误对象
 */
export function parseIpRange(
  ipRangeStr: string,
  t: ReturnType<typeof useI18n>['t']
): string[] | { error: string } {
  if (!ipRangeStr.includes('~')) {
    return { error: 'not_a_range' };
  }
  const parts = ipRangeStr.split('~');
  if (parts.length !== 2) {
    return {
      error: t('connections.form.errorInvalidIpRangeFormat', 'IP 范围格式应为 start_ip~end_ip'),
    };
  }

  const [startIpStr, endIpStr] = parts.map((p) => p.trim());

  const ipRegex = /^((\d{1,3}\.){3})\d{1,3}$/;
  if (!ipRegex.test(startIpStr) || !ipRegex.test(endIpStr)) {
    return { error: t('connections.form.errorInvalidIpFormat', '起始或结束 IP 地址格式无效') };
  }

  const startIpParts = startIpStr.split('.');
  const endIpParts = endIpStr.split('.');

  if (startIpParts.slice(0, 3).join('.') !== endIpParts.slice(0, 3).join('.')) {
    return {
      error: t(
        'connections.form.errorIpRangeNotSameSubnet',
        'IP 范围必须在同一个C段子网中 (例如 1.2.3.x ~ 1.2.3.y)'
      ),
    };
  }

  const startSuffix = parseInt(startIpParts[3], 10);
  const endSuffix = parseInt(endIpParts[3], 10);

  if (
    Number.isNaN(startSuffix) ||
    Number.isNaN(endSuffix) ||
    startSuffix < 0 ||
    startSuffix > 255 ||
    endSuffix < 0 ||
    endSuffix > 255
  ) {
    return {
      error: t('connections.form.errorInvalidIpSuffix', 'IP 地址最后一段必须是 0-255 之间的数字'),
    };
  }

  if (startSuffix > endSuffix) {
    return {
      error: t('connections.form.errorIpRangeOrder', '起始 IP 不能大于结束 IP'),
    };
  }

  const numIps = endSuffix - startSuffix + 1;
  if (numIps > 256) {
    return {
      error: t('connections.form.errorIpRangeTooLarge', 'IP 范围不能超过 256 个地址'),
    };
  }

  const baseIp = startIpParts.slice(0, 3).join('.');
  const ips: string[] = [];
  for (let i = 0; i < numIps; i++) {
    ips.push(`${baseIp}.${startSuffix + i}`);
  }
  return ips;
}

/**
 * 解析单行 SSH 命令脚本
 */
export function parseScriptLine(
  line: string,
  t: ReturnType<typeof useI18n>['t']
): {
  type: ConnectionType;
  userHostPort: string;
  name: string;
  password: string | null;
  keyName: string | null;
  proxyName: string | null;
  tags: string[];
  note: string | null;
  error?: string;
} {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return {
      type: 'SSH',
      userHostPort: '',
      name: '',
      password: null,
      keyName: null,
      proxyName: null,
      tags: [],
      note: null,
      error: t('connections.form.scriptErrorEmptyLine', 'Input line cannot be empty'),
    };
  }

  // 1. Extract user@host:port
  const firstSpaceIndex = trimmedLine.indexOf(' ');
  const userHostPortPart =
    firstSpaceIndex === -1 ? trimmedLine : trimmedLine.substring(0, firstSpaceIndex);
  const optionsString =
    firstSpaceIndex === -1 ? '' : trimmedLine.substring(firstSpaceIndex + 1).trim();

  // 2. Validate user@host:port
  const userHostPortRegex = /^([^@\s]+)@([^:\s]+)(?::([0-9]+))?$/;
  const match = userHostPortPart.match(userHostPortRegex);
  if (!match) {
    return {
      type: 'SSH',
      userHostPort: userHostPortPart,
      name: '',
      password: null,
      keyName: null,
      proxyName: null,
      tags: [],
      note: null,
      error: t('connections.form.scriptErrorInvalidUserHostPortFormat', {
        part: userHostPortPart,
      }),
    };
  }
  const [, user, host] = match;
  const defaultName = `${user}@${host}`;

  // 3. Initialize results and defaults
  let type: ConnectionType = 'SSH';
  let name: string = defaultName;
  let password: string | null = null;
  let keyName: string | null = null;
  let proxyName: string | null = null;
  let scriptTags: string[] = [];
  let note: string | null = null;

  // 4. Parse optionsString
  const args = optionsString.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      const key = arg.substring(1).toLowerCase();
      i++;

      if (key === 'tags') {
        scriptTags = [];
        while (i < args.length && !args[i].startsWith('-')) {
          scriptTags.push(args[i].replace(/^"|"$/g, ''));
          i++;
        }
      } else if (key === 'note') {
        const noteParts = [];
        while (i < args.length) {
          noteParts.push(args[i]);
          i++;
        }
        note = noteParts.join(' ').replace(/^"|"$/g, '');
        break;
      } else if (i >= args.length) {
        return {
          type,
          userHostPort: userHostPortPart,
          name,
          password,
          keyName,
          proxyName,
          tags: scriptTags,
          note,
          error: t('connections.form.scriptErrorMissingOptionValue', { option: `-${key}` }),
        };
      } else {
        const value = args[i].replace(/^"|"$/g, '');
        switch (key) {
          case 'type': {
            const typeValue = value.toUpperCase();
            if (typeValue === 'SSH' || typeValue === 'RDP' || typeValue === 'VNC') {
              type = typeValue;
            } else {
              return {
                type,
                userHostPort: userHostPortPart,
                name,
                password,
                keyName,
                proxyName,
                tags: scriptTags,
                note,
                error: t('connections.form.scriptErrorInvalidType', { type: value }),
              };
            }
            break;
          }
          case 'name':
            name = value || defaultName;
            break;
          case 'password':
            password = value;
            break;
          case 'key':
            keyName = value;
            break;
          case 'proxy':
            proxyName = value;
            break;
          default:
            // 未知选项忽略
            break;
        }
        i++;
      }
    } else {
      // 非选项参数，可能是位置参数
      i++;
    }
  }

  return {
    type,
    userHostPort: userHostPortPart,
    name,
    password,
    keyName,
    proxyName,
    tags: scriptTags,
    note,
  };
}

/**
 * 创建脚本模式提交处理器
 */
export function createScriptModeSubmit(deps: ScriptModeDeps) {
  const { t } = useI18n();
  const {
    scriptInputText,
    emit,
    connectionsStore,
    tagsStore,
    sshKeysStore,
    proxiesStore,
    uiNotificationsStore,
    proxies,
    tags,
    sshKeys,
  } = deps;

  return async () => {
    const lines = scriptInputText.value.split('\n').filter((line) => line.trim() !== '');

    if (lines.length === 0) {
      uiNotificationsStore.showError(t('connections.form.scriptModeEmpty', '脚本输入不能为空。'));
      return;
    }

    let allConnectionsValid = true;
    const connectionsToAdd: ScriptConnectionDraft[] = [];

    for (const line of lines) {
      const parsed = parseScriptLine(line, t);
      if (parsed.error) {
        uiNotificationsStore.showError(
          t('connections.form.scriptErrorInLine', { line, error: parsed.error })
        );
        allConnectionsValid = false;
        break;
      }

      if (!parsed.type) {
        uiNotificationsStore.showError(t('connections.form.scriptErrorMissingType', { line }));
        allConnectionsValid = false;
        break;
      }

      const [userHost, portStr] = parsed.userHostPort.split(':');
      const [username, host] = userHost.split('@');
      let defaultPort = 22;
      let defaultPortLabel = '22';
      if (parsed.type === 'RDP') {
        defaultPort = 3389;
        defaultPortLabel = '3389';
      } else if (parsed.type === 'VNC') {
        defaultPort = 5900;
        defaultPortLabel = '5900';
      }
      const port = portStr ? parseInt(portStr, 10) : defaultPort;

      if (!username || !host) {
        uiNotificationsStore.showError(
          t('connections.form.scriptErrorInvalidUserHostFormat', { line })
        );
        allConnectionsValid = false;
        break;
      }
      if (Number.isNaN(port) || port <= 0 || port > 65535) {
        uiNotificationsStore.showError(
          t('connections.form.scriptErrorInvalidPort', {
            line,
            port: portStr || defaultPortLabel,
          })
        );
        allConnectionsValid = false;
        break;
      }

      const connectionData: ScriptConnectionDraft = {
        type: parsed.type,
        name: parsed.name || `${username}@${host}`,
        host,
        port,
        username,
        auth_method: parsed.type === 'SSH' && parsed.keyName ? 'key' : 'password',
        notes: parsed.note || '',
        tag_names: parsed.tags,
        proxy_name: parsed.proxyName,
      };

      if (parsed.type === 'SSH') {
        if (connectionData.auth_method === 'password') {
          if (!parsed.password) {
            uiNotificationsStore.showError(
              t('connections.form.scriptErrorMissingPasswordForSsh', { line })
            );
            allConnectionsValid = false;
            break;
          }
          connectionData.password = parsed.password;
        } else {
          if (!parsed.keyName) {
            uiNotificationsStore.showError(
              t('connections.form.scriptErrorMissingKeyNameForSsh', { line })
            );
            allConnectionsValid = false;
            break;
          }
          connectionData.ssh_key_name = parsed.keyName;
        }
      } else if (parsed.type === 'RDP' || parsed.type === 'VNC') {
        if (!parsed.password) {
          uiNotificationsStore.showError(
            t('connections.form.scriptErrorMissingPasswordForType', { line, type: parsed.type })
          );
          allConnectionsValid = false;
          break;
        }
        connectionData.password = parsed.password;
      }
      connectionsToAdd.push(connectionData);
    }

    if (!allConnectionsValid || connectionsToAdd.length === 0) {
      return;
    }

    const fullyProcessedConnections: ConnectionPayload[] = [];
    let resolutionErrorOccurred = false;

    for (const connData of connectionsToAdd) {
      if (connData.tag_names && connData.tag_names.length > 0) {
        const tagIds = [];
        for (const tagName of connData.tag_names) {
          let foundTag = tags.value.find((t_) => t_.name === tagName);
          if (!foundTag) {
            const newTag = await tagsStore.addTag(tagName);
            if (newTag) {
              foundTag = newTag;
              uiNotificationsStore.showInfo(t('connections.form.scriptTagCreated', { tagName }));
              await tagsStore.fetchTags();
            } else {
              uiNotificationsStore.showError(
                t('connections.form.scriptErrorTagCreationFailed', { tagName })
              );
              resolutionErrorOccurred = true;
              break;
            }
          }
          tagIds.push(foundTag.id);
        }
        if (resolutionErrorOccurred) break;
        connData.tag_ids = tagIds;
      } else {
        connData.tag_ids = [];
      }
      delete connData.tag_names;

      if (connData.type === 'SSH' && connData.auth_method === 'key' && connData.ssh_key_name) {
        const foundKey = sshKeys.value.find((k) => k.name === connData.ssh_key_name);
        if (foundKey) {
          connData.ssh_key_id = foundKey.id;
        } else {
          uiNotificationsStore.showError(
            t('connections.form.scriptErrorSshKeyNotFound', { keyName: connData.ssh_key_name })
          );
          resolutionErrorOccurred = true;
          break;
        }
        delete connData.ssh_key_name;
      }

      if (connData.proxy_name) {
        const foundProxy = proxies.value.find((p) => p.name === connData.proxy_name);
        if (foundProxy) {
          connData.proxy_id = foundProxy.id;
        } else {
          uiNotificationsStore.showError(
            t('proxies.errors.notFound', { name: connData.proxy_name })
          );
          resolutionErrorOccurred = true;
          break;
        }
        delete connData.proxy_name;
      }

      if (connData.type !== 'SSH' || connData.auth_method !== 'key') delete connData.ssh_key_id;
      if (connData.type === 'SSH' && connData.auth_method === 'key') delete connData.password;

      fullyProcessedConnections.push(connData);
    }

    if (resolutionErrorOccurred || (fullyProcessedConnections.length === 0 && lines.length > 0)) {
      return;
    }

    if (fullyProcessedConnections.length === 0) {
      return;
    }

    uiNotificationsStore.showInfo(
      t('connections.form.scriptModeAddingConnections', { count: fullyProcessedConnections.length })
    );

    let successCount = 0;
    let errorCount = 0;
    let firstErrorEncountered: string | null = null;

    for (const finalConnectionData of fullyProcessedConnections) {
      const success = await connectionsStore.addConnection(finalConnectionData);
      if (success) {
        successCount++;
      } else {
        errorCount++;
        if (!firstErrorEncountered) {
          firstErrorEncountered = connectionsStore.error || t('errors.unknown', '未知错误');
        }
      }
    }

    if (errorCount > 0) {
      const message = t('connections.form.errorBatchAddResult', {
        successCount,
        errorCount,
        firstErrorEncountered: firstErrorEncountered || t('errors.unknown', '未知错误'),
      });
      if (successCount > 0) {
        uiNotificationsStore.showWarning(message);
      } else {
        uiNotificationsStore.showError(message);
      }
    }

    if (successCount > 0) {
      if (errorCount === 0) {
        uiNotificationsStore.showSuccess(
          t('connections.form.successBatchAddResult', { successCount })
        );
      }
      emit('connection-added');
      if (errorCount === 0) {
        scriptInputText.value = '';
      }
    }
  };
}
