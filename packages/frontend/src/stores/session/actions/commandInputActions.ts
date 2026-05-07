// packages/frontend/src/stores/session/actions/commandInputActions.ts

import { sessions } from '../state';
import { log } from '@/utils/log';

/**
 * 更新指定会话的命令输入框内容
 */
export const updateSessionCommandInput = (sessionId: string, content: string) => {
  const session = sessions.value.get(sessionId);
  if (session) {
    session.commandInputContent.value = content;
  } else {
    log.warn(`[CommandInputActions] 尝试更新不存在的会话 ${sessionId} 的命令输入内容`);
  }
};
