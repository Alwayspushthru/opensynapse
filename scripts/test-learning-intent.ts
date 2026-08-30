import { recognizeLearningIntent, type LearningIntent } from '../src/agent/learningIntentRecognizer.js';

const cases: Array<{ input: string; expected: LearningIntent }> = [
  { input: '帮我解释一下闭包是什么', expected: 'explain' },
  { input: '给我举一个 useEffect 的例子', expected: 'ask_example' },
  { input: '这段代码一直报错，帮我 debug', expected: 'solve_problem' },
  { input: '给我出几道题测一下', expected: 'quiz' },
  { input: '今天有哪些卡片要复习', expected: 'review' },
  { input: '把这段对话整理成笔记', expected: 'extract_note' },
  { input: '帮我生成 3 张关于闭包的闪卡', expected: 'generate_flashcards' },
  { input: '这个知识点和之前哪个笔记有关', expected: 'connect_knowledge' },
  { input: '帮我规划一下 React 学习路线', expected: 'plan_learning_path' },
  { input: '你好', expected: 'casual_chat' },
];

let passed = 0;

for (const item of cases) {
  const result = recognizeLearningIntent(item.input);
  const ok = result.intent === item.expected;
  if (ok) {
    passed += 1;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${item.input}`);
  console.log(`  expected=${item.expected} actual=${result.intent} confidence=${result.confidence}`);
  console.log(`  reason=${result.reason}`);
}

const accuracy = passed / cases.length;
console.log(`\nAccuracy: ${passed}/${cases.length} (${Math.round(accuracy * 100)}%)`);

if (accuracy < 0.8) {
  process.exitCode = 1;
}
