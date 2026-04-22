import { describe, expect, it } from 'vitest';
import { getErrorCode } from './sftp-error.utils';

describe('sftp-error.utils', () => {
  describe('getErrorCode', () => {
    it('应在 error.code 为字符串时返回对应错误码', () => {
      const result = getErrorCode({ code: 'ENOENT' });
      expect(result).toBe('ENOENT');
    });

    it('应在 error.code 不是字符串时返回 undefined', () => {
      const result = getErrorCode({ code: 404 });
      expect(result).toBeUndefined();
    });

    it('应在输入不是对象时返回 undefined', () => {
      expect(getErrorCode(null)).toBeUndefined();
      expect(getErrorCode('ENOENT')).toBeUndefined();
      expect(getErrorCode(undefined)).toBeUndefined();
    });
  });
});
