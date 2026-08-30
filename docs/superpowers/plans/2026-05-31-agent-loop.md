# Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ReAct-style Agent Loop to OpenSynapse so LLM can autonomously call internal tools during chat.

**Architecture:** Hybrid mode — ReAct loop runs on Express server, intermediate steps pushed to frontend via SSE. New `/api/ai/agent` endpoint reuses `providerGateway.ts` for LLM calls and introduces `toolExecutor.ts` for tool execution. Frontend ChatView handles two new SSE event types (`agent_step`, `agent_done`).

**Tech Stack:** TypeScript, Express SSE, Drizzle ORM, Chroma, providerGateway (existing)

**Design Spec:** `docs/superpowers/specs/2026-05-31-agent-loop-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/agent/toolSchemas.ts` | 8 tool JSON Schemas in provider-agnostic format |
| Create | `src/agent/toolExecutor.ts` | Tool execution functions + TOOL_REGISTRY |
| Create | `src/agent/agentLoop.ts` | ReAct loop engine (async generator yielding SSE events) |
| Modify | `src/lib/providerGateway.ts` | Add `generateContentWithTools()` — non-streaming LLM call with tool support, returns parsed tool_calls |
| Modify | `src/api/ai.ts` | Add `POST /agent` route |
| Modify | `src/services/gemini.ts` | Add `agentChatStream()` client function |
| Modify | `src/components/ChatView.tsx` | Handle `agent_step` / `agent_done` SSE events, add agent mode toggle |

---

### Task 1: Tool Schemas

**Files:**
- Create: `src/agent/toolSchemas.ts`

This file defines all 8 tools in a provider-agnostic JSON Schema format. Each tool has a `name`, `description`, `parameters` (JSON Schema), and a `summaryTemplate` for generating human-readable summaries from results.

- [ ] **Step 1: Create toolSchemas.ts**

```typescript
// src/agent/toolSchemas.ts

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_notes',
    description: '语义搜索用户笔记。当用户提到"之前的笔记"、"我学过的"、"相关内容"时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询，使用用户原话中的关键词' },
        limit: { type: 'number', description: '返回结果数量，默认 5' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_note_detail',
    description: '获取某条笔记的完整内容。需要笔记 ID，通常在 search_notes 返回结果后使用。',
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '笔记 ID' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'create_note',
    description: '创建新笔记。当用户说"帮我记下来"、"保存这个"时使用。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '笔记标题' },
        content: { type: 'string', description: '笔记正文（Markdown）' },
        tags: { type: 'string', description: '标签，逗号分隔', description: '标签，逗号分隔' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'update_note',
    description: '更新已有笔记的内容、标题或标签。',
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '笔记 ID' },
        title: { type: 'string', description: '新标题' },
        content: { type: 'string', description: '新内容' },
        tags: { type: 'string', description: '新标签，逗号分隔' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'create_flashcard',
    description: '为某条笔记创建闪卡。当用户说"帮我做张卡片"、"这个要记住"时使用。',
    parameters: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '关联笔记 ID' },
        question: { type: 'string', description: '问题面' },
        answer: { type: 'string', description: '答案面' },
      },
      required: ['noteId', 'question', 'answer'],
    },
  },
  {
    name: 'get_review_cards',
    description: '获取当前待复习的闪卡。当用户说"我要复习"、"今天有什么要复习的"时使用。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回数量，默认 10' },
      },
    },
  },
  {
    name: 'import_content',
    description: '导入对话或文本内容。当用户发送一段对话记录或要求"导入"时使用。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要导入的原始内容' },
        format: { type: 'string', description: '格式提示：json / markdown / text', enum: ['json', 'markdown', 'text'] },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_web',
    description: '联网搜索。当用户的问题需要最新信息或超出笔记范围时使用。基于用户已有笔记进行推理。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
  },
];

/** Convert to OpenAI-compatible tools format */
export function toOpenAITools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: any } }> {
  return TOOL_DEFINITIONS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Convert to Anthropic-compatible tools format */
export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: any }> {
  return TOOL_DEFINITIONS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** Convert to Gemini functionDeclarations format */
export function toGeminiTools(): Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: any }> }> {
  return [{
    functionDeclarations: TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/toolSchemas.ts
git commit -m "feat(agent): add tool JSON Schema definitions for 8 agent tools"
```

---

### Task 2: Tool Executor

**Files:**
- Create: `src/agent/toolExecutor.ts`

Each tool handler takes `(params, context)` and returns `{ success, data, summary }`. Context carries `userId` for data isolation.

- [ ] **Step 1: Create toolExecutor.ts**

```typescript
// src/agent/toolExecutor.ts

import { db } from '../db/index.js';
import { notes, flashcards, chatSessions, chatMessages } from '../db/schema.js';
import { vectorStore } from '../vector/chroma.js';
import { generateEmbeddingsServer } from '../services/embeddingService.js';
import { initializeCard } from '../services/maimemo.js';
import { parseImportUniversal } from '../services/universalImportParser.js';
import { generateContentWithApiKeyProvider } from '../lib/providerGateway.js';
import { eq, and, lte, desc, sql } from 'drizzle-orm';
import { generateUUID } from '../lib/utils.js';

export interface ToolRunContext {
  userId: string;
}

export interface ToolOutput {
  success: boolean;
  data: any;
  summary: string;
}

type ToolHandler = (params: any, context: ToolRunContext) => Promise<ToolOutput>;

async function handleSearchNotes(params: { query: string; limit?: number }, ctx: ToolRunContext): Promise<ToolOutput> {
  const limit = params.limit || 5;
  const userNotes = await db.select({
    id: notes.id,
    title: notes.title,
    summary: notes.summary,
    content: notes.content,
  })
    .from(notes)
    .where(eq(notes.userId, ctx.userId))
    .orderBy(desc(notes.createdAt))
    .limit(50);

  if (userNotes.length === 0) {
    return { success: true, data: { results: [] }, summary: '搜索了笔记 → 当前没有笔记' };
  }

  // Try vector search first
  try {
    const embeddingResult = await generateEmbeddingsServer([params.query]);
    if (!embeddingResult.degraded && embeddingResult.values.length > 0) {
      const vectorResults = await vectorStore.search(ctx.userId, embeddingResult.values, limit);
      const ids = vectorResults.ids?.[0] || [];
      const documents = vectorResults.documents?.[0] || [];
      const distances = vectorResults.distances?.[0] || [];

      const results = ids.map((id: string, i: number) => {
        const matchedNote = userNotes.find(n => n.id === id);
        return {
          id,
          title: matchedNote?.title || '未知笔记',
          summary: (documents[i] || '').slice(0, 200),
          relevance: distances[i],
        };
      });

      return {
        success: true,
        data: { results },
        summary: `搜索了笔记 → 找到 ${results.length} 条关于「${params.query.slice(0, 20)}」的内容`,
      };
    }
  } catch {
    // Vector search failed, fall back to text search
  }

  // Fallback: text search
  const query = params.query.toLowerCase();
  const results = userNotes
    .filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query))
    .slice(0, limit)
    .map(n => ({ id: n.id, title: n.title, summary: (n.summary || n.content).slice(0, 200) }));

  return {
    success: true,
    data: { results },
    summary: results.length > 0
      ? `搜索了笔记 → 找到 ${results.length} 条关于「${params.query.slice(0, 20)}」的内容`
      : `搜索了笔记 → 未找到关于「${params.query.slice(0, 20)}」的内容`,
  };
}

async function handleGetNoteDetail(params: { noteId: string }, ctx: ToolRunContext): Promise<ToolOutput> {
  const [note] = await db.select().from(notes).where(
    and(eq(notes.id, params.noteId), eq(notes.userId, ctx.userId))
  ).limit(1);

  if (!note) {
    return { success: false, data: null, summary: '笔记未找到' };
  }

  return {
    success: true,
    data: { id: note.id, title: note.title, content: note.content, tags: note.tags },
    summary: `获取了笔记「${note.title}」的完整内容`,
  };
}

async function handleCreateNote(params: { title: string; content: string; tags?: string }, ctx: ToolRunContext): Promise<ToolOutput> {
  const id = generateUUID();
  const tagsArray = params.tags ? params.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  await db.insert(notes).values({
    id,
    userId: ctx.userId,
    title: params.title,
    content: params.content,
    tags: tagsArray,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Generate embedding and store in Chroma (non-blocking)
  try {
    const embeddingResult = await generateEmbeddingsServer([params.content]);
    if (!embeddingResult.degraded && embeddingResult.values.length > 0) {
      await vectorStore.addNote(ctx.userId, id, params.content, embeddingResult.values, {
        title: params.title,
      });
    }
  } catch {
    // Embedding failure should not block note creation
  }

  return {
    success: true,
    data: { id },
    summary: `创建了笔记「${params.title}」`,
  };
}

async function handleUpdateNote(params: { noteId: string; title?: string; content?: string; tags?: string }, ctx: ToolRunContext): Promise<ToolOutput> {
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (params.title) updates.title = params.title;
  if (params.content) updates.content = params.content;
  if (params.tags) updates.tags = params.tags.split(',').map(t => t.trim()).filter(Boolean);

  await db.update(notes).set(updates).where(
    and(eq(notes.id, params.noteId), eq(notes.userId, ctx.userId))
  );

  // Update vector if content changed
  if (params.content) {
    try {
      const embeddingResult = await generateEmbeddingsServer([params.content]);
      if (!embeddingResult.degraded && embeddingResult.values.length > 0) {
        await vectorStore.updateNote(ctx.userId, params.noteId, params.content, embeddingResult.values);
      }
    } catch {
      // Non-blocking
    }
  }

  return {
    success: true,
    data: { noteId: params.noteId },
    summary: `更新了笔记${params.title ? `「${params.title}」` : ''}`,
  };
}

async function handleCreateFlashcard(params: { noteId: string; question: string; answer: string }, ctx: ToolRunContext): Promise<ToolOutput> {
  const card = initializeCard({
    noteId: params.noteId,
    question: params.question,
    answer: params.answer,
    userId: ctx.userId,
  });

  await db.insert(flashcards).values({
    id: card.id,
    userId: ctx.userId,
    noteId: card.noteId,
    question: card.question,
    answer: card.answer,
    stability: card.stability,
    difficulty: card.difficulty,
    state: card.state,
    reps: card.repetitions,
    due: new Date(card.nextReview),
    lastReview: null,
    createdAt: new Date(),
  });

  return {
    success: true,
    data: { id: card.id },
    summary: `创建了闪卡：${card.question.slice(0, 30)}...`,
  };
}

async function handleGetReviewCards(params: { limit?: number }, ctx: ToolRunContext): Promise<ToolOutput> {
  const limit = params.limit || 10;
  const now = new Date();

  const cards = await db.select().from(flashcards).where(
    and(
      eq(flashcards.userId, ctx.userId),
      lte(flashcards.due, now),
    )
  ).limit(limit);

  return {
    success: true,
    data: {
      count: cards.length,
      cards: cards.map(c => ({
        id: c.id,
        question: c.question,
        answer: c.answer,
        difficulty: c.difficulty,
        state: c.state,
      })),
    },
    summary: cards.length > 0
      ? `找到了 ${cards.length} 张待复习卡片`
      : '当前没有待复习的卡片',
  };
}

async function handleImportContent(params: { content: string; format?: string }, ctx: ToolRunContext): Promise<ToolOutput> {
  const result = await parseImportUniversal(params.content, {
    filename: params.format ? `import.${params.format}` : undefined,
    useAI: false,
  });

  let importedCount = 0;
  for (const conv of result.conversations) {
    const sessionId = generateUUID();
    await db.insert(chatSessions).values({
      id: sessionId,
      userId: ctx.userId,
      title: conv.title || '导入的对话',
      source: conv.source,
      importedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    for (const msg of conv.messages) {
      await db.insert(chatMessages).values({
        id: generateUUID(),
        sessionId,
        role: msg.role,
        content: msg.text,
        thinking: msg.thought || null,
        createdAt: new Date(),
      });
    }
    importedCount++;
  }

  return {
    success: true,
    data: { sessions: importedCount, confidence: result.confidence },
    summary: `导入了 ${importedCount} 个对话（置信度 ${Math.round(result.confidence * 100)}%）`,
  };
}

async function handleSearchWeb(params: { query: string }, ctx: ToolRunContext): Promise<ToolOutput> {
  // Degraded: use user's notes to answer, not real web search
  const userNotes = await db.select({
    title: notes.title,
    content: notes.content,
  })
    .from(notes)
    .where(eq(notes.userId, ctx.userId))
    .limit(5);

  return {
    success: true,
    data: {
      query: params.query,
      noteContext: userNotes.map(n => n.title),
      message: '当前为笔记内搜索模式，基于用户已有笔记推理',
    },
    summary: `搜索了「${params.query.slice(0, 20)}」→ 基于 ${userNotes.length} 条笔记进行推理`,
  };
}

export const TOOL_REGISTRY: Record<string, ToolHandler> = {
  search_notes: handleSearchNotes,
  get_note_detail: handleGetNoteDetail,
  create_note: handleCreateNote,
  update_note: handleUpdateNote,
  create_flashcard: handleCreateFlashcard,
  get_review_cards: handleGetReviewCards,
  import_content: handleImportContent,
  search_web: handleSearchWeb,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/toolExecutor.ts
git commit -m "feat(agent): add tool executor with 8 tool handlers"
```

---

### Task 3: Provider Gateway — Tool Call Support

**Files:**
- Modify: `src/lib/providerGateway.ts`

Add a `generateContentWithTools()` function that sends tool definitions to the LLM and parses tool_calls from the response. This is a **non-streaming** call used by the agent loop for intermediate iterations. The final iteration (no tool_calls) uses the existing streaming path.

- [ ] **Step 1: Add types and conversion helpers at the top of providerGateway.ts**

Add after the existing type definitions (around line 28):

```typescript
export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

export type ToolsGatewayResult = {
  text: string;
  toolCalls: ToolCallRequest[];
  raw: unknown;
};

export type ToolDefinitionInput = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
};
```

- [ ] **Step 2: Add tool call parsing for OpenAI Compat responses**

Add a new function `parseOpenAIToolCalls` after `extractChatCompletionText` (around line 335):

```typescript
function parseOpenAIToolCalls(payload: any): ToolCallRequest[] {
  const message = payload?.choices?.[0]?.message;
  if (!message?.tool_calls || !Array.isArray(message.tool_calls)) return [];

  return message.tool_calls
    .map((tc: any) => {
      if (!tc?.function?.name) return null;
      let args: Record<string, any> = {};
      try {
        args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function.arguments || {});
      } catch {
        args = {};
      }
      return {
        id: tc.id || `tc_${Date.now()}`,
        name: tc.function.name,
        arguments: args,
      };
    })
    .filter(Boolean) as ToolCallRequest[];
}

function parseAnthropicToolCalls(payload: any): ToolCallRequest[] {
  const content = payload?.content;
  if (!Array.isArray(content)) return [];

  return content
    .filter((item: any) => item?.type === 'tool_use')
    .map((item: any) => ({
      id: item.id || `tc_${Date.now()}`,
      name: item.name || '',
      arguments: item.input || {},
    }))
    .filter((tc: ToolCallRequest) => tc.name);
}
```

- [ ] **Step 3: Add `generateContentWithTools` function**

Add before `generateContentWithApiKeyProvider` (around line 713):

```typescript
export async function generateContentWithTools(
  params: GatewayParams & { tools?: ToolDefinitionInput[] }
): Promise<ToolsGatewayResult> {
  const parsed = parseModelSelection(params.model);
  if (parsed.provider === 'gemini') {
    throw new Error('generateContentWithTools does not handle Gemini provider directly. Use ai.ts Gemini path.');
  }

  const provider = getResolvedProviderConfig(parsed.canonicalId);
  const tools = params.tools || [];

  if (provider.protocol === 'anthropic_compat') {
    const body = buildAnthropicBody(params);
    if (tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      // Anthropic requires tool_choice for tool use
      body.tool_choice = { type: 'auto' };
    }

    const { apiKey } = getRequiredApiKey(parsed.canonicalId);
    const response = await fetch(toProviderEndpoint(parsed.provider), {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      parseApiErrorText(response.status, response.statusText, await response.text());
    }

    const payload = await response.json();
    return {
      text: extractAnthropicText(payload),
      toolCalls: parseAnthropicToolCalls(payload),
      raw: payload,
    };
  }

  // OpenAI Compat (openai, zhipu, moonshot, nvidia, openrouter)
  const body = buildChatCompletionsBody(params);
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const { apiKey } = getRequiredApiKey(parsed.canonicalId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (parsed.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://opensynapse.app';
    headers['X-Title'] = 'OpenSynapse';
  }

  const response = await fetch(toProviderEndpoint(parsed.provider), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    parseApiErrorText(response.status, response.statusText, await response.text());
  }

  const payload = await response.json();
  return {
    text: extractChatCompletionText(payload),
    toolCalls: parseOpenAIToolCalls(payload),
    raw: payload,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/providerGateway.ts
git commit -m "feat(agent): add generateContentWithTools for tool-call LLM interaction"
```

---

### Task 4: Agent Loop Engine

**Files:**
- Create: `src/agent/agentLoop.ts`

The core ReAct loop. It's an async generator that yields SSE events. For non-Gemini providers, uses `generateContentWithTools`. For Gemini, uses the SDK's native function calling. Each iteration: call LLM → check for tool_calls → execute tools → push to context → repeat.

- [ ] **Step 1: Create agentLoop.ts**

```typescript
// src/agent/agentLoop.ts

import { TOOL_REGISTRY, type ToolRunContext, type ToolOutput } from './toolExecutor.js';
import { TOOL_DEFINITIONS, toOpenAITools, toAnthropicTools, toGeminiTools } from './toolSchemas.js';
import { generateContentWithTools, type ToolDefinitionInput, generateContentStreamWithApiKeyProvider } from '../lib/providerGateway.js';
import { parseModelSelection, getResolvedProviderConfig } from '../lib/aiModels.js';
import { GoogleGenAI } from '@google/genai';
import type { Response } from 'express';

export type AgentSSEvent =
  | { type: 'agent_step'; summary: string }
  | { type: 'agent_done'; steps: string[]; iterations: number }
  | { type: 'text'; content: string }
  | { type: 'thought'; content: string }
  | { type: 'error'; message: string };

export interface AgentLoopParams {
  userId: string;
  model: string;
  messages: Array<{ role: string; parts: Array<Record<string, any>> }>;
  systemInstruction?: string;
  maxIterations?: number;
  geminiApiKey?: string;
}

type InternalToolCall = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

type InternalToolResult = {
  toolCallId: string;
  name: string;
  result: any;
};

type AgentMessage =
  | { role: 'user' | 'model'; parts: Array<Record<string, any>> }
  | { role: 'tool'; toolCallId: string; name: string; parts: Array<{ text: string }> };

const MAX_ITERATIONS = 10;
const HEARTBEAT_INTERVAL_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run the agent loop with heartbeat keep-alive.
 * Yields SSE events as they happen.
 */
export async function* runAgentLoop(
  params: AgentLoopParams
): AsyncGenerator<AgentSSEvent> {
  const { userId, model, systemInstruction, maxIterations = MAX_ITERATIONS, geminiApiKey } = params;
  const steps: string[] = [];
  const parsed = parseModelSelection(model);
  const toolCtx: ToolRunContext = { userId };

  // Deep copy messages to avoid mutating input
  const contextMessages: AgentMessage[] = params.messages.map(m => ({ ...m }));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    try {
      const result = await callLLMWithTools({
        model: parsed,
        messages: contextMessages,
        systemInstruction,
        geminiApiKey,
      });

      // Process thoughts from the response
      if (result.thought) {
        yield { type: 'thought', content: result.thought };
      }

      // Check for tool calls
      if (result.toolCalls.length === 0) {
        // No tool calls — final response
        if (steps.length > 0) {
          yield { type: 'agent_done', steps, iterations: iteration + 1 };
        }
        if (result.text) {
          yield { type: 'text', content: result.text };
        }
        return;
      }

      // Process tool calls
      // Add assistant message with tool calls to context
      contextMessages.push({
        role: 'model',
        parts: [
          ...(result.text ? [{ text: result.text }] : []),
          ...result.toolCalls.map(tc => ({
            functionCall: { name: tc.name, args: tc.arguments },
          })),
        ],
      });

      // Execute each tool call
      for (const call of result.toolCalls) {
        const handler = TOOL_REGISTRY[call.name];
        if (!handler) {
          const summary = `未知工具: ${call.name}`;
          steps.push(summary);
          yield { type: 'agent_step', summary };
          contextMessages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            parts: [{ text: JSON.stringify({ error: `Unknown tool: ${call.name}` }) }],
          });
          continue;
        }

        let output: ToolOutput;
        try {
          output = await handler(call.arguments, toolCtx);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          output = { success: false, data: { error: msg }, summary: `${call.name} 执行失败: ${msg.slice(0, 80)}` };
        }

        steps.push(output.summary);
        yield { type: 'agent_step', summary: output.summary };

        // Add tool result to context
        contextMessages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          parts: [{ text: JSON.stringify(output.data) }],
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (steps.length > 0) {
        yield { type: 'agent_done', steps, iterations: iteration + 1 };
      }
      yield { type: 'error', message: msg };
      return;
    }
  }

  // Max iterations reached
  yield { type: 'agent_done', steps, iterations: maxIterations };
  yield { type: 'text', content: '已达到最大思考轮次，以上是目前的结果。' };
}

type LLMParsedResult = {
  text: string;
  thought: string;
  toolCalls: InternalToolCall[];
};

async function callLLMWithTools(params: {
  model: ReturnType<typeof parseModelSelection>;
  messages: AgentMessage[];
  systemInstruction?: string;
  geminiApiKey?: string;
}): Promise<LLMParsedResult> {
  const { model, messages, systemInstruction, geminiApiKey } = params;

  if (model.provider === 'gemini') {
    return callGeminiWithTools(model.canonicalId, messages, systemInstruction, geminiApiKey);
  }

  // Non-Gemini: use providerGateway
  const openaiTools = toOpenAITools() as ToolDefinitionInput[];
  const contents = messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        parts: m.parts,
        toolCallId: (m as any).toolCallId,
        name: (m as any).name,
      };
    }
    return { role: m.role, parts: m.parts };
  });

  const result = await generateContentWithTools({
    model: model.canonicalId,
    contents,
    config: { systemInstruction },
    tools: openaiTools,
  });

  return {
    text: result.text,
    thought: '',
    toolCalls: result.toolCalls,
  };
}

async function callGeminiWithTools(
  modelId: string,
  messages: AgentMessage[],
  systemInstruction?: string,
  apiKey?: string,
): Promise<LLMParsedResult> {
  if (!apiKey) {
    throw new Error('Gemini Agent 需要 API Key');
  }

  const client = new GoogleGenAI({ apiKey });
  const geminiTools = toGeminiTools();

  // Convert agent messages to Gemini format
  const contents: any[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Gemini uses functionResponse
      contents.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name: (msg as any).name,
            response: JSON.parse(msg.parts[0]?.text || '{}'),
          },
        }],
      });
    } else {
      // Filter out functionCall parts for Gemini
      const textParts = msg.parts.filter(p => !('functionCall' in p));
      const functionCallParts = msg.parts.filter(p => 'functionCall' in p);

      const entry: any = { role: msg.role === 'model' ? 'model' : 'user', parts: textParts };
      if (functionCallParts.length > 0) {
        entry.parts = [...textParts, ...functionCallParts];
      }
      contents.push(entry);
    }
  }

  const response = await client.models.generateContent({
    model: modelId.includes('/') ? modelId.split('/')[1] : modelId,
    contents,
    config: {
      systemInstruction: systemInstruction || undefined,
      tools: geminiTools,
    },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  let text = '';
  let thought = '';
  const toolCalls: InternalToolCall[] = [];

  for (const part of parts) {
    if ((part as any).thought && part.text) {
      thought += part.text;
    } else if (part.text) {
      text += part.text;
    } else if ((part as any).functionCall) {
      const fc = (part as any).functionCall;
      toolCalls.push({
        id: `fc_${Date.now()}_${toolCalls.length}`,
        name: fc.name,
        arguments: fc.args || {},
      });
    }
  }

  return { text, thought, toolCalls };
}

/**
 * Helper: start a heartbeat timer on the SSE response to prevent proxy timeout.
 * Returns a cleanup function.
 */
export function startHeartbeat(res: Response): () => void {
  const timer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(timer);
    }
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/agentLoop.ts
git commit -m "feat(agent): add ReAct loop engine with multi-provider tool calling"
```

---

### Task 5: API Route — POST /agent

**Files:**
- Modify: `src/api/ai.ts`

Add a new route `POST /api/ai/agent` that accepts the same body as `generateContentStream` but runs the agent loop. It uses `requireAuth` to get `userId` for tool execution.

- [ ] **Step 1: Add imports at top of ai.ts**

Add after the existing imports (line 24):

```typescript
import { runAgentLoop, startHeartbeat, type AgentSSEvent } from '../agent/agentLoop.js';
```

- [ ] **Step 2: Add the /agent route before `export default router`**

Add before the last line of ai.ts:

```typescript
// ─── Agent Loop 端点 ───
router.post('/agent', requireAuth(async (req, res, userId) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const stopHeartbeat = startHeartbeat(res);

  try {
    const parsed = parseModelSelection(req.body?.model);
    const systemInstruction = req.body?.config?.systemInstruction;
    const contents = req.body?.contents || [];

    // Resolve credentials for Gemini
    let geminiApiKey: string | undefined;
    if (parsed.provider === 'gemini') {
      const resolved = await resolveProviderCredentialsFromRequest(req, getAuthorizationHeader(req), 'gemini');
      geminiApiKey = resolved.apiKey || undefined;
    }

    // For non-Gemini providers, set up credentials
    if (parsed.provider !== 'gemini') {
      if (!isSupportedProvider(parsed.provider)) {
        throw new Error(`不支持的 provider: ${parsed.provider}`);
      }
      const resolvedCredentials = await resolveProviderCredentialsFromRequest(req, getAuthorizationHeader(req), parsed.provider);

      await withProviderCredentials(parsed.provider, resolvedCredentials, async () => {
        const agentStream = runAgentLoop({
          userId,
          model: parsed.canonicalId,
          messages: contents,
          systemInstruction,
          geminiApiKey,
        });

        for await (const event of agentStream) {
          if ((event as any).type === 'text') {
            res.write(`data: ${JSON.stringify({ text: (event as any).content })}\n\n`);
          } else if ((event as any).type === 'thought') {
            res.write(`data: ${JSON.stringify({ thought: (event as any).content })}\n\n`);
          } else if ((event as any).type === 'agent_step') {
            res.write(`data: ${JSON.stringify({ type: 'agent_step', summary: (event as any).summary })}\n\n`);
          } else if ((event as any).type === 'agent_done') {
            res.write(`data: ${JSON.stringify({ type: 'agent_done', steps: (event as any).steps, iterations: (event as any).iterations })}\n\n`);
          } else if ((event as any).type === 'error') {
            res.write(`data: ${JSON.stringify({ error: (event as any).message })}\n\n`);
          }
        }
      });
    } else {
      // Gemini path
      const agentStream = runAgentLoop({
        userId,
        model: parsed.canonicalId,
        messages: contents,
        systemInstruction,
        geminiApiKey,
      });

      for await (const event of agentStream) {
        if ((event as any).type === 'text') {
          res.write(`data: ${JSON.stringify({ text: (event as any).content })}\n\n`);
        } else if ((event as any).type === 'thought') {
          res.write(`data: ${JSON.stringify({ thought: (event as any).content })}\n\n`);
        } else if ((event as any).type === 'agent_step') {
          res.write(`data: ${JSON.stringify({ type: 'agent_step', summary: (event as any).summary })}\n\n`);
        } else if ((event as any).type === 'agent_done') {
          res.write(`data: ${JSON.stringify({ type: 'agent_done', steps: (event as any).steps, iterations: (event as any).iterations })}\n\n`);
        } else if ((event as any).type === 'error') {
          res.write(`data: ${JSON.stringify({ error: (event as any).message })}\n\n`);
        }
      }
    }

    res.write('data: [DONE]\n\n');
  } catch (error: any) {
    console.error('[AI] Agent Error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    stopHeartbeat();
    res.end();
  }
}));
```

- [ ] **Step 3: Commit**

```bash
git add src/api/ai.ts
git commit -m "feat(agent): add POST /api/ai/agent endpoint with SSE streaming"
```

---

### Task 6: Frontend — Agent Client + ChatView Integration

**Files:**
- Modify: `src/services/gemini.ts`
- Modify: `src/components/ChatView.tsx`

Add a client-side `agentChatStream()` function that calls the new `/api/ai/agent` endpoint. Then modify ChatView to use it when agent mode is on, and render `agent_step` / `agent_done` events.

- [ ] **Step 1: Add `agentChatStream` to gemini.ts**

Add after the `ai` object definition (around line 101), inside the file but after `getAiRequestHeadersForModel`:

```typescript
export async function* agentChatStream(
  messages: ChatMessage[],
  currentPersona: Persona | undefined,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk & { type?: string; summary?: string; steps?: string[]; iterations?: number }> {
  const model = getPreferredTextModel();
  const headers = await getAiRequestHeadersForModel(model);

  const contents = messages.map(m => {
    const parts: any[] = [{ text: m.text }];
    return { parts, role: m.role };
  });

  const response = await fetch('/api/ai/agent', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      contents,
      config: {
        systemInstruction: currentPersona?.systemPrompt || '',
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Agent stream failed: ${await response.text()}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No readable stream');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        if (line.startsWith(': ')) continue; // heartbeat
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data);
        } catch {
          // ignore malformed
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 2: Add agent state to ChatView**

In ChatView, add state variables near the other `useState` calls (search for `const [abortController`):

```typescript
const [agentMode, setAgentMode] = useState(true);
const [agentSteps, setAgentSteps] = useState<string[]>([]);
```

- [ ] **Step 3: Add agent send handler**

Add after `handleSendWithMessages`:

```typescript
const handleAgentSend = async (messagesToSend: ChatMessage[]) => {
  setIsLoading(true);
  const controller = new AbortController();
  setAbortController(controller);
  setAgentSteps([]);

  try {
    setMessages(prev => [...prev, { role: 'model', text: '', thought: '' }]);

    let fullText = '';
    let fullThought = '';
    const steps: string[] = [];

    const stream = agentChatStream(messagesToSend, currentPersona, controller.signal);
    for await (const chunk of stream) {
      if (chunk.type === 'agent_step' && chunk.summary) {
        steps.push(chunk.summary);
        setAgentSteps([...steps]);
      } else if (chunk.type === 'agent_done') {
        setAgentSteps(chunk.steps || steps);
      } else if (chunk.thought) {
        fullThought += chunk.thought;
      } else if (chunk.text) {
        fullText += chunk.text;
      } else if (chunk.error) {
        throw new Error(chunk.error);
      }

      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'model') {
          updated[updated.length - 1] = { ...last, text: fullText, thought: fullThought };
        }
        return updated;
      });
    }

    const finalMessages: ChatMessage[] = [...messagesToSend, { role: 'model', text: fullText }];
    const sessionId = currentSessionId || generateUUID();
    if (!currentSessionId) setCurrentSessionId(sessionId);
    const title = finalMessages.find(m => m.role === 'user')?.text.slice(0, 30) || '新会话';
    await onSaveSession({
      id: sessionId,
      title,
      messages: finalMessages,
      updatedAt: Date.now(),
      userId: '',
      personaId: selectedPersonaId,
      model: selectedModel,
    });
  } catch (error: any) {
    if (controller.signal.aborted) return;
    console.error('Agent error:', error);
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last.role === 'model' && !last.text) {
        return prev.slice(0, -1).concat({ role: 'model', text: getUserFacingAiError(error) });
      }
      return prev;
    });
  } finally {
    setIsLoading(false);
    setAbortController(null);
  }
};
```

- [ ] **Step 4: Modify handleSend to route to agent**

In the `handleSend` function, change the last line from:

```typescript
await handleSendWithMessages(newMessages);
```

to:

```typescript
if (agentMode) {
  await handleAgentSend(newMessages);
} else {
  await handleSendWithMessages(newMessages);
}
```

Do the same for `handleRegenerate` — change:

```typescript
await handleSendWithMessages(truncated);
```

to:

```typescript
if (agentMode) {
  await handleAgentSend(truncated);
} else {
  await handleSendWithMessages(truncated);
}
```

- [ ] **Step 5: Add agent step summary UI**

Add a helper component before the main `ChatView` component (near the `ThoughtProcess` component):

```typescript
function AgentStepsSummary({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="mx-auto max-w-3xl px-4 pb-2">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap gap-2"
      >
        {steps.map((step, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-400"
          >
            <Sparkles className="h-3 w-3" />
            {step}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 6: Render AgentStepsSummary in the chat area**

In the JSX, find where messages are rendered (look for the messages map). Add `<AgentStepsSummary steps={agentSteps} />` just before the message list, inside the scroll container.

- [ ] **Step 7: Add agent toggle to toolbar**

Find the existing toolbar area (where model selector and persona selector are). Add a toggle button:

```tsx
<button
  onClick={() => setAgentMode(!agentMode)}
  className={cn(
    'rounded-lg px-2 py-1 text-xs transition-colors',
    agentMode
      ? 'bg-blue-500/20 text-blue-400'
      : 'bg-gray-500/10 text-gray-400'
  )}
  title={agentMode ? 'Agent 模式已开启' : 'Agent 模式已关闭'}
>
  <BrainCircuit className="h-4 w-4" />
</button>
```

- [ ] **Step 8: Commit**

```bash
git add src/services/gemini.ts src/components/ChatView.tsx
git commit -m "feat(agent): add agent mode toggle and step summary UI in ChatView"
```

---

### Task 7: Wire Up and Test

**Files:** None new

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors. If there are type errors, fix them.

- [ ] **Step 2: Start dev server and smoke test**

```bash
npm run dev
```

Test scenarios:
1. Open ChatView, verify agent mode toggle is visible (BrainCircuit icon)
2. Send "帮我搜索一下之前关于 React 的笔记" → should see agent_step summary + results
3. Send "帮我创建一条笔记，标题是测试，内容是 Agent 测试" → should see creation step
4. Toggle agent mode OFF → verify normal chat still works

- [ ] **Step 3: Fix any runtime issues**

If the server fails to start or the agent endpoint returns errors, fix the import paths, type mismatches, or missing dependencies.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(agent): resolve integration issues and finalize agent loop"
```
