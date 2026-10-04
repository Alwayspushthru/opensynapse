import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { generateContentWithApiKeyProvider, generateContentStreamWithApiKeyProvider, generateContentWithTools, embedContentWithApiKeyProvider } from '../src/lib/providerGateway.ts';
import { AI_PROVIDER_IDS, DEFAULT_TEXT_MODEL, getApiModelId, getPreferredTextModel, getPreferredStructuredModel, parseModelSelection } from '../src/lib/aiModels.ts';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  delete (globalThis as any).window;
});
function fakeApi(handler: (url: string, init: RequestInit, body: any) => Response | Promise<Response>) {
  for (const provider of ['DEEPSEEK', 'QWEN', 'OPENAI', 'ZHIPU']) {
    process.env[`${provider}_API_KEY`] = 'test-key';
    delete process.env[`${provider}_BASE_URL`];
    delete process.env[`${provider}_MODEL`];
  }
  globalThis.fetch = (async (url: any, init: RequestInit) => handler(String(url), init, JSON.parse(String(init.body)))) as typeof fetch;
}
const completion = (text = 'ok') => Response.json({ choices: [{ message: { content: text } }] });

test('only five official providers; invalid explicit requests do not silently route to Gemini', () => {
  assert.deepEqual([...AI_PROVIDER_IDS].sort(), ['deepseek', 'gemini', 'openai', 'qwen', 'zhipu']);
  assert.equal(parseModelSelection(null).canonicalId, DEFAULT_TEXT_MODEL);
  assert.equal(parseModelSelection('deepseek-flash').provider, 'deepseek');
  for (const value of ['moonshot/kimi-for-coding', 'nvidia/deepseek-ai/x', 'garbage', 'toString/x']) {
    assert.throws(() => parseModelSelection(value));
  }
});

test('stored retired selections migrate; current custom models survive', () => {
  const values = new Map([['opensynapse.preferred-text-model', 'moonshot/kimi-for-coding'], ['opensynapse.preferred-structured-model', 'openai/gpt-5.4']]);
  (globalThis as any).window = { localStorage: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) } };
  assert.equal(getPreferredTextModel(), DEFAULT_TEXT_MODEL);
  assert.equal(getPreferredStructuredModel(), DEFAULT_TEXT_MODEL);
  values.set('opensynapse.preferred-text-model', 'qwen/qwen3.8-max');
  assert.equal(getPreferredTextModel(), 'qwen/qwen3.8-max');
});

test('DeepSeek JSON extraction sends normalized schema, reasoning settings and official auth', async () => {
  fakeApi((url, init, body) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal((init.headers as any).Authorization, 'Bearer test-key');
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.match(body.messages[0].content, /"type": "object"/);
    assert.equal(body.thinking.type, 'enabled');
    assert.equal(body.temperature, undefined);
    return completion('{"notes":[]}');
  });
  const result = await generateContentWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: '整理笔记', config: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { notes: { type: 'ARRAY', items: { type: 'STRING' } } } } } });
  assert.deepEqual(JSON.parse(result.text), { notes: [] });
});

test('configured model and URL are used without changing explicit custom or embedding IDs', async () => {
  fakeApi((url, _init, body) => {
    assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(body.model, 'deepseek-v4-pro');
    return completion();
  });
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1/';
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';
  process.env.OPENAI_MODEL = 'gpt-custom';
  assert.equal(getApiModelId('deepseek/custom'), 'custom');
  assert.equal(getApiModelId('openai/text-embedding-3-small'), 'text-embedding-3-small');
  await generateContentWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: 'hi' });
});

test('DeepSeek accepts inline image content without MiniMax/OCR calls', async () => {
  fakeApi((_url, _init, body) => {
    assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,YQ==');
    return completion();
  });
  await generateContentWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: [{ role: 'user', parts: [{ text: '图片' }, { inlineData: { mimeType: 'image/png', data: 'YQ==' } }] }] });
});

test('streaming survives fragmented UTF-8/CRLF and an unterminated last SSE event', async () => {
  let cancelled = false;
  fakeApi(() => {
    const bytes = new TextEncoder().encode('data:{"choices":[{"delta":{"reasoning_content":"思考"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}');
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); }, cancel() { cancelled = true; } }));
  });
  const chunks = [];
  for await (const chunk of generateContentStreamWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: 'hi' })) chunks.push(chunk);
  assert.deepEqual(chunks, [{ thought: '思考' }, { text: '你好' }]);
});

test('stream errors are surfaced after partial output instead of appearing successful', async () => {
  fakeApi(() => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"quota exhausted"}}\n\n'));
  await assert.rejects(async () => {
    for await (const _ of generateContentStreamWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: 'hi' })) { /* consume */ }
  }, /quota exhausted/);
});

test('stopping consumption cancels the upstream response', async () => {
  let cancelled = false;
  fakeApi(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')); }, cancel() { cancelled = true; } })));
  for await (const _ of generateContentStreamWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: 'hi' })) break;
  assert.equal(cancelled, true);
});

test('request cancellation signal reaches fetch', async () => {
  const controller = new AbortController();
  fakeApi((_url, init) => { assert.equal(init.signal, controller.signal); return completion(); });
  await generateContentWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: 'hi', signal: controller.signal });
});

test('DeepSeek tool history retains call IDs and reasoning for follow-up turns', async () => {
  fakeApi((_url, _init, body) => {
    assert.equal(body.messages[0].tool_calls[0].id, 'call-1');
    assert.equal(body.messages[0].reasoning_content, 'reason');
    assert.equal(body.messages[1].tool_call_id, 'call-1');
    return Response.json({ choices: [{ message: { content: '', reasoning_content: 'next', tool_calls: [{ id: 'call-2', function: { name: 'search', arguments: '{"query":"test"}' } }] } }] });
  });
  const result = await generateContentWithTools({ model: DEFAULT_TEXT_MODEL, contents: [{ role: 'model', reasoningContent: 'reason', parts: [{ functionCall: { id: 'call-1', name: 'search', args: {} } }] }, { role: 'tool', toolCallId: 'call-1', parts: [{ text: 'result' }] }] });
  assert.equal(result.thought, 'next');
  assert.deepEqual(result.toolCalls, [{ id: 'call-2', name: 'search', arguments: { query: 'test' } }]);
});

test('OpenAI uses Responses with assistant output_text and function-call output', async () => {
  fakeApi((url, _init, body) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(body.input[0].content[0].type, 'output_text');
    assert.equal(body.input[1].type, 'function_call');
    assert.equal(body.input[2].type, 'function_call_output');
    assert.equal(body.input[2].call_id, 'c1');
    assert.equal(body.tools[0].name, 'search');
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] });
  });
  const result = await generateContentWithTools({ model: 'openai/gpt-6.1-sol', contents: [{ role: 'model', parts: [{ text: 'checking' }, { functionCall: { id: 'c1', name: 'search', args: {} } }] }, { role: 'tool', toolCallId: 'c1', parts: [{ text: 'result' }] }], tools: [{ type: 'function', function: { name: 'search', description: 'search', parameters: { type: 'object', properties: {} } } }] });
  assert.equal(result.text, 'done');
});

test('Responses streaming separates reasoning summary and text', async () => {
  fakeApi(() => new Response('data: {"type":"response.reasoning_summary_text.delta","delta":"summary"}\n\ndata: {"type":"response.output_text.delta","delta":"answer"}\n\ndata: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"answer"}]}]}}\n\n'));
  const chunks = [];
  for await (const chunk of generateContentStreamWithApiKeyProvider({ model: 'openai/gpt-6.1-sol', contents: 'hi' })) chunks.push(chunk);
  assert.deepEqual(chunks, [{ thought: 'summary' }, { text: 'answer' }]);
});

test('Qwen and GLM have distinct official endpoints and thinking parameters', async () => {
  fakeApi((url, _init, body) => {
    if (body.model === 'qwen3.7-plus') {
      assert.equal(url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
      assert.equal(body.enable_thinking, false);
    } else {
      assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
      assert.equal(body.thinking.type, 'enabled');
      assert.equal(body.reasoning_effort, 'low');
    }
    return completion();
  });
  for (const model of ['qwen/qwen3.7-plus', 'zhipu/glm-5.3']) await generateContentWithApiKeyProvider({ model, contents: 'hi' });
});

test('HTTP failures distinguish auth, balance, model and limits', async () => {
  for (const [status, expected] of [[401, /认证失败/], [402, /余额不足/], [404, /模型或接口不存在/], [429, /请求限流/]] as const) {
    fakeApi(() => Response.json({ error: { message: 'upstream detail' } }, { status }));
    await assert.rejects(generateContentWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: 'hi' }), expected);
  }
});

test('embedding remains independent and never uses DeepSeek chat endpoint', async () => {
  fakeApi((url, _init, body) => {
    assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/embeddings');
    assert.equal(body.model, 'embedding-3');
    return Response.json({ data: [{ embedding: [1, 2] }] });
  });
  assert.deepEqual(await embedContentWithApiKeyProvider({ model: 'zhipu/embedding-3', contents: ['hi'] }), { embeddings: [{ values: [1, 2] }] });
  await assert.rejects(embedContentWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: ['hi'] }), /Embedding/);
});

test('DONE terminates and cancels an upstream stream that remains open', async () => {
  let cancelled = false;
  fakeApi(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); }, cancel() { cancelled = true; } })));
  const chunks = [];
  for await (const chunk of generateContentStreamWithApiKeyProvider({ model: DEFAULT_TEXT_MODEL, contents: 'hi' })) chunks.push(chunk);
  assert.deepEqual(chunks, []);
  assert.equal(cancelled, true);
});
