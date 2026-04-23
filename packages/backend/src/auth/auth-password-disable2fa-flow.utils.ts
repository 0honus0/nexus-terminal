interface FailureResponse {
  statusCode: 400 | 401 | 404;
  body: {
    message: string;
  };
}

interface PasswordUserLike {
  id: number;
  hashed_password: string;
}

export const resolveChangePasswordAccessValidation = (payload: {
  userId?: number;
  requiresTwoFactor?: boolean;
}):
  | {
      ok: true;
      actor: { userId: number };
    }
  | {
      ok: false;
      failure: FailureResponse;
    } => {
  const { userId, requiresTwoFactor } = payload;

  if (!userId || requiresTwoFactor) {
    return {
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证或认证未完成，请先登录。' },
      },
    };
  }

  return {
    ok: true,
    actor: { userId },
  };
};

export const resolveDisable2FAAccessValidation = (payload: {
  userId?: number;
  requiresTwoFactor?: boolean;
}):
  | {
      ok: true;
      actor: { userId: number };
    }
  | {
      ok: false;
      failure: FailureResponse;
    } => {
  const { userId, requiresTwoFactor } = payload;

  if (!userId || requiresTwoFactor) {
    return {
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证或认证未完成。' },
      },
    };
  }

  return {
    ok: true,
    actor: { userId },
  };
};

export const resolveChangePasswordInputValidation = (payload: {
  currentPassword?: unknown;
  newPassword?: unknown;
}):
  | {
      ok: true;
      input: {
        currentPassword: string;
        newPassword: string;
      };
    }
  | {
      ok: false;
      failure: FailureResponse;
    } => {
  const { currentPassword, newPassword } = payload;
  const current = typeof currentPassword === 'string' ? currentPassword : '';
  const next = typeof newPassword === 'string' ? newPassword : '';

  if (!current || !next) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '当前密码和新密码不能为空。' },
      },
    };
  }

  if (next.length < 8) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '新密码长度至少需要 8 位。' },
      },
    };
  }

  if (current === next) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '新密码不能与当前密码相同。' },
      },
    };
  }

  return {
    ok: true,
    input: {
      currentPassword: current,
      newPassword: next,
    },
  };
};

export const resolveDisable2FAInputValidation = (payload: {
  password?: unknown;
}):
  | {
      ok: true;
      input: {
        password: string;
      };
    }
  | {
      ok: false;
      failure: FailureResponse;
    } => {
  const { password } = payload;
  const rawPassword = typeof password === 'string' ? password : '';

  if (!rawPassword) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '需要提供当前密码才能禁用两步验证。' },
      },
    };
  }

  return {
    ok: true,
    input: {
      password: rawPassword,
    },
  };
};

export const resolvePasswordActionUserValidation = (payload: {
  user: PasswordUserLike | null | undefined;
}):
  | {
      ok: true;
      user: PasswordUserLike;
    }
  | {
      ok: false;
      failure: FailureResponse;
    } => {
  const { user } = payload;
  if (!user) {
    return {
      ok: false,
      failure: {
        statusCode: 404,
        body: { message: '用户不存在。' },
      },
    };
  }

  return {
    ok: true,
    user,
  };
};

export const resolveCurrentPasswordMatchValidation = (payload: {
  isMatch: boolean;
}):
  | {
      ok: true;
    }
  | {
      ok: false;
      failure: FailureResponse;
    } => {
  if (!payload.isMatch) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '当前密码不正确。' },
      },
    };
  }

  return { ok: true };
};

export const resolveMutationChangesValidation = (payload: {
  changes: number;
}):
  | {
      ok: true;
    }
  | {
      ok: false;
      error: Error;
    } => {
  if (payload.changes === 0) {
    return {
      ok: false,
      error: new Error('未找到要更新的用户'),
    };
  }

  return { ok: true };
};
