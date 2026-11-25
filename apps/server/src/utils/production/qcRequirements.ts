import { videoQcContractSchema, type MediaGenerationRequest, type QcRequirement } from "@toonflow/tools-scaffold/runtime";
import { readDialogueBlocks } from "@/agent/videoPrompt/dialogue";

const shotSchema = videoQcContractSchema;

// 提示词检查与成片质检共用节点上已确认的镜头合同。
export function getShotRequirements(shot: { story: string; mustHave: string[]; mustNotHave: string[]; continuityIn: string; continuityOut: string }): QcRequirement[] {
  return [
    { id: "story", source: "story", text: shot.story },
    ...shot.mustHave.map((text, index) => ({ id: `mustHave.${index}`, source: `mustHave[${index}]`, text })),
    ...shot.mustNotHave.map((text, index) => ({ id: `mustNotHave.${index}`, source: `mustNotHave[${index}]`, text: `禁止出现：${text}` })),
    ...["continuityIn", "continuityOut"].flatMap(source => {
      const text = shot[source as "continuityIn" | "continuityOut"].trim();
      return text ? [{ id: source, source,
        text: `需要延续的状态：${text}。对明确要求看到或听到的事实逐项核对。对于在画外延续的状态，只检查实际画面和声音是否与之冲突。` }] : [];
    }),
  ];
}

export async function readQcRequirements(_directory: string, request?: MediaGenerationRequest): Promise<QcRequirement[]> {
  if (!request) return [];
  const shot = request.qcContract && shotSchema.parse(request.qcContract);
  const promptLines = readDialogueBlocks(request.prompt).map(block => block[1]!.replace(/^\s*\[[^\]]+\]\s*/, "").trim());
  const lines = shot?.lockedDialogue ?? (request.generateAudio === false ? [] : promptLines);
  const dialogue = lines.map((text, index): QcRequirement => ({
    id: `dialogue.${index}`,
    source: shot?.lockedDialogue ? `lockedDialogue[${index}]` : `prompt.dialogue[${index}]`,
    domain: "audio",
    text: `核对说话人、原话及其完整性。原台词：${text}。`,
  }));
  const visual: QcRequirement[] = shot ? getShotRequirements(shot) : request.prompt.trim() ? [{ id: "prompt.visual", source: "prompt", domain: "video", text: "仅核对以下实际生成提示词中的可见事实、动作、构图与连续性：\n" + request.prompt }] : [];
  return [...visual, ...dialogue];
}
