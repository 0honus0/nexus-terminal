/**
 * E2E 测试数据定义
 */

/**
 * SSH 连接测试数据
 */
export const SSH_CONNECTION = {
  name: 'E2E Test SSH Server',
  host: process.env.E2E_SSH_HOST || 'localhost',
  port: parseInt(process.env.E2E_SSH_PORT || '22', 10),
  username: process.env.E2E_SSH_USERNAME || 'testuser',
  password: process.env.E2E_SSH_PASSWORD || 'testpass',
  authMethod: 'password' as const,
};

/**
 * SFTP 测试数据
 */
export const SFTP_TEST_DATA = {
  testFilename: 'e2e-test-file.txt',
  testContent: `E2E Test Content - ${new Date().toISOString()}`,
  testDirectory: '/tmp/nexus-e2e-test',
};

/**
 * RDP 连接测试数据
 */
export const RDP_CONNECTION = {
  name: 'E2E Test RDP Server',
  host: process.env.E2E_RDP_HOST || 'localhost',
  port: parseInt(process.env.E2E_RDP_PORT || '3389', 10),
  username: process.env.E2E_RDP_USERNAME || 'Administrator',
  password: process.env.E2E_RDP_PASSWORD || 'password',
};

/**
 * VNC 连接测试数据
 */
export const VNC_CONNECTION = {
  name: 'E2E Test VNC Server',
  host: process.env.E2E_VNC_HOST || 'localhost',
  port: parseInt(process.env.E2E_VNC_PORT || '5900', 10),
  password: process.env.E2E_VNC_PASSWORD || 'password',
};

/**
 * 2FA 测试数据
 */
export const TWO_FACTOR_AUTH = {
  secret: process.env.E2E_2FA_SECRET || 'JBSWY3DPEHPK3PXP',
};

/**
 * 边缘场景测试数据
 */
export const EDGE_CASE_DATA = {
  // 无效连接数据
  invalidConnection: {
    name: 'Invalid SSH Connection',
    host: '192.0.2.1', // TEST-NET-1 (RFC 5737)
    port: 22,
    username: 'nonexistent',
    password: 'invalid',
  },
  // 超时配置
  shortTimeout: {
    name: 'Timeout Test',
    host: '192.0.2.1',
    port: 22,
    username: 'test',
    password: 'test',
    timeout: 1000, // 1秒超时
  },
  // 大文件测试
  largeFile: {
    name: 'large-test-file.bin',
    size: 100 * 1024 * 1024, // 100MB
  },
  // 特殊字符文件名
  specialCharsFile: {
    name: '测试文件 (test) [123].txt',
    content: 'UTF-8 内容测试',
  },
  // 权限测试
  restrictedPath: {
    path: '/root',
    expectedError: 'Permission denied',
  },
  // 批量操作测试
  batchServers: [
    { name: 'Batch Test 1', host: 'server1.test' },
    { name: 'Batch Test 2', host: 'server2.test' },
    { name: 'Batch Test 3', host: 'server3.test' },
  ],
  // 长时间运行命令
  longRunningCommand: {
    command: 'sleep 60',
    expectedDuration: 60000, // 60秒
  },
  // 会话恢复测试
  sessionResume: {
    suspendDuration: 5000, // 5秒后恢复
  },
};
