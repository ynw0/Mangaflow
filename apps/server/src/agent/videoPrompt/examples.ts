import type { VideoPromptInput } from "./input";

// 只示意宿主调用字段，场内表演由当前剧本决定。
export const videoPromptNodeExample = {
  shotId: "EP001-S01",
  story: "末班车开走时，她刚赶到站台。",
  lockedDialogue: [],
  purpose: "她没赶上末班车",
  style: "写实",
  continuityIn: "",
  continuityOut: "她留在站台上",
  mustHave: ["人到站台时车已经开走"],
  mustNotHave: [],
  intent: "action",
  node: { canvasId: "EP001.json", nodeId: "实际节点ID", write: true },
  references: [],
} satisfies VideoPromptInput;
