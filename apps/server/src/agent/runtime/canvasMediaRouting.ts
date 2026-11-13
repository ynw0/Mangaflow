/**
 * Canvas-first routing for media production.
 *
 * The canvas node tools are not wrappers around these chat generation tools:
 * image/video nodes manage prompts, references, execution state and visible output.
 * Hiding chat generation tools by default prevents an agent from silently bypassing
 * the canvas while retaining a narrow opt-in for explicit chat-only generation.
 */
export const directMediaToolNames = ["generateImage", "generateVideo", "generateAudio"] as const;

type DirectMediaTool = typeof directMediaToolNames[number];
const chatLocation = "(?:当前)?(?:对话|聊天)(?:框|窗口|界面)?(?:里|内|中)?";
const requestPrefix = "(?:请|帮我|麻烦|直接|只|仅|给我|\\s)*";
const directRequest = /^\s*(?:(?:请|帮我|麻烦)\s*)*直接/;
const chatDestination = new RegExp(`^(?:(?:并|然后|再)?(?:直接)?(?:放|发|输出|显示)?[到在])${chatLocation}`);
const chatBeforeAction = new RegExp(`^在${chatLocation}${requestPrefix}`);
const deniedChat = new RegExp(`(?:不要|不用|别|禁止|不准|并非|不是|无需|不需要)(?:再|直接|一直|仅|只|让你|让它)?(?:在|到|放在|显示在)?${chatLocation}`);
const noCanvas = /^(?:不要|不用|别用|别在|禁止用)(?:在|用|使用)?(?:当前)?画布(?:生成|出图|出视频|出音频)?$/;
const canvasDestination = /(?:到|在|至)[^，,。；;！？!?]{0,12}(?:画布|节点)/;
const mediaActions: [DirectMediaTool, RegExp][] = [
  ["generateImage", /^(?:出图|生图|画(?:一张|图)|(?:生成|制作|出)(?:(?:一|两|几|\d+)\s*张\s*)?(?:图片|图像|参考图|图))/],
  ["generateVideo", /^(?:生成|制作|出|做)(?:(?:一|两|几|\d+)\s*(?:段|个)\s*)?(?:(?:\d+(?:\.\d+)?\s*(?:秒|s))\s*)?视频/],
  ["generateAudio", /^(?:生成|制作|出|做)(?:(?:一|两|几|\d+)\s*(?:段|个|条)\s*)?(?:音频|音效|配音|音乐)/],
];

/** Only an explicit request to generate *in the chat* opts out of the canvas. */
export function explicitlyRequestsChatGeneration(prompt: string): boolean {
  return requestedChatMediaTools(prompt).size > 0;
}

function requestedChatMediaTools(prompt: string) {
  const tools = new Set<DirectMediaTool>();
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (deniedChat.test(normalized)) return tools;
  const prefix = new RegExp(`^${requestPrefix}`);
  // 生成动作和目的地须在同一分句，避免把随后聊天里的进度汇报识别为直出。
  let previousExcludesCanvas = false;
  for (const clause of normalized.split(/(?<=[？?])|[，,。；;！!]/)) {
    const command = clause.replace(prefix, "");
    if (/[吗么][？?]?$|[？?]$/.test(command)) {
      previousExcludesCanvas = false;
      continue;
    }
    const explicitChat = chatBeforeAction.test(command);
    const action = explicitChat ? command.replace(chatBeforeAction, "") : command;
    if (!canvasDestination.test(action)) {
      for (const [tool, pattern] of mediaActions) {
        const match = pattern.exec(action);
        if (match && (explicitChat || chatDestination.test(action.slice(match[0].length).trim())
          || (previousExcludesCanvas && directRequest.test(clause)))) tools.add(tool);
      }
    }
    previousExcludesCanvas = noCanvas.test(command.trim());
  }
  return tools;
}

/** Apply after plugins are loaded and before delegating tools to any sub-agent. */
export function routeAgentMediaTools<T extends { name: string }>(tools: readonly T[], prompt: string, isSubAgent: boolean): T[] {
  const allowed = isSubAgent ? new Set<DirectMediaTool>() : requestedChatMediaTools(prompt);
  const direct = new Set<string>(directMediaToolNames);
  return tools.filter(tool => !direct.has(tool.name) || allowed.has(tool.name as DirectMediaTool));
}

export function canvasMediaRoutingInstructions(hasCanvas: boolean, directChatAllowed: boolean): string {
  if (directChatAllowed) return "用户明确要求直接在对话内生成媒体；本轮允许直接生成工具。若用户还要求画布落点，仍须通过真实节点操作，不可把聊天图片冒充画布成果。";
  if (!hasCanvas) return "本轮未连接可操作画布。制作、继续出图或出视频时先说明需要打开目标项目画布；不能用对话直出媒体、文件编辑画布 JSON 或虚构节点结果来代替。普通分析问答不受影响。";
  return [
    "【画布优先执行约束】用户要出图、出视频、继续制作或制作资产时，先在当前画布定位或新建适用的生成节点；已有节点优先复用，不重复创建。",
    "通过 getCanvas/findCanvasNodes 查询现场，必要时 addNode；用 getNodeTools 读取函数与 Schema，通过 nodeTools 设置模型、提示词并在授权后执行节点的生成函数；参考素材须先核对端口和连接，再调用 connectNodes。完成后回读节点输出与连接并在画布展示结果。",
    "不要只写提示词文档或把图片以 Markdown 回传就声称完成了制作。没有画布权限、缺少节点能力或画布调用失败时说明具体阻塞，不改为直接媒体生成。保留现有阶段确认及 GPU 算力授权；不能为了积极使用画布而跳过批准。",
  ].join("\n");
}
