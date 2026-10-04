# 五家官方模型接入

配置核对日期：2026-10-04。预置模型只有五个，厂商注册表集中在 `src/lib/aiModels.ts`。模型文档可用不等于账户有访问额度；上线前需使用自己的 Key 测试。

## DeepSeek 本地调试

保留现有数据库、认证配置，在 `.env.local` 填写：

```dotenv
DEEPSEEK_API_KEY=你的官方密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

运行 `npm run dev`（即 `tsx watch server.ts`）。服务端代码变更会自动重启，但**手动编辑 `.env.local` 不会自动重载**：改完请在运行 `npm run dev` 的终端里按一下回车触发重启。只刷新浏览器不会更新旧后端路由。若从旧版 `tsx server.ts` 启动，需先结束旧服务再运行新命令。

在设置页保存的全局 Key 会立即生效（服务端会同时更新内存中的配置），无需重启；只有手改 `.env.local` 才需要按回车。默认聊天、文本知识提炼和 CLI 均使用 DeepSeek；无需配置其余四家。设置中保存的个人 Key 优先于环境变量，因此调试全局 Key 时应清空已有的同厂商个人 Key。

厂商 API Key 不通过 Vite 注入浏览器构建。`.env.local` 与 `.env copy.example` 为 Git 忽略的本地文件，仓库分发模板是 `.env.example`。

## 厂商与协议

| 厂商 | 默认裸模型 ID | 地址 | 接口 |
| --- | --- | --- | --- |
| DeepSeek | `deepseek-flash` | `https://api.deepseek.com` | `/chat/completions` |
| Gemini | `gemini-3.8-flash` | Google GenAI SDK | 原生 generateContent |
| OpenAI | `gpt-6.1-sol` | `https://api.openai.com/v1` | `/responses` |
| Qwen | `qwen3.7-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `/chat/completions` |
| 智谱 | `glm-5.3` | `https://open.bigmodel.cn/api/paas/v4` | `/chat/completions` |

Qwen 默认北京兼容地址仍可使用；官方推荐业务空间专属地址，如 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。其他地域应使用对应 Base URL 和该地域 Key。智谱不要填 `/api/anthropic` 或 Coding Plan 专用地址。

每个厂商可通过 `<PROVIDER>_MODEL` 覆盖预置选项发送到上游的模型 ID，智谱变量前缀是 `ZHIPU`。该覆盖在服务端解析，菜单仍显示预置名称；若需要明确显示其他型号，请在聊天菜单选择自定义并填写 `provider/model`。自定义 ID 不做有效性猜测，上游无权限或不存在时直接报错。

DeepSeek 启用思考，强度 `high`；GLM-5.3 按官方要求始终启用思考，默认 `low`；Qwen 关闭思考以兼容非流式提炼。GPT 使用 Responses 推理与思考摘要事件。结构化提炼同时发送 JSON 输出约束与 schema/JSON 提示。

预置 DeepSeek、Gemini、GPT、Qwen 支持图片传入，GLM 文本模型沿用同厂商 OCR。自定义模型的图片能力不推断。修改预置模型覆盖时应选择能力兼容的型号。

## 迁移与 Embedding

MiniMax、Moonshot、NVIDIA、OpenRouter 不再出现在设置、密钥 API 或运行时厂商列表中；专用 MiniMax 图片接口已移除。旧浏览器模型偏好重置为 DeepSeek，历史会话原始模型名称与数据库中的旧密钥保留。没有跨厂商自动回退。

Embedding 默认保留 `zhipu/embedding-3`，另提供 `openai/text-embedding-3-small`。只配置 DeepSeek 时，没有向量 Key 的语义功能会降级。不要把 DeepSeek 聊天模型当作 Embedding 模型。更换向量模型后需重新提炼/生成旧笔记的向量；当前不会自动重建向量库。

Gemini CLI OAuth 保留为兼容路径，最新官方模型不保证在 Code Assist 可调用。当前 GPT 接入只使用 API Key，历史 OAuth 工具不参与模型网关。

## 验证

```bash
npm run test:providers
npm run lint
npm run build
```

契约测试使用模拟上游，不消耗 API 额度。真实验收需在填写 DeepSeek Key 后检查：流式对话及思考显示、停止后再发送、重新生成、图片输入、笔记/闪卡提炼、Agent 工具调用，以及缺少 Embedding Key 时普通聊天仍可使用。

如果完整类型检查报告 `scripts/migrate-firestore-to-postgres.ts` 无法找到 `firebase-admin/app` 或 `firebase-admin/firestore`，这是历史迁移脚本的可选依赖未安装；本次接入不使用 Firebase，也不为此重新引入该依赖。

## 官方来源

- [DeepSeek API 与模型](https://api-docs.deepseek.com/zh-cn/)
- [DeepSeek 图片输入](https://api-docs.deepseek.com/guides/vision/)
- [Gemini 模型目录](https://ai.google.dev/gemini-api/docs/models)
- [OpenAI GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [百炼模型目录](https://help.aliyun.com/zh/model-studio/models)
- [百炼 OpenAI 兼容地址](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)
- [GLM-5.3 参数与接口](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)
