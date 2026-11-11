/**
 * Canvas-first routing for media production.
 *
 * The canvas node tools are not wrappers around these chat generation tools:
 * image/video nodes manage prompts, references, execution state and visible output.
 * Hiding chat generation tools by default prevents an agent from silently bypassing
 * the canvas while retaining a narrow opt-in for explicit chat-only generation.
 */
export const directMediaToolNames = ["generateImage", "generateVideo", "generateAudio"] as const;

const mediaAction = /(?:生成|制作|出图|生图|出视频|做视频|出音频|做音频|画(?:一张|图)?|render)/i;
const chatLocation = /(?:对话|聊天)(?:框|窗口|里|内|中|界面)?/;
const deniedChat = /(?:不要|不用|别|禁止|不准|并非|不是|无需|不需要)(?:再|直接|一直|仅|只|让你|让它)?(?:在|到|放在|显示在)?(?:当前)?(?:对话|聊天)(?:框|窗口|里|内|中|界面)?/;

/** Only an explicit request to generate *in the chat* opts out of the canvas. */
export function explicitlyRequestsChatGeneration(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized || !mediaAction.test(normalized)) return false;
  // Questions about old chat output are not requests to produce new chat media.
  if (/^(?:为什么|为何|怎么|如何|解释|分析|研究|论证|排查|检查|查看|看看|帮我看看)/.test(normalized)) return false;
  if (deniedChat.test(normalized)) return false;
  return (
    /(?:在|到|放在|发在|直接在|只在|仅在)(?:当前)?(?:对话|聊天)(?:框|窗口|里|内|中|界面)?(?:.{0,16})(?:直接)?(?:生成|出图|生图|制作|画|显示)/.test(normalized)
    || /(?:直接|只|仅)(?:生成|出图|生图|制作|画)(?:.{0,36})(?:到|在|放在|显示在)?(?:当前)?(?:对话|聊天)(?:框|窗口|里|内|中|界面)?/.test(normalized)
    || /(?:不要|不用|别|禁止)(?:.{0,8})(?:画布|节点)(?:.{0,32})(?:直接)?(?:生成|出图|生图|制作|画)/.test(normalized)
  );
}

/** Apply after plugins are loaded and before delegating tools to any sub-agent. */
export function routeAgentMediaTools<T extends { name: string }>(tools: readonly T[], prompt: string, isSubAgent: boolean): T[] {
  if (!isSubAgent && explicitlyRequestsChatGeneration(prompt)) return [...tools];
  const blocked = new Set<string>(directMediaToolNames);
  return tools.filter(tool => !blocked.has(tool.name));
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
