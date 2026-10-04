import {
  getApiModelId,
  getResolvedProviderConfig,
  parseModelSelection,
} from './aiModels.js';
export type GatewayParams = {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type GatewayTextResult = {
  text: string;
  raw: unknown;
};

export type GatewayStreamChunk = {
  text?: string;
  thought?: string;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

export type ToolsGatewayResult = {
  text: string;
  toolCalls: ToolCallRequest[];
  thought?: string;
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

type OpenAITextBlock = { type: 'text'; text: string };
type OpenAIImageBlock = { type: 'image_url'; image_url: { url: string } };
type OpenAIContentBlock = OpenAITextBlock | OpenAIImageBlock;

function getRequiredApiKey(modelId: string): { provider: string; envVar: string; apiKey: string } {
  const provider = getResolvedProviderConfig(modelId);
  const envVar = provider.apiKeyEnvVar;
  const apiKey = envVar ? process.env[envVar]?.trim() : '';

  if (!envVar || !apiKey) {
    throw new Error(`当前模型需要配置 ${envVar || 'API Key'}。请在设置页或 .env.local 中设置后重启服务。`);
  }

  return { provider: provider.label, envVar, apiKey };
}

function toGeminiContentsArray(contents: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(contents)) {
    return contents as Array<Record<string, unknown>>;
  }

  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }

  if (contents && typeof contents === 'object' && 'parts' in (contents as Record<string, unknown>)) {
    return [contents as Record<string, unknown>];
  }

  return [{ role: 'user', parts: [{ text: String(contents ?? '') }] }];
}

function toOpenAIContent(parts: unknown[]): string | OpenAIContentBlock[] {
  const blocks: OpenAIContentBlock[] = (parts || [])
    .filter(Boolean)
    .flatMap<OpenAIContentBlock>((part) => {
      if (typeof part === 'string') {
        return [{ type: 'text', text: part }];
      }

      if (!part || typeof part !== 'object') {
        return [{ type: 'text', text: String(part ?? '') }];
      }

      const typedPart = part as Record<string, unknown>;
      if (typeof typedPart.text === 'string') {
        return [{ type: 'text', text: typedPart.text }];
      }

      if (typedPart.inlineData && typeof typedPart.inlineData === 'object') {
        const inlineData = typedPart.inlineData as Record<string, string>;
        const mimeType = inlineData.mimeType;
        const data = inlineData.data;
        if (mimeType && data) {
          return [{
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${data}`,
            },
          }];
        }
      }

      return [];
    });

  if (blocks.length === 0) return '';
  if (blocks.length === 1 && blocks[0].type === 'text') {
    return blocks[0].text;
  }

  return blocks;
}

function appendJsonInstruction(baseInstruction: string, responseSchema?: unknown): string {
  if (responseSchema && typeof responseSchema === 'object') {
    return `${baseInstruction}\n\n请仅输出一个合法 JSON 对象，并严格符合以下 schema：\n${JSON.stringify(responseSchema, null, 2)}`;
  }
  return `${baseInstruction}\n\n请仅输出一个合法 JSON 对象，不要添加额外解释。`;
}

// 将 Google GenAI Type 枚举转换为标准 JSON Schema 类型
// Google GenAI 使用 Type.OBJECT, Type.STRING 等枚举，而 OpenAI 兼容 API 需要 "object", "string" 等字符串
function convertGoogleGenAISchemaToStandard(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item => convertGoogleGenAISchemaToStandard(item));
  }

  const result: Record<string, unknown> = {};
  const typedSchema = schema as Record<string, unknown>;

  for (const [key, value] of Object.entries(typedSchema)) {
    if (key === 'type' && typeof value === 'string') {
      result[key] = value.toLowerCase();
    } else if (key === 'type' && typeof value === 'number') {
      // Google GenAI Type 枚举值转换为标准 JSON Schema 类型字符串
      // Type.OBJECT = 1, Type.STRING = 2, Type.ARRAY = 3, etc.
      const typeMapping: Record<number, string> = {
        1: 'object',
        2: 'string',
        3: 'array',
        4: 'number',
        5: 'integer',
        6: 'boolean',
        7: 'null',
      };
      result[key] = typeMapping[value] ?? 'string';
    } else if (key === 'items' || key === 'properties' || key === 'additionalProperties') {
      result[key] = convertGoogleGenAISchemaToStandard(value);
    } else if (key === 'required' && Array.isArray(value)) {
      result[key] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}


function toMessages(params: GatewayParams): any[] {
  const messages: any[] = [];
  let system = typeof params.config?.systemInstruction === 'string' ? params.config.systemInstruction : '';
  if (params.config?.responseMimeType === 'application/json') {
    system = appendJsonInstruction(system, convertGoogleGenAISchemaToStandard(params.config.responseSchema));
  }
  if (system) messages.push({ role: 'system', content: system });
  for (const item of toGeminiContentsArray(params.contents)) {
    const parts = Array.isArray(item.parts) ? item.parts : [];
    const role = item.role === 'model' ? 'assistant' : item.role || 'user';
    const message: any = { role, content: toOpenAIContent(parts) };
    if (role === 'tool') message.tool_call_id = item.toolCallId;
    const calls = parts.filter((p: any) => p.functionCall).map((p: any) => ({
      id: p.functionCall.id, type: 'function',
      function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
    }));
    if (calls.length) message.tool_calls = calls;
    if (typeof item.reasoningContent === 'string') message.reasoning_content = item.reasoningContent;
    messages.push(message);
  }
  return messages;
}

function chatBody(params: GatewayParams): Record<string, unknown> {
  const { provider } = parseModelSelection(params.model);
  const body: Record<string, unknown> = { model: getApiModelId(params.model), messages: toMessages(params) };
  const config = params.config || {};
  if (typeof config.maxOutputTokens === 'number') body.max_tokens = config.maxOutputTokens;
  if (config.responseMimeType === 'application/json') body.response_format = { type: 'json_object' };
  if (provider === 'deepseek') {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = 'high';
  } else if (provider === 'zhipu') {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = 'low';
  } else if (provider === 'qwen') {
    // Non-thinking supports both ordinary and structured non-streaming requests.
    body.enable_thinking = false;
  }
  // Reasoning providers do not necessarily accept sampling parameters.
  if (provider === 'qwen') {
    if (typeof config.temperature === 'number') body.temperature = config.temperature;
    if (typeof config.topP === 'number') body.top_p = config.topP;
  }
  return body;
}

function responsesBody(params: GatewayParams): Record<string, unknown> {
  const input: any[] = [];
  for (const message of toMessages(params)) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id,
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) });
      continue;
    }
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (blocks.length) input.push({ role: message.role, content: blocks.map((block: any) => block.type === 'image_url'
      ? { type: 'input_image', image_url: block.image_url.url }
      : { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: block.text }) });
    for (const call of message.tool_calls || []) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
  }
  const body: Record<string, unknown> = {
    model: getApiModelId(params.model), input, store: false,
    reasoning: { effort: 'low', summary: 'auto' },
  };
  if (typeof params.config?.maxOutputTokens === 'number') body.max_output_tokens = params.config.maxOutputTokens;
  if (params.config?.responseMimeType === 'application/json') body.text = { format: { type: 'json_object' } };
  return body;
}

function endpoint(model: string, path: string): string {
  const provider = getResolvedProviderConfig(model);
  if (!provider.baseUrl) throw new Error(`${provider.label} 未配置 API 基础地址。`);
  return `${provider.baseUrl.replace(/\/+$/, '')}/${path}`;
}

function apiError(status: number, payload: any): Error {
  const hint = status === 401 || status === 403 ? '认证失败，请检查 API Key 与访问权限'
    : status === 402 ? '余额不足' : status === 404 ? '模型或接口不存在'
    : status === 429 ? '请求限流或额度不足' : status >= 500 ? '上游服务暂时不可用' : '模型请求失败';
  const detail = typeof payload?.error?.message === 'string' ? payload.error.message : '';
  return new Error(`${status} ${hint}${detail ? `：${detail}` : ''}`);
}

async function request(params: GatewayParams, body: Record<string, unknown>, path: string): Promise<Response> {
  const { apiKey } = getRequiredApiKey(params.model);
  const response = await fetch(endpoint(params.model, path), {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: params.signal,
  });
  if (!response.ok) throw apiError(response.status, await response.json().catch(() => null));
  return response;
}

function isResponses(model: string): boolean {
  return getResolvedProviderConfig(model).protocol === 'openai_responses';
}

function extractText(payload: any, responses: boolean): string {
  if (responses) return (payload.output || []).flatMap((item: any) => item.content || [])
    .filter((item: any) => item.type === 'output_text').map((item: any) => item.text || '').join('');
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p.text || '').join('') : '';
}

function checkPayload(payload: any): void {
  if (payload.error || payload.type === 'error' || payload.type === 'response.failed') {
    throw new Error(payload.error?.message || payload.response?.error?.message || payload.message || '上游流式请求失败');
  }
  if (payload.status === 'incomplete' || payload.type === 'response.incomplete' || payload.choices?.[0]?.finish_reason === 'length') {
    throw new Error('模型输出达到长度限制，请缩短输入或提高输出上限后重试。');
  }
}

export async function generateContentWithApiKeyProvider(params: GatewayParams): Promise<GatewayTextResult> {
  const responses = isResponses(params.model);
  const response = await request(params, responses ? responsesBody(params) : chatBody(params), responses ? 'responses' : 'chat/completions');
  const raw = await response.json();
  checkPayload(raw);
  return { text: extractText(raw, responses), raw };
}

// Parse complete SSE events, including split UTF-8 chunks, CRLF and final frames without a trailing newline.
async function* readEvents(response: Response): AsyncGenerator<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('上游未返回可读流。');
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const parse = () => {
    const value = data.join('\n'); data = [];
    return value === '[DONE]' ? '[DONE]' : value ? JSON.parse(value) : null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer && !buffer.endsWith('\n')) buffer += '\n';
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        if (!line) { const event = parse(); if (event === '[DONE]') return; if (event) yield event; }
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (done) { const event = parse(); if (event === '[DONE]') return; if (event) yield event; break; }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* generateContentStreamWithApiKeyProvider(params: GatewayParams): AsyncGenerator<GatewayStreamChunk> {
  const responses = isResponses(params.model);
  const body = responses ? responsesBody(params) : chatBody(params);
  const response = await request(params, { ...body, stream: true }, responses ? 'responses' : 'chat/completions');
  let emittedText = false;
  for await (const payload of readEvents(response)) {
    checkPayload(payload);
    if (responses) {
      if (payload.type === 'response.output_text.delta' && payload.delta) { emittedText = true; yield { text: payload.delta }; }
      if (payload.type === 'response.reasoning_summary_text.delta' && payload.delta) yield { thought: payload.delta };
      if (payload.type === 'response.completed' && !emittedText) {
        const text = extractText(payload.response, true); if (text) yield { text };
      }
    } else {
      const delta = payload.choices?.[0]?.delta;
      if (delta?.reasoning_content) yield { thought: delta.reasoning_content };
      if (typeof delta?.content === 'string' && delta.content) yield { text: delta.content };
    }
  }
}

export async function generateContentWithTools(params: GatewayParams & { tools?: ToolDefinitionInput[] }): Promise<ToolsGatewayResult> {
  const responses = isResponses(params.model);
  const body = responses ? responsesBody(params) : chatBody(params);
  if (params.tools?.length) {
    body.tools = responses ? params.tools.map(t => ({ type: 'function', ...t.function, strict: false })) : params.tools;
    body.tool_choice = 'auto';
  }
  const response = await request(params, body, responses ? 'responses' : 'chat/completions');
  const raw = await response.json();
  checkPayload(raw);
  const calls = responses ? (raw.output || []).filter((item: any) => item.type === 'function_call') : raw.choices?.[0]?.message?.tool_calls || [];
  const toolCalls = calls.map((call: any) => ({
    id: responses ? call.call_id : call.id,
    name: responses ? call.name : call.function.name,
    arguments: JSON.parse((responses ? call.arguments : call.function.arguments) || '{}'),
  }));
  return { text: extractText(raw, responses), thought: raw.choices?.[0]?.message?.reasoning_content || '', toolCalls, raw };
}

export type EmbedContentResult = { embeddings: Array<{ values: number[] }> };
export async function embedContentWithApiKeyProvider(params: { model: string; contents: string[] }): Promise<EmbedContentResult> {
  const { provider } = parseModelSelection(params.model);
  if (provider !== 'openai' && provider !== 'zhipu' && provider !== 'qwen') throw new Error('当前厂商未配置 Embedding 接口。');
  const response = await request({ ...params, contents: params.contents }, { model: getApiModelId(params.model), input: params.contents }, 'embeddings');
  const payload = await response.json();
  if (!Array.isArray(payload.data) || !payload.data.length) throw new Error('Embedding 响应未返回有效向量。');
  return { embeddings: payload.data.map((item: any) => ({ values: item.embedding || [] })) };
}
