import { describe, expect, test } from "bun:test";
import type { QuestionRequest } from "@toonflow/tools-scaffold/runtime";
import { answerQuestion, createQuestionContext } from "./question";

function pendingQuestion(request: QuestionRequest) {
  const cwd = `askuser-test-${crypto.randomUUID()}`;
  let callId = "";
  const bridge = createQuestionContext(cwd, event => { callId = event.callId; });
  const pending = bridge.context.ask("tool-call", request);
  return {
    submit: (values: unknown) => answerQuestion(cwd, callId, { values }),
    pending,
    dispose: bridge.dispose,
  };
}

describe("askUser 每道选择题的自定义回答", () => {
  test("单选题接受预设项外的自定义文本并将它作为字段值传给 Agent", async () => {
    const q = pendingQuestion({
      title: "剧本方向", question: "选择开场",
      fields: [{ field: "opening", title: "开场方式", type: "radio", required: true, options: ["A", "B"] }],
    });
    try {
      const sent = q.submit({ opening: "先展示主角真实的工作困境" });
      expect(sent?.values).toEqual({ opening: "先展示主角真实的工作困境" });
      expect((await q.pending).answer).toContain("先展示主角真实的工作困境");
    } finally { q.dispose(); }
  });

  test("多选题可同时提交预设选项和一条自定义回答", async () => {
    const q = pendingQuestion({
      title: "保留范围", question: "选择保留项",
      fields: [{ field: "keep", title: "保留什么", type: "checkbox", required: true, options: ["世界观", "人物"] }],
    });
    try {
      const sent = q.submit({ keep: ["世界观", "角色的关键利益冲突"] });
      expect(sent?.values).toEqual({ keep: ["世界观", "角色的关键利益冲突"] });
      expect((await q.pending).answer).toContain("世界观、角色的关键利益冲突");
    } finally { q.dispose(); }
  });

  test("同一张表单每道选择题都可以各自填写自定义内容", async () => {
    const q = pendingQuestion({
      title: "创作方案", question: "分别回答",
      fields: [
        { field: "theme", title: "题材", type: "select", required: true, options: ["科幻", "都市"] },
        { field: "style", title: "表现方式", type: "radio", required: true, options: ["写实", "动画"] },
        { field: "focus", title: "创作重点", type: "checkbox", options: ["角色", "技术"] },
      ],
    });
    try {
      const sent = q.submit({ theme: "工业科幻", style: "现实主义工业风格", focus: ["角色", "技术与制度之间的冲突"] });
      expect(sent?.values).toEqual({
        theme: "工业科幻", style: "现实主义工业风格", focus: ["角色", "技术与制度之间的冲突"],
      });
      expect((await q.pending).answer).toContain("技术与制度之间的冲突");
    } finally { q.dispose(); }
  });

  test("多选题拒绝两条自定义内容和重复选项，允许用户重新提交", async () => {
    const q = pendingQuestion({
      title: "选择", question: "请选择",
      fields: [{ field: "items", title: "关注内容", type: "checkbox", required: true, options: ["A", "B"] }],
    });
    try {
      expect(() => q.submit({ items: ["A", "自己写的1", "自己写的2"] })).toThrow("请按要求填写表单");
      expect(() => q.submit({ items: ["A", "A"] })).toThrow("请按要求填写表单");
      expect(() => q.submit({ items: ["A", "  "] })).toThrow("请按要求填写表单");
      q.submit({ items: ["A", "自定义内容"] });
      expect((await q.pending).values).toEqual({ items: ["A", "自定义内容"] });
    } finally { q.dispose(); }
  });
});
