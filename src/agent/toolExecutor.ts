// src/agent/toolExecutor.ts

import { db } from '../db/index.js';
import { notes, flashcards, chatSessions, chatMessages } from '../db/schema.js';
import { vectorStore } from '../vector/chroma.js';
import { generateEmbeddingsServer } from '../services/embeddingService.js';
import { initializeCard } from '../services/maimemo.js';
import { parseImportUniversal } from '../services/universalImportParser.js';
import { eq, and, lte, desc } from 'drizzle-orm';
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
  const rows = await db.select().from(notes).where(
    and(eq(notes.id, params.noteId), eq(notes.userId, ctx.userId))
  ).limit(1);

  const note = rows[0];
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
