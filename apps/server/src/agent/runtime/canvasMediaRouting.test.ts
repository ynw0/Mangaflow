import { describe, expect, test } from "bun:test";
import { canvasMediaRoutingInstructions, explicitlyRequestsChatGeneration, routeAgentMediaTools } from "./canvasMediaRouting";

const all = ["getCanvas", "addNode", "getNodeTools", "nodeTools", "connectNodes", "listMediaModels", "generateImage", "generateVideo", "generateAudio", "qcVideo", "draftVideoPrompt"].map(name => ({ name }));

describe("画布优先的生产媒体工具路由", () => {
  const expectedCanvasTools = ["getCanvas", "addNode", "getNodeTools", "nodeTools", "connectNodes", "listMediaModels", "qcVideo", "draftVideoPrompt"];

  test.each(["继续", "继续生成", "制作角色场景道具参考图", "出图并将结果落在画布", "生成一段15s视频", "请在画布连线后生成"])(
    "普通生产消息 %s 不可绕过画布调用聊天生成",
    prompt => {
      expect(explicitlyRequestsChatGeneration(prompt)).toBe(false);
      expect(routeAgentMediaTools(all, prompt, false).map(item => item.name)).toEqual(expectedCanvasTools);
    },
  );

  test.each(["在对话里直接生成图片", "直接在聊天里出图", "请直接生成一张图片放在对话里", "不要画布，直接生成图片", "不用画布，直接在聊天里生成图片", "别用画布，直接出视频"])(
    "明确聊天直出指令 %s 可使用直接生成工具",
    prompt => {
      expect(explicitlyRequestsChatGeneration(prompt)).toBe(true);
      expect(routeAgentMediaTools(all, prompt, false)).toHaveLength(all.length);
    },
  );

  test.each(["不要在对话里生成图片，请使用画布", "不是让你在对话里出图", "图片只在画布生成，聊天里不要出图", "为什么现在在聊天中生成图片", "请解释生成图片流程", "图片在对话里显示正常，不需要修改"])(
    "否定、分析和反馈 %s 不能错误开启对话生图",
    prompt => {
      expect(explicitlyRequestsChatGeneration(prompt)).toBe(false);
    },
  );

  test("子 Agent 不得通过委派任务再次打开直接生成工具", () => {
    expect(routeAgentMediaTools(all, "在对话里直接生成图片", true).map(item => item.name)).toEqual(expectedCanvasTools);
  });

  test("画布不可用时应明确告知缺失环境，不能提供聊天生成作为隐式替代", () => {
    const instructions = canvasMediaRoutingInstructions(false, false);
    expect(instructions).toContain("未连接可操作画布");
    expect(instructions).toContain("不能用对话直出媒体");
    expect(routeAgentMediaTools(all, "继续出图", false).some(tool => tool.name === "generateImage")).toBe(false);
  });

  test("已有画布时保留节点工具和质检，而不开放直接生成", () => {
    expect(canvasMediaRoutingInstructions(true, false)).toContain("getNodeTools");
    expect(canvasMediaRoutingInstructions(true, false)).toContain("connectNodes");
    expect(routeAgentMediaTools(all, "生成视频", false).some(tool => tool.name === "qcVideo")).toBe(true);
  });
});
