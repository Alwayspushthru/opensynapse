export type AIProviderId = 'gemini' | 'openai' | 'qwen' | 'deepseek' | 'zhipu';
export type AIProviderAuthMode = 'gemini_cli_oauth_or_api_key' | 'api_key';
export type AIModelLifecycle = 'stable' | 'preview';
export type AIProviderProtocol = 'gemini_native' | 'openai_compat' | 'openai_responses';

export interface AIProviderDefinition {
  id: AIProviderId;
  label: string;
  authMode: AIProviderAuthMode;
  protocol: AIProviderProtocol;
  apiKeyEnvVar: string;
  baseUrl?: string;
  baseUrlEnvVar?: string;
  modelEnvVar: string;
  defaultModel: string;
  docsUrl: string;
}

export interface AIModelOption {
  id: string;
  provider: AIProviderId;
  model: string;
  label: string;
  description: string;
  lifecycle: AIModelLifecycle;
  docsUrl: string;
  supportsVision?: boolean;
}

// Official API presets verified 2026-10-04. Model overrides contain no credentials.
export const AI_PROVIDERS: Record<AIProviderId, AIProviderDefinition> = {
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', authMode: 'api_key', protocol: 'openai_compat',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com',
    baseUrlEnvVar: 'DEEPSEEK_BASE_URL', modelEnvVar: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-flash',
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini', authMode: 'gemini_cli_oauth_or_api_key', protocol: 'gemini_native',
    apiKeyEnvVar: 'GEMINI_API_KEY', modelEnvVar: 'GEMINI_MODEL', defaultModel: 'gemini-3.8-flash',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
  },
  openai: {
    id: 'openai', label: 'GPT / OpenAI', authMode: 'api_key', protocol: 'openai_responses',
    apiKeyEnvVar: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1',
    baseUrlEnvVar: 'OPENAI_BASE_URL', modelEnvVar: 'OPENAI_MODEL', defaultModel: 'gpt-6.1-sol',
    docsUrl: 'https://developers.openai.com/api/docs/models',
  },
  qwen: {
    id: 'qwen', label: 'Qwen / 通义千问', authMode: 'api_key', protocol: 'openai_compat',
    apiKeyEnvVar: 'QWEN_API_KEY', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlEnvVar: 'QWEN_BASE_URL', modelEnvVar: 'QWEN_MODEL', defaultModel: 'qwen3.7-plus',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/models',
  },
  zhipu: {
    id: 'zhipu', label: 'GLM / 智谱', authMode: 'api_key', protocol: 'openai_compat',
    apiKeyEnvVar: 'ZHIPU_API_KEY', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    baseUrlEnvVar: 'ZHIPU_BASE_URL', modelEnvVar: 'ZHIPU_MODEL', defaultModel: 'glm-5.3',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3',
  },
};
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AIProviderId[];
export function isAIProviderId(value: string): value is AIProviderId {
  return Object.prototype.hasOwnProperty.call(AI_PROVIDERS, value);
}
export const PROVIDER_ENV_KEY = Object.fromEntries(AI_PROVIDER_IDS.map(id => [id, AI_PROVIDERS[id].apiKeyEnvVar])) as Record<AIProviderId, string>;
export const PROVIDER_BASE_URL_ENV_KEY = Object.fromEntries(AI_PROVIDER_IDS.map(id => [id, AI_PROVIDERS[id].baseUrlEnvVar])) as Partial<Record<AIProviderId, string>>;
export const PROVIDER_CONFIG_ENV_VARS = AI_PROVIDER_IDS.flatMap(id => {
  const p = AI_PROVIDERS[id];
  return [p.apiKeyEnvVar, ...(p.baseUrlEnvVar ? [p.baseUrlEnvVar] : []), p.modelEnvVar];
});

export const DEFAULT_TEXT_MODEL = 'deepseek/deepseek-flash';
export const DEFAULT_STRUCTURED_MODEL = DEFAULT_TEXT_MODEL;
export const DEFAULT_EMBEDDING_MODEL = 'zhipu/embedding-3';
export const TEXT_MODEL_STORAGE_KEY = 'opensynapse.preferred-text-model';
export const STRUCTURED_MODEL_STORAGE_KEY = 'opensynapse.preferred-structured-model';
export const EMBEDDING_MODEL_STORAGE_KEY = 'opensynapse.preferred-embedding-model';

export const AI_MODEL_OPTIONS: AIModelOption[] = AI_PROVIDER_IDS.map(id => {
  const provider = AI_PROVIDERS[id];
  return {
    id: `${id}/${provider.defaultModel}`, provider: id, model: provider.defaultModel,
    label: `${provider.label} · ${provider.defaultModel}`,
    description: id === 'deepseek' ? '默认聊天与知识提炼模型，官方 API 直连。' : '官方 API 直连，可在环境变量中更新模型。',
    lifecycle: 'stable', docsUrl: provider.docsUrl,
    supportsVision: ['gemini', 'openai', 'qwen', 'deepseek'].includes(id),
  };
});

export const EMBEDDING_MODEL_OPTIONS: AIModelOption[] = [
  { id: 'zhipu/embedding-3', provider: 'zhipu', model: 'embedding-3', label: '智谱 Embedding-3', description: '独立配置向量服务。', lifecycle: 'stable', docsUrl: AI_PROVIDERS.zhipu.docsUrl },
  { id: 'openai/text-embedding-3-small', provider: 'openai', model: 'text-embedding-3-small', label: 'OpenAI text-embedding-3-small', description: '独立配置向量服务。', lifecycle: 'stable', docsUrl: 'https://developers.openai.com/api/docs/guides/embeddings' },
];
export const MODEL_FALLBACKS: Record<string, string[]> = {};

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function inferProviderFromModelName(modelName: string): AIProviderId {
  if (modelName.startsWith('gemini-')) return 'gemini';
  if (modelName.startsWith('gpt-') || modelName.startsWith('text-embedding-')) return 'openai';
  if (/^glm-|^embedding-/i.test(modelName)) return 'zhipu';
  if (modelName.startsWith('qwen')) return 'qwen';
  if (modelName.startsWith('deepseek-')) return 'deepseek';
  throw new Error('无法识别模型厂商，请使用 厂商/模型 格式，例如 deepseek/deepseek-flash。');
}

export function parseModelSelection(value: string | null | undefined): { canonicalId: string; provider: AIProviderId; model: string } {
  const normalized = value?.trim() || DEFAULT_TEXT_MODEL;
  const slash = normalized.indexOf('/');
  const provider = slash >= 0 ? normalized.slice(0, slash) : inferProviderFromModelName(normalized);
  const model = slash >= 0 ? normalized.slice(slash + 1).trim() : normalized;
  if (!isAIProviderId(provider) || !model) throw new Error(`不支持的模型：${normalized}`);
  return { canonicalId: `${provider}/${model}`, provider, model };
}

// Only migrate stored preferences. Explicit invalid requests must fail instead of silently changing providers.
function readTextPreference(key: string, fallback: string): string {
  if (!canUseLocalStorage()) return fallback;
  const saved = window.localStorage.getItem(key);
  if (!saved) return fallback;
  try {
    const parsed = parseModelSelection(saved);
    // Historical built-in generations are retired; custom future model IDs stay usable.
    const retired = /^(gemini-2\.|gemini-3-flash-preview$|gemini-3\.1-pro-preview$|gpt-5|glm-(4|5$))/.test(parsed.model);
    if (!retired) return parsed.canonicalId;
  } catch { /* Removed provider. */ }
  window.localStorage.setItem(key, fallback);
  return fallback;
}

export function normalizeModelId(value: string | null | undefined): string {
  return parseModelSelection(value).canonicalId;
}

export function getApiModelId(value: string | null | undefined): string {
  const parsed = parseModelSelection(value);
  const provider = AI_PROVIDERS[parsed.provider];
  const override = typeof process !== 'undefined' ? process.env[provider.modelEnvVar]?.trim() : '';
  return parsed.model === provider.defaultModel && override ? override : parsed.model;
}

export function getProviderForModel(value: string | null | undefined): AIProviderDefinition {
  const parsed = parseModelSelection(value);
  return AI_PROVIDERS[parsed.provider];
}

export function getResolvedProviderConfig(value: string | null | undefined): AIProviderDefinition {
  const provider = getProviderForModel(value);
  const overrideBaseUrl = provider.baseUrlEnvVar && typeof process !== 'undefined' ? process.env[provider.baseUrlEnvVar]?.trim() : '';
  return {
    ...provider,
    baseUrl: overrideBaseUrl || provider.baseUrl,
  };
}

export function getPreferredTextModel(): string {
  return readTextPreference(TEXT_MODEL_STORAGE_KEY, DEFAULT_TEXT_MODEL);
}

export function getPreferredStructuredModel(): string {
  return readTextPreference(STRUCTURED_MODEL_STORAGE_KEY, DEFAULT_STRUCTURED_MODEL);
}

export function getPreferredEmbeddingModel(): string {
  if (!canUseLocalStorage()) {
    return DEFAULT_EMBEDDING_MODEL;
  }

  const saved = window.localStorage.getItem(EMBEDDING_MODEL_STORAGE_KEY);
  if (!saved) {
    return DEFAULT_EMBEDDING_MODEL;
  }

  let normalized: string;
  try { normalized = normalizeModelId(saved); } catch { return DEFAULT_EMBEDDING_MODEL; }
  return EMBEDDING_MODEL_OPTIONS.some((option) => option.id === normalized)
    ? normalized
    : DEFAULT_EMBEDDING_MODEL;
}

export function setPreferredTextModel(modelId: string): string {
  const normalized = normalizeModelId(modelId);
  if (canUseLocalStorage()) {
    window.localStorage.setItem(TEXT_MODEL_STORAGE_KEY, normalized);
  }
  return normalized;
}

export function setPreferredStructuredModel(modelId: string): string {
  const normalized = normalizeModelId(modelId);
  if (canUseLocalStorage()) {
    window.localStorage.setItem(STRUCTURED_MODEL_STORAGE_KEY, normalized);
  }
  return normalized;
}

export function setPreferredEmbeddingModel(modelId: string): string {
  const normalized = normalizeModelId(modelId);
  const safeValue = EMBEDDING_MODEL_OPTIONS.some((option) => option.id === normalized)
    ? normalized
    : DEFAULT_EMBEDDING_MODEL;

  if (canUseLocalStorage()) {
    window.localStorage.setItem(EMBEDDING_MODEL_STORAGE_KEY, safeValue);
  }
  return safeValue;
}

export function isKnownTextModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  return AI_MODEL_OPTIONS.some((option) => option.id === normalized);
}

export function getModelOption(modelId: string): AIModelOption | undefined {
  const normalized = normalizeModelId(modelId);
  return AI_MODEL_OPTIONS.find((option) => option.id === normalized);
}

export function getFallbackSelectionIds(modelId: string): string[] {
  const normalized = normalizeModelId(modelId);
  return MODEL_FALLBACKS[normalized] || [];
}

export function getFallbackModels(modelId: string): string[] {
  return getFallbackSelectionIds(modelId).map((selectionId) => getApiModelId(selectionId));
}

export function getProviderLabel(modelId: string): string {
  return getProviderForModel(modelId).label;
}
