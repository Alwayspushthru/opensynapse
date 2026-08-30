# Agent Loop 设计文档

> 日期：2026-05-31
> 状态：已确认

## 1. 目标

为 OpenSynapse 的 AI 对话添加 ReAct 风格的 Agent Loop，使 LLM 在对话中能自主决定是否调用内部工具（搜索笔记、创建闪卡等），实现「用户一句话 → Agent 自动拆解、检索、执行 → 返回综合结果」。

## 2. 核心决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 触发方式 | 自动模式 | 用户无需学习新命令，LLM 自主判断 |
| 工具范围 | 全部 8 个 | 搜索/创建/更新/导入/复习全覆盖 |
| 安全边界 | 宽松：10 轮迭代，全自动，无 token 限制 | 最大化能力，后续可按需收紧 |
| UI 展示 | 摘要模式 | 显示关键步骤，不暴露原始 JSON |
| 架构方案 | 混合模式（C） | 服务端执行 ReAct 循环，SSE 推送中间状态 |

## 3. 架构

### 3.1 核心流程

```
用户发送消息
    ↓
POST /api/ai/agent（新端点）
    ↓
构建上下文（历史消息 + System Prompt + Tools Schema）
    ↓
调用 LLM（providerGateway）
    ↓
┌─ 响应有 tool_calls？
│   ├─ YES → 解析 → 执行内部工具
│   │         → SSE: { type: "agent_step", summary: "..." }
│   │         → 追加工具结果到上下文
│   │         → 再次调用 LLM（≤10 次）
│   │         → 回到 ─┐
│   └─ NO → SSE: { type: "agent_done", steps, iterations }
│            SSE: { type: "text", content: "最终回复" }
└──────────────────────────────────────────────
```

### 3.2 内部工具

| 工具 | 输入 | 执行 | 输出 |
|------|------|------|------|
| `search_notes` | `{ query, limit? }` | Chroma 语义搜索 | 笔记标题+摘要列表 |
| `get_note_detail` | `{ noteId }` | PostgreSQL 查询 | 完整笔记内容 |
| `create_note` | `{ title, content, tags? }` | 写 notes 表 + Chroma | 新笔记 ID |
| `update_note` | `{ noteId, title?, content?, tags? }` | 更新 notes 表 + Chroma | 成功/失败 |
| `create_flashcard` | `{ noteId, question, answer }` | maimemo.initializeCard + 写 flashcards 表 | 新卡片 ID |
| `get_review_cards` | `{ limit? }` | 查 nextReview <= now | 待复习卡片列表 |
| `import_content` | `{ content, format? }` | universalImportParser | 导入的会话数 |
| `search_web` | `{ query }` | 基于笔记回答（降级） | 搜索结果摘要 |

所有工具通过 `requireAuth` 获取 `userId`，只操作该用户数据。

### 3.3 多协议 Tool Call 解析

| Provider | 格式 | 解析 |
|----------|------|------|
| Gemini | `parts[].functionCall` | `{ name, args }` |
| OpenAI Compat | `choices[0].message.tool_calls[]` | `{ id, function.name, function.arguments }` |
| Anthropic Compat | `content[].type === "tool_use"` | `{ id, name, input }` |
| Codex | `output[].type === "function_call"` | `{ name, arguments }` |

统一抽象为：

```typescript
type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};
```

### 3.4 SSE 协议扩展

现有事件不变（`{ text }`, `{ thought }`），新增：

```
data: { "type": "agent_step", "summary": "搜索了笔记 → 找到 3 条关于 React 的内容" }
data: { "type": "agent_done", "steps": ["搜索了笔记", "获取了笔记详情"], "iterations": 3 }
```

## 4. 文件结构

```
src/agent/
├── types.ts          # [不变] 已有类型定义
├── toolExecutor.ts   # [新增] 8 个工具执行函数 + TOOL_REGISTRY
├── agentLoop.ts      # [新增] ReAct 循环引擎
└── toolSchemas.ts    # [新增] 工具 JSON Schema（给 LLM）

src/lib/
└── providerGateway.ts # [修改] 增加统一 tool_call 解析

src/api/
└── ai.ts             # [修改] 新增 POST /agent 路由

src/components/
└── ChatView.tsx       # [修改] 处理 agent_step / agent_done 事件
```

## 5. agentLoop.ts 核心逻辑

```typescript
export async function* runAgentLoop(
  params: AgentLoopParams
): AsyncGenerator<AgentSSEvent> {
  const { userId, messages, tools, model, maxIterations = 10 } = params;
  const steps: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const response = await callLLMWithTools(messages, tools, model);

    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const call of response.toolCalls) {
        const result = await TOOL_REGISTRY[call.name](call.arguments, { userId });
        steps.push(result.summary);
        yield { type: "agent_step", summary: result.summary };
        messages.push({ role: "model", toolCall: call });
        messages.push({ role: "tool", toolResult: result.data });
      }
    } else {
      if (steps.length > 0) {
        yield { type: "agent_done", steps, iterations: i + 1 };
      }
      yield { type: "text", content: response.text };
      return;
    }
  }

  yield { type: "agent_done", steps, iterations: maxIterations };
  yield { type: "text", content: "已达到最大思考轮次，以上是目前的结果。" };
}
```

## 6. 前端改动

ChatView 的 SSE 解析循环中新增两个分支：

```typescript
if (payload.type === "agent_step") appendAgentStep(payload.summary);
if (payload.type === "agent_done") setAgentSteps(payload.steps);
```

`appendAgentStep` 渲染为摘要气泡，用 `motion` 渐入动画。

## 7. 安全

- 所有工具执行通过 `requireAuth` 获取 `userId`，数据隔离
- 工具执行函数是纯 TypeScript，不走 HTTP
- Agent Loop 在服务端执行，前端无法伪造工具调用
- 最大 10 轮迭代防止死循环
