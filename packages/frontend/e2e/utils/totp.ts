import { createHmac } from 'crypto';

/**
 * TOTP (Time-based One-Time Password) 生成器
 * 用于 E2E 测试中生成 2FA 验证码
 */

/**
 * 生成 TOTP 验证码
 * @param secret Base32 编码的密钥
 * @param window 时间窗口（默认 30 秒）
 * @returns 6 位数字验证码
 */
export function generateTOTP(secret: string, window = 30): string {
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / window);

  // 将 Base32 密钥转换为 Buffer
  const key = base32Decode(secret);

  // 生成 HMAC-SHA1
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buffer[i] = counter & 0xff;
    // eslint-disable-next-line no-bitwise
    counter >>= 8;
  }

  const hmac = createHmac('sha1', key);
  hmac.update(buffer);
  const digest = hmac.digest();

  // 动态截断
  // eslint-disable-next-line no-bitwise
  const offset = digest[digest.length - 1] & 0x0f;
  // eslint-disable-next-line no-bitwise
  const code =
    // eslint-disable-next-line no-bitwise
    ((digest[offset] & 0x7f) << 24) |
    // eslint-disable-next-line no-bitwise
    ((digest[offset + 1] & 0xff) << 16) |
    // eslint-disable-next-line no-bitwise
    ((digest[offset + 2] & 0xff) << 8) |
    // eslint-disable-next-line no-bitwise
    (digest[offset + 3] & 0xff);

  // 生成 6 位数字
  const token = (code % 1000000).toString().padStart(6, '0');
  return token;
}

/**
 * Base32 解码
 */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanInput = input.toUpperCase().replace(/=+$/, '');

  let bits = 0;
  let value = 0;
  let index = 0;
  const output = Buffer.alloc(Math.ceil((cleanInput.length * 5) / 8));

  for (const char of cleanInput) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }

  return output.slice(0, index);
}

/**
 * 验证 TOTP 码是否有效（允许时间偏移）
 */
export function verifyTOTP(secret: string, token: string, allowedDrift = 1): boolean {
  for (let i = -allowedDrift; i <= allowedDrift; i++) {
    const expected = generateTOTP(secret, 30);
    if (token === expected) {
      return true;
    }
  }
  return false;
}
