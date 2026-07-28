import { encodingForModel, getEncoding, type Tiktoken } from 'js-tiktoken';

/**
 * Tokenizer 单例
 *
 * 说明：
 * - DeepSeek / GPT-4 / GPT-3.5 都使用 cl100k_base 词表，token 数与 OpenAI 官方几乎一致；
 * - 我们只用它做"预算估算"，不追求 100% 精确，因此固定用 cl100k_base 即可。
 */
let encoderSingleton: Tiktoken | null = null;
const DEFAULT_HISTORY_TOKEN_BUDGET = 8000;

function getEncoder(): Tiktoken {
  if (encoderSingleton) return encoderSingleton;
  try {
    encoderSingleton = encodingForModel('gpt-4o');
  } catch {
    encoderSingleton = getEncoding('cl100k_base');
  }
  return encoderSingleton;
}

/** 计算单段文本的 token 数。text 为空时返回 0。 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

/** 聊天消息最简形态；只做 token 预算裁剪，因此够用。 */
export interface ChatMessageLite {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 每条消息除了 content 本身，OpenAI/DeepSeek 在协议层还会带上 role 标记与分隔符，
 * 大约每条会额外多 ~4 个 token。这里给一个经验值，用于让预算估算更保守。
 */
const PER_MESSAGE_OVERHEAD = 4;

export interface TrimResult {
  messages: ChatMessageLite[];
  /** 保留下来的 token 数（含 overhead）估算 */
  keptTokens: number;
  /** 被丢弃的消息条数 */
  dropped: number;
}

/**
 * 按 token 预算从"最近一条向前"裁剪历史消息。
 *
 * 规则：
 * 1) 从数组末尾开始累加 token 数；一旦累加值超过 budget，就停止；
 * 2) 结果保持原有先后顺序；
 * 3) 保证第一条一定是 user 消息 —— 若最靠前保留的是 assistant，则把它丢掉，
 *    避免出现 `[assistant, user, assistant, ...]` 这种非法开头（部分模型会报错）；
 * 4) 若单条消息本身就超预算，也至少保留最新的一条 user 消息，避免完全空历史。
 */
export function trimMessagesByTokenBudget(
  messages: ChatMessageLite[],
  budget = DEFAULT_HISTORY_TOKEN_BUDGET,
): TrimResult {
  if (messages.length === 0) {
    return { messages: [], keptTokens: 0, dropped: 0 };
  }

  const kept: ChatMessageLite[] = [];
  let total = 0;

  // 从后向前累加计算 token 消耗
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cost = countTokens(msg.content) + PER_MESSAGE_OVERHEAD;
    if (total + cost > budget && kept.length > 0) {
      break;
    }
    kept.unshift(msg); // 把 msg 插到 kept 数组的最前面
    total += cost;
  }

  // 保证以 user 开头
  while (kept.length > 0 && kept[0].role !== 'user') {
    const removed = kept.shift();
    if (removed) {
      total -= countTokens(removed.content) + PER_MESSAGE_OVERHEAD;
    }
  }

  return {
    messages: kept,
    keptTokens: total,
    dropped: messages.length - kept.length,
  };
}
