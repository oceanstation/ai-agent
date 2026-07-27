/**
 * 生成稳定的唯一 id：优先 crypto.randomUUID，降级到时间戳 + 随机串。
 * 通用工具，可用于消息、请求、缓存 key 等任何需要短生命周期唯一标识的场景。
 */
export const generateId = (): string => {
  const cryptoObj = (globalThis as any).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
