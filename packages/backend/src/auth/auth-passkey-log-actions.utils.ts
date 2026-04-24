const toPasskeyIdSuffix = (passkeyId: number): string => {
  const passkeyIdString = passkeyId.toString();
  return passkeyIdString.substring(passkeyIdString.length - 4);
};

export const buildPasskeyRegistrationOptionsGeneratedDebugLogAction = (
  username: string
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `[AuthController] Generated Passkey registration options for user ${username}`,
});

export const buildPasskeyRegistrationOptionsErrorLogAction = (
  username: string
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] 生成 Passkey 注册选项时出错 (用户: ${username}):`,
});

export const buildPasskeyRegistrationSuccessInfoLogAction = (payload: {
  userHandle: string;
  credentialId: string;
}): {
  level: 'info';
  message: string;
} => ({
  level: 'info',
  message: `[AuthController] 用户 ${payload.userHandle} 的 Passkey 注册成功并已保存。 CredentialID: ${payload.credentialId.substring(0, 8)}***`,
});

export const buildPasskeyRegistrationVerificationFailedWarnLogAction = (
  userHandle: string
): {
  level: 'warn';
  message: string;
} => ({
  level: 'warn',
  message: `[AuthController] Passkey 注册验证失败 (用户: ${userHandle}):`,
});

export const buildPasskeyRegistrationVerificationErrorLogAction = (
  userHandle: string
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] 验证 Passkey 注册时出错 (用户: ${userHandle}):`,
});

export const buildPasskeyAuthenticationOptionsGeneratedDebugLogAction = (
  username: string
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `[AuthController] Generated Passkey authentication options (username=${username})`,
});

export const buildPasskeyAuthenticationOptionsErrorLogAction = (
  username: string
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] 生成 Passkey 认证选项时出错 (username=${username}):`,
});

export const buildPasskeyAuthenticationUserNotFoundAfterVerifiedErrorLogAction = (
  userId: number
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] Passkey 认证成功但未找到用户 ID: ${userId}`,
});

export const buildPasskeyAuthenticationSuccessInfoLogAction = (payload: {
  username: string;
  userId: number;
  passkeyId: number;
}): {
  level: 'info';
  message: string;
} => ({
  level: 'info',
  message: `[AuthController] 用户 ${payload.username} (ID: ${payload.userId}) 通过 Passkey (ID: ***${toPasskeyIdSuffix(payload.passkeyId)}) 认证成功。`,
});

export const buildPasskeyAuthenticationVerificationFailedWarnLogAction = (): {
  level: 'warn';
  message: string;
} => ({
  level: 'warn',
  message: '[AuthController] Passkey 认证验证失败:',
});

export const buildPasskeyAuthenticationVerificationErrorLogAction = (): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: '[AuthController] 验证 Passkey 认证时出错:',
});

export const buildPasskeyListErrorLogAction = (payload: {
  userId: number;
  username: string;
}): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] 用户 ${payload.username} (ID: ${payload.userId}) 获取 Passkey 列表时出错:`,
});

export const buildPasskeyHasConfiguredCheckErrorLogAction = (
  username: string
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] 检查 Passkey 配置状态时出错 (username=${username}):`,
});
