export type LearningIntent =
  | 'explain'
  | 'ask_example'
  | 'solve_problem'
  | 'quiz'
  | 'review'
  | 'summarize'
  | 'extract_note'
  | 'generate_flashcards'
  | 'connect_knowledge'
  | 'plan_learning_path'
  | 'casual_chat';

export type LearningIntentGroup =
  | 'tutoring'
  | 'practice'
  | 'memory'
  | 'knowledge_building'
  | 'planning'
  | 'chat';

export type IntentSourceScores = {
  pattern: number;
  keyword: number;
  context: number;
  llm?: number;
};

export interface LearningIntentInput {
  message: string;
  history?: Array<{ role: string; content?: string; text?: string }>;
}

export interface LearningIntentResult {
  intent: LearningIntent;
  group: LearningIntentGroup;
  confidence: number;
  sourceScores: IntentSourceScores;
  reason: string;
  entities: {
    topics: string[];
    requestedCount?: number;
  };
  shouldUseRAG: boolean;
  shouldUseTools: boolean;
  preferredTools: string[];
  matchedSignals: string[];
  latencyMs: number;
}

export interface LLMIntentCandidate {
  intent: LearningIntent;
  confidence: number;
  reason?: string;
}

export type LLMIntentClassifier = (prompt: string) => Promise<string | LLMIntentCandidate>;

type IntentRule = {
  intent: LearningIntent;
  group: LearningIntentGroup;
  patterns: RegExp[];
  keywords: string[];
  preferredTools: string[];
  shouldUseRAG: boolean;
  shouldUseTools: boolean;
};

type RuleScore = {
  intent: LearningIntent;
  pattern: number;
  keyword: number;
  context: number;
  total: number;
  matchedSignals: string[];
};

const INTENT_GROUPS: Record<LearningIntent, LearningIntentGroup> = {
  explain: 'tutoring',
  ask_example: 'tutoring',
  solve_problem: 'tutoring',
  quiz: 'practice',
  review: 'memory',
  summarize: 'knowledge_building',
  extract_note: 'knowledge_building',
  generate_flashcards: 'knowledge_building',
  connect_knowledge: 'knowledge_building',
  plan_learning_path: 'planning',
  casual_chat: 'chat',
};

const FALLBACK_INTENT: LearningIntent = 'explain';

const INTENT_PRIORITY: LearningIntent[] = [
  'review',
  'generate_flashcards',
  'extract_note',
  'connect_knowledge',
  'plan_learning_path',
  'quiz',
  'solve_problem',
  'ask_example',
  'summarize',
  'explain',
  'casual_chat',
];

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'review',
    group: 'memory',
    patterns: [
      /复习|回顾|巩固|待复习|到期.*卡片|今天.*卡片|review|spaced repetition|due cards?/i,
    ],
    keywords: ['复习', '回顾', '巩固', '待复习', '记忆', 'review', 'due'],
    preferredTools: ['get_review_cards', 'search_notes'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'generate_flashcards',
    group: 'knowledge_building',
    patterns: [
      /闪卡|anki|抽认卡|主动召回|(?:生成|做|创建|制作).*?(?:题卡|闪卡|卡片)|flashcards?/i,
    ],
    keywords: ['闪卡', 'anki', '抽认卡', '主动召回', '生成卡片', '制作卡片', 'flashcard'],
    preferredTools: ['create_flashcard', 'search_notes'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'extract_note',
    group: 'knowledge_building',
    patterns: [
      /整理.*笔记|沉淀.*笔记|提炼.*知识|保存.*笔记|记下来|总结成.*笔记|extract.*note/i,
    ],
    keywords: ['整理', '沉淀', '提炼', '笔记', '保存', '记下来', 'extract'],
    preferredTools: ['create_note', 'create_flashcard'],
    shouldUseRAG: false,
    shouldUseTools: true,
  },
  {
    intent: 'connect_knowledge',
    group: 'knowledge_building',
    patterns: [
      /关联|联系|连接|知识图谱|相关笔记|之前.*笔记|和.*有关|connect|graph|related notes?/i,
    ],
    keywords: ['关联', '联系', '连接', '图谱', '相关', '之前', 'connect', 'graph'],
    preferredTools: ['search_notes', 'get_note_detail'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'plan_learning_path',
    group: 'planning',
    patterns: [
      /学习路线|学习路径|规划|计划|下一步|怎么学|从零开始|roadmap|learning path|study plan/i,
    ],
    keywords: ['路线', '路径', '规划', '计划', '下一步', '怎么学', 'roadmap', 'plan'],
    preferredTools: ['search_notes', 'get_review_cards'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'quiz',
    group: 'practice',
    patterns: [
      /出.*题|测.*我|考.*我|小测|练习题|quiz|test me|practice/i,
    ],
    keywords: ['出题', '测验', '考我', '练习', '小测', 'quiz', 'practice'],
    preferredTools: ['search_notes'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'solve_problem',
    group: 'tutoring',
    patterns: [
      /报错|错误|debug|bug|不会做|怎么解|帮我做|求解|solve|fix|why.*wrong/i,
    ],
    keywords: ['报错', '错误', 'debug', 'bug', '求解', '不会做', 'solve', 'fix'],
    preferredTools: ['search_notes'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'ask_example',
    group: 'tutoring',
    patterns: [
      /举.*例|例子|案例|类比|example|case|analogy/i,
    ],
    keywords: ['例子', '案例', '类比', '举例', 'example', 'case'],
    preferredTools: ['search_notes'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'summarize',
    group: 'knowledge_building',
    patterns: [
      /总结|概括|归纳|复盘|summary|summarize|recap/i,
    ],
    keywords: ['总结', '概括', '归纳', '复盘', 'summary', 'recap'],
    preferredTools: ['search_notes'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'explain',
    group: 'tutoring',
    patterns: [
      /解释|讲一下|讲讲|为什么|是什么|原理|如何理解|explain|what is|why|how does/i,
    ],
    keywords: ['解释', '讲', '为什么', '是什么', '原理', '理解', 'explain', 'why'],
    preferredTools: ['search_notes'],
    shouldUseRAG: true,
    shouldUseTools: true,
  },
  {
    intent: 'casual_chat',
    group: 'chat',
    patterns: [
      /^(你好|您好|嗨|在吗|谢谢|好的|ok|hi|hello|thanks)[!！。,. ]*$/i,
    ],
    keywords: ['你好', '您好', '谢谢', 'hi', 'hello', 'thanks', 'ok'],
    preferredTools: [],
    shouldUseRAG: false,
    shouldUseTools: false,
  },
];

export function recognizeLearningIntent(input: string | LearningIntentInput): LearningIntentResult {
  const startedAt = performanceNow();
  const normalizedInput = normalizeInput(input);
  const message = normalizedInput.message.trim();
  const history = normalizedInput.history || [];

  if (!message) {
    return buildResult({
      intent: 'casual_chat',
      confidence: 0.95,
      sourceScores: { pattern: 0, keyword: 0, context: 0 },
      reason: '空消息按轻量闲聊处理。',
      matchedSignals: [],
      message,
      latencyMs: elapsed(startedAt),
    });
  }

  const scores = scoreRules(message, history);
  const best = pickBestScore(scores);
  const confidence = estimateConfidence(best, scores, message);
  const intent = confidence < 0.35 ? fallbackIntent(message) : best.intent;

  return buildResult({
    intent,
    confidence,
    sourceScores: {
      pattern: clamp01(best.pattern),
      keyword: clamp01(best.keyword),
      context: clamp01(best.context),
    },
    reason: explainDecision(intent, best, confidence),
    matchedSignals: best.matchedSignals,
    message,
    latencyMs: elapsed(startedAt),
  });
}

export async function recognizeLearningIntentWithLLM(
  input: string | LearningIntentInput,
  classify: LLMIntentClassifier
): Promise<LearningIntentResult> {
  const base = recognizeLearningIntent(input);
  const normalizedInput = normalizeInput(input);

  try {
    const candidate = normalizeLLMCandidate(
      await classify(buildLearningIntentPrompt(normalizedInput))
    );
    if (!candidate) {
      return base;
    }

    const llmConfidence = clamp01(candidate.confidence);
    const sameIntent = candidate.intent === base.intent;
    const shouldTrustLLM = llmConfidence >= 0.72 && (base.confidence < 0.7 || sameIntent);
    if (!shouldTrustLLM) {
      return {
        ...base,
        sourceScores: { ...base.sourceScores, llm: llmConfidence },
      };
    }

    return buildResult({
      intent: candidate.intent,
      confidence: clamp01((base.confidence * 0.45) + (llmConfidence * 0.55)),
      sourceScores: { ...base.sourceScores, llm: llmConfidence },
      reason: candidate.reason || `LLM 分类与规则融合后选择 ${candidate.intent}。`,
      matchedSignals: base.matchedSignals,
      message: normalizedInput.message,
      latencyMs: base.latencyMs,
    });
  } catch {
    return base;
  }
}

export function buildLearningIntentPrompt(input: LearningIntentInput): string {
  const historyText = (input.history || [])
    .slice(-4)
    .map((item) => `${item.role}: ${item.content || item.text || ''}`)
    .join('\n');

  return `你是 OpenSynapse 的学习意图分类器。请判断用户本轮最主要的学习意图。

可选 intent:
${INTENT_PRIORITY.map((intent) => `- ${intent}`).join('\n')}

最近上下文:
${historyText || '(无)'}

用户消息:
${input.message}

只返回 JSON:
{"intent":"explain","confidence":0.0,"reason":"简短原因"}`;
}

function normalizeInput(input: string | LearningIntentInput): LearningIntentInput {
  if (typeof input === 'string') {
    return { message: input };
  }
  return {
    message: input.message || '',
    history: input.history || [],
  };
}

function scoreRules(message: string, history: LearningIntentInput['history']): RuleScore[] {
  const normalized = message.toLowerCase();
  const contextText = (history || [])
    .slice(-4)
    .map((item) => `${item.role} ${item.content || item.text || ''}`)
    .join('\n')
    .toLowerCase();

  return INTENT_RULES.map((rule) => {
    const patternMatches = rule.patterns.filter((pattern) => pattern.test(message));
    const keywordMatches = rule.keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
    const contextMatches = rule.keywords.filter((keyword) => contextText.includes(keyword.toLowerCase()));
    const pattern = Math.min(1, patternMatches.length * 0.7);
    const keyword = Math.min(1, keywordMatches.length / Math.max(2, rule.keywords.length * 0.35));
    const context = Math.min(0.35, contextMatches.length * 0.08);
    const specificityBoost = rule.intent === 'casual_chat' ? 0 : Math.min(0.12, message.length / 400);

    return {
      intent: rule.intent,
      pattern,
      keyword,
      context,
      total: (pattern * 0.55) + (keyword * 0.3) + (context * 0.15) + specificityBoost,
      matchedSignals: [
        ...patternMatches.map((patternMatch) => `pattern:${patternMatch.source}`),
        ...keywordMatches.map((keyword) => `keyword:${keyword}`),
        ...contextMatches.map((keyword) => `context:${keyword}`),
      ],
    };
  });
}

function pickBestScore(scores: RuleScore[]): RuleScore {
  return [...scores].sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    return INTENT_PRIORITY.indexOf(a.intent) - INTENT_PRIORITY.indexOf(b.intent);
  })[0];
}

function estimateConfidence(best: RuleScore, scores: RuleScore[], message: string): number {
  const second = [...scores].sort((a, b) => b.total - a.total)[1]?.total || 0;
  const margin = Math.max(0, best.total - second);
  const lengthSignal = message.length >= 8 ? 0.08 : 0;
  const base = best.total * 0.78 + margin * 0.35 + lengthSignal;
  if (best.intent === 'casual_chat' && best.pattern > 0) {
    return 0.96;
  }
  return clamp01(Math.max(0.2, base));
}

function fallbackIntent(message: string): LearningIntent {
  const trimmed = message.trim();
  if (/^(你好|您好|嗨|hi|hello|谢谢|thanks|ok|好的)/i.test(trimmed)) {
    return 'casual_chat';
  }
  return FALLBACK_INTENT;
}

function buildResult(params: {
  intent: LearningIntent;
  confidence: number;
  sourceScores: IntentSourceScores;
  reason: string;
  matchedSignals: string[];
  message: string;
  latencyMs: number;
}): LearningIntentResult {
  const rule = INTENT_RULES.find((item) => item.intent === params.intent);
  const shouldUseRAG = rule?.shouldUseRAG ?? params.intent !== 'casual_chat';
  const preferredTools = rule?.preferredTools ?? [];

  return {
    intent: params.intent,
    group: INTENT_GROUPS[params.intent],
    confidence: round4(params.confidence),
    sourceScores: {
      pattern: round4(params.sourceScores.pattern),
      keyword: round4(params.sourceScores.keyword),
      context: round4(params.sourceScores.context),
      ...(typeof params.sourceScores.llm === 'number' ? { llm: round4(params.sourceScores.llm) } : {}),
    },
    reason: params.reason,
    entities: extractEntities(params.message),
    shouldUseRAG,
    shouldUseTools: rule?.shouldUseTools ?? preferredTools.length > 0,
    preferredTools,
    matchedSignals: params.matchedSignals.slice(0, 8),
    latencyMs: round1(params.latencyMs),
  };
}

function explainDecision(intent: LearningIntent, best: RuleScore, confidence: number): string {
  if (confidence < 0.35 && intent === FALLBACK_INTENT) {
    return '意图信号较弱，默认进入解释型导师回复。';
  }
  if (best.matchedSignals.length === 0) {
    return `未命中强规则，选择 ${intent} 作为默认学习意图。`;
  }
  return `命中 ${best.matchedSignals.length} 个学习信号，选择 ${intent}。`;
}

function extractEntities(message: string): LearningIntentResult['entities'] {
  const topics = new Set<string>();
  const quoted = message.match(/[“"']([^“"']{2,80})[”"']/g) || [];
  for (const item of quoted) {
    topics.add(item.replace(/[“”"']/g, '').trim());
  }

  const topicPatterns = [
    /(?:关于|围绕|学习|解释|讲一下|讲讲|复习|总结)([^，。！？\n]{2,40})/,
    /(?:what is|explain|review|summarize)\s+([^?.!,\n]{2,60})/i,
  ];
  for (const pattern of topicPatterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      topics.add(cleanTopic(match[1]));
    }
  }

  const countMatch = message.match(/(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*(?:个|道|张)?(?:题|闪卡|卡片|问题)/);
  const requestedCount = countMatch ? parseRequestedCount(countMatch[1]) : undefined;

  return {
    topics: [...topics].filter(Boolean).slice(0, 5),
    ...(requestedCount ? { requestedCount } : {}),
  };
}

function cleanTopic(value: string): string {
  return value
    .replace(/^(一下|一下子|这个|这段|一下关于)/, '')
    .replace(/(是什么|的原理|相关内容|这个知识点).*$/, '')
    .trim();
}

function parseRequestedCount(value: string): number | undefined {
  const digits = Number(value);
  if (Number.isFinite(digits) && digits > 0) {
    return digits;
  }
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return map[value];
}

function normalizeLLMCandidate(raw: string | LLMIntentCandidate): LLMIntentCandidate | null {
  if (typeof raw !== 'string') {
    return isLearningIntent(raw.intent) ? raw : null;
  }

  const parsed = safeParseJson(raw);
  if (!parsed || !isLearningIntent(parsed.intent)) {
    return null;
  }

  return {
    intent: parsed.intent,
    confidence: Number(parsed.confidence) || 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
  };
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isLearningIntent(value: unknown): value is LearningIntent {
  return typeof value === 'string' && INTENT_PRIORITY.includes(value as LearningIntent);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function elapsed(startedAt: number): number {
  return performanceNow() - startedAt;
}
