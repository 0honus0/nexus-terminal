/**
 * Worker 消息协议类型定义
 * 用于主线程与 Worker 线程之间的通信
 */

/** Worker 请求消息 */
export interface WorkerRequest {
  /** 请求唯一标识，用于关联响应 */
  id: string;
  /** 任务类型标识 */
  type: string;
  /** 任务载荷 */
  payload: unknown;
}

/** Worker 响应消息 */
export interface WorkerResponse {
  /** 与请求对应的唯一标识 */
  id: string;
  /** 任务类型标识 */
  type: string;
  /** 处理结果 */
  payload: unknown;
  /** 错误信息（仅在处理失败时存在） */
  error?: string;
}
