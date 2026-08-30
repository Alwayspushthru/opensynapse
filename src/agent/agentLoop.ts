// src/agent/agentLoop.ts

import { TOOL_REGISTRY, type ToolRunContext, type ToolOutput } from './toolExecutor.js';
import { toOpenAITools, toGeminiTools } from './toolSchemas.js';
import { generateContentWithTools, type ToolDefinitionInput } from '../lib/providerGateway.js';
import { parseModelSelection } from '../lib/aiModels.js';
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

type AgentMessage =
  | { role: 'user' | 'model'; parts: Array<Record<string, any>> }
  | { role: 'tool'; toolCallId: string; name: string; parts: Array<{ text: string }> };

const MAX_ITERATIONS = 10;
const HEARTBEAT_INTERVAL_MS = 15_000;

export async function* runAgentLoop(
  params: AgentLoopParams
): AsyncGenerator<AgentSSEvent> {
  const { userId, model, systemInstruction, maxIterations = MAX_ITERATIONS, geminiApiKey } = params;
  const steps: string[] = [];
  const parsed = parseModelSelection(model);
  const toolCtx: ToolRunContext = { userId };

  const contextMessages: AgentMessage[] = params.messages.map(m => ({
    role: m.role as 'user' | 'model',
    parts: m.parts,
  }));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    try {
      const result = await callLLMWithTools({
        model: parsed,
        messages: contextMessages,
        systemInstruction,
        geminiApiKey,
      });

      if (result.thought) {
        yield { type: 'thought', content: result.thought };
      }

      if (result.toolCalls.length === 0) {
        if (steps.length > 0) {
          yield { type: 'agent_done', steps, iterations: iteration + 1 };
        }
        if (result.text) {
          yield { type: 'text', content: result.text };
        }
        return;
      }

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

  const contents: any[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
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
      const entry: any = { role: msg.role === 'model' ? 'model' : 'user', parts: msg.parts };
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
