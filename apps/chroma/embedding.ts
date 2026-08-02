import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ChromaClient } from "chromadb";
import { BgeZhEmbeddingFunction } from "./bge-embedder.js";

interface ChunkMeta {
  source: string;
  heading: string;
  chunkIndex: number;
  [key: string]: string | number | boolean | null;
}

interface ChunkRecord {
  id: string;
  document: string;
  metadata: ChunkMeta;
}

const DOCS_DIR = resolve("docs");
const COLLECTION_NAME = "cookbook";

// 1) 本地 bge 中文嵌入函数（首次运行会自动下载模型到 ./models，之后离线）
const embedder = new BgeZhEmbeddingFunction();

// 2) 连接 Chroma（本地服务端，数据持久化到 chroma.sqlite3）
const client = new ChromaClient();

/**
 * 读取目录下的所有 .md 文件
 */
async function loadMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await loadMarkdownFiles(full)));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 把单个 md 文档按多级标题切分成若干 chunk
 * 每个 chunk 保留其所属的小节标题作为上下文前缀
 */
function splitMarkdownByHeading(text: string, source: string): ChunkRecord[] {
  const lines = text.split("\n");
  const chunks: { doc: string; heading: string }[] = [];
  let currentHeading = "";
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) {
      // 用标题作为上下文前缀，提升检索相关性
      const doc = currentHeading ? `${currentHeading}\n\n${content}` : content;
      chunks.push({ doc, heading: currentHeading || "(根)" });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks.map((c, i) => ({
    id: `${source}#${i}`,
    document: c.doc,
    metadata: { source, heading: c.heading, chunkIndex: i },
  }));
}

async function main(): Promise<void> {
  const files = await loadMarkdownFiles(DOCS_DIR);
  if (files.length === 0) {
    console.warn(`未在 ${DOCS_DIR} 找到任何 .md 文件`);
    return;
  }
  console.log(`找到 ${files.length} 个 md 文件`);

  const collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embedder,
  });

  let total = 0;
  for (const file of files) {
    const text = await readFile(file, "utf-8");
    const records = splitMarkdownByHeading(text, file);
    if (records.length === 0) continue;

    await collection.add({
      ids: records.map((r) => r.id),
      documents: records.map((r) => r.document),
      metadatas: records.map((r) => r.metadata),
    });
    total += records.length;
    console.log(`  ✓ ${file} -> ${records.length} 个 chunk`);
  }

  const count = await collection.count();
  console.log(`完成。集合 "${COLLECTION_NAME}" 共 ${count} 条（本次新增 ${total} 条）`);
}

main().catch((e: unknown) => {
  console.error("向量化失败：", e);
  process.exit(1);
});
