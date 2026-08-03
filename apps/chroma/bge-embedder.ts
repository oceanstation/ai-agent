import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 当前文件：apps/chroma/bge-embedder.ts → 向上两级得到仓库根，再拼 .models/
// 让 agent（apps/agent）与 chroma 两侧共用同一份 ~400MB 的 bge 模型缓存；
// 该目录以 `.` 开头，属于本地缓存性质，被根 .gitignore 忽略，首次运行时自动创建
const __dirname = dirname(fileURLToPath(import.meta.url));
env.cacheDir = process.env.HF_CACHE_DIR ?? resolve(__dirname, "../../.models");
// 禁用从 Hub 拉取"远程"标识等不必要的网络行为（模型已缓存后完全离线）
env.allowRemoteModels = false;

// 中文 bge 模型（HuggingFace 上的 ONNX 版本，transformers.js 可直接加载）
// - BAAI/bge-small-zh-v1.5 : 快、体积小（~130MB），中文效果已经很好
// - BAAI/bge-base-zh-v1.5  : 效果更好但更慢更大（~400MB）
const MODEL_ID = 'Xenova/bge-base-zh-v1.5';

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', MODEL_ID, {
      device: 'cpu',
    });
  }
  return extractor;
}

/**
 * 把一个句子/段落变成平均池化后的向量（bge 推荐用法）
 */
async function getEmbedding(texts: string | string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const inputs = Array.isArray(texts) ? texts : [texts];

  const output = await extractor(inputs, {
    pooling: 'mean',
    normalize: true, // bge 官方建议对向量做 L2 归一化
  });
  return output.tolist();
}

/**
 * Chroma v3.5 自定义嵌入函数
 * Chroma 调用：
 *   - generate(texts)          -> 批量入库
 *   - generateForQueries(text) -> 单条查询（可选，不写则复用 generate）
 */
export class BgeZhEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    return getEmbedding(texts);
  }
}
