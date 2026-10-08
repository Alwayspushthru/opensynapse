import { ChromaClient } from "chromadb";

let client: ChromaClient | null = null;

// 必须在调用时读取 env，不能提到模块顶层：server.ts 的 dotenv.config() 在 import 之后才执行，
// 而 ESM 会先求值所有被导入的模块，顶层读取只会拿到空值。这里也顺带让运行时改 env 能生效。
function resolveChromaUrl(): string {
  return (process.env.CHROMA_URL || process.env.CHROMA_PATH || "").trim();
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function createClient(url: string): ChromaClient {
  if (!isHttpUrl(url)) {
    throw new Error(
      `Chroma URL 无效: "${url}"。需要 http(s) 地址，如 http://localhost:8000。请设置 CHROMA_URL 环境变量。`
    );
  }

  // chromadb v3 已废弃 path 参数（且不带端口时会把 port 解析成 0），改用 host/port/ssl。
  const parsed = new URL(url);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Chroma URL 缺少有效端口: "${url}"。请写成 http://localhost:8000 这样的形式。`);
  }

  return new ChromaClient({
    host: parsed.hostname,
    port,
    ssl: parsed.protocol === "https:",
  });
}

function getClient(): ChromaClient {
  if (!client) {
    // 不缓存失败结果：env 修好后无需重启即可恢复。
    client = createClient(resolveChromaUrl());
  }
  return client;
}

type ChromaCollection = Awaited<ReturnType<InstanceType<typeof ChromaClient>['getOrCreateCollection']>>;
export type ChromaQueryResult = Awaited<ReturnType<ChromaCollection['query']>>;

export type VectorUpsertItem = {
  noteId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, string | number | boolean | null>;
};

type ChromaFilter = Record<string, string | number | boolean>;

// chromadb v3 拒绝空 metadata 对象（Expected metadata to be non-empty）。
// updateNote 等调用方可能不传 metadata，这里兜底写入 noteId，避免写入静默失败。
function toChromaMetadata(
  metadata: Record<string, any> | undefined,
  noteId: string
): Record<string, string | number | boolean> {
  const entries = Object.entries(metadata || {}).filter(
    ([, value]) => value !== undefined && value !== null
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as Record<string, string | number | boolean>)
    : { noteId };
}

export const vectorStore = {
  async getCollection(userId: string) {
    return getClient().getOrCreateCollection({
      name: `notes_${userId}`,
      metadata: { userId },
    });
  },

  async addNote(
    userId: string,
    noteId: string,
    content: string,
    embedding: number[],
    metadata?: Record<string, any>
  ) {
    const collection = await this.getCollection(userId);
    await collection.add({
      ids: [noteId],
      embeddings: [embedding],
      metadatas: [toChromaMetadata(metadata, noteId)],
      documents: [content],
    });
  },

  async search(userId: string, queryEmbedding: number[], nResults: number = 5) {
    const collection = await this.getCollection(userId);
    return collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults,
    });
  },

  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const c = getClient();
      const heartbeatClient = c as unknown as { heartbeat?: () => Promise<unknown> };
      if (typeof heartbeatClient.heartbeat === 'function') {
        await heartbeatClient.heartbeat();
      } else {
        await c.listCollections();
      }
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Chroma health check failed',
      };
    }
  },

  async searchWithFilter(
    userId: string,
    queryEmbedding: number[],
    filter: ChromaFilter,
    nResults: number = 5
  ): Promise<ChromaQueryResult> {
    const collection = await this.getCollection(userId);
    return collection.query({
      queryEmbeddings: [queryEmbedding],
      where: filter,
      nResults,
    });
  },

  async batchUpsert(userId: string, items: VectorUpsertItem[]): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const collection = await this.getCollection(userId);
    await collection.upsert({
      ids: items.map((item) => item.noteId),
      documents: items.map((item) => item.content),
      embeddings: items.map((item) => item.embedding),
      metadatas: items.map((item) => toChromaMetadata(item.metadata, item.noteId)),
    });
  },

  async deleteNote(userId: string, noteId: string) {
    const collection = await this.getCollection(userId);
    await collection.delete({ ids: [noteId] });
  },

  async updateNote(
    userId: string,
    noteId: string,
    content: string,
    embedding: number[],
    metadata?: Record<string, any>
  ) {
    await this.deleteNote(userId, noteId);
    await this.addNote(userId, noteId, content, embedding, metadata);
  },
};
