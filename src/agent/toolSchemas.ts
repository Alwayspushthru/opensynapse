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
        tags: { type: 'string', description: '标签，逗号分隔' },
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

export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: any }> {
  return TOOL_DEFINITIONS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function toGeminiTools(): Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: any }> }> {
  return [{
    functionDeclarations: TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }];
}
