import axios, { AxiosError, type AxiosInstance } from 'axios';

export const AGENT_BASE = '/agent';

/**
 * 携带 HTTP 状态码的错误类型。
 * 调用方可据此分支处理（如 404 → 清理本地会话、其余 → 展示状态码）。
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/** 共享 axios 实例：统一 baseURL，JSON 收发交给 axios 默认行为 */
const http: AxiosInstance = axios.create({
  baseURL: AGENT_BASE,
  validateStatus: (status) => status >= 200 && status < 300,
});

/** 把 AxiosError / 未知错误统一转成 ApiError，尽量保留响应体文本作为错误信息 */
function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError;
    const status = ax.response?.status ?? 0;
    // 响应体可能是 string / object，优先转字符串使用
    const data = ax.response?.data;
    let text = '';
    if (typeof data === 'string') text = data;
    else if (data != null) {
      try {
        text = JSON.stringify(data);
      } catch {
        text = '';
      }
    }
    return new ApiError(status, text || ax.message || `HTTP ${status}`);
  }
  return new ApiError(0, err instanceof Error ? err.message : 'Network Error');
}

/** query 参数：值为 undefined / null 时会被 axios 自动忽略 */
export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export async function get<T>(path: string, params?: QueryParams): Promise<T> {
  try {
    const resp = await http.get<T>(path, { params });
    return resp.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export async function post<T>(
  path: string,
  body?: unknown,
  params?: QueryParams,
): Promise<T> {
  try {
    const resp = await http.post<T>(path, body, { params });
    return resp.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export async function del(path: string): Promise<void> {
  try {
    await http.delete(path);
  } catch (err) {
    throw toApiError(err);
  }
}
