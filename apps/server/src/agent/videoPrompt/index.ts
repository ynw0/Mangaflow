import { parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { z } from "zod";
import { addUsage, emptyUsage, runSubAgent, type SubAgentModel } from "@/agent/runtime/subAgent";
import { prepareVideoPrompt, videoPromptParameters } from "@/agent/videoPrompt/input";
import { draftSchema, inspectDraft, reviewSchema } from "@/agent/videoPrompt/format";
import { findVideoPromptTemplates } from "@/agent/videoPrompt/templates";
import type { VideoPromptTags } from "@/agent/videoPrompt/templates/schema";

const directorReferences = {
  dialogue: ["characterPerformance.md", "soundDesign.md"],
  action: ["actionChoreography.md", "cameraMovement.md"],
  effects: ["visualEffects.md", "lightingAndColor.md"],
  mechanical: ["mechanicalTransformation.md", "actionChoreography.md"],
  reveal: ["scenePlaybooks.md", "compositionAndLens.md"],
  environment: ["environmentDesign.md", "compositionAndLens.md"],
};
const scenesByIntent: Record<keyof typeof directorReferences, NonNullable<VideoPromptTags["scene"]>> = {
  dialogue: ["对话", "质问", "谈判", "告别", "交接"],
  action: ["追逐", "战斗", "格挡", "救援", "撤离", "交接"],
  effects: ["觉醒", "施法", "灾变", "战斗", "格挡"],
  mechanical: ["机械变形", "装置启动"],
  reveal: ["揭示", "调查", "反转", "危险逼近", "反应", "登场"],
  environment: ["场景建立", "转场", "战后余波"],
};
const skillList = z.object({ skills: z.array(z.object({
  name: z.string(), scope: z.enum(["global", "workspace"]), disableModelInvocation: z.boolean().optional(),
})) });
const skillDocument = z.object({ content: z.string().min(1) });

function parseReply<T>(schema: z.ZodType<T>, reply: string) {
  const text = reply.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  return schema.parse(JSON.parse(text));
}

export function createVideoPromptTool(options: SubAgentModel & {
  cwd: string;
  skillOperator: ToolDefinition;
  canvas?: CanvasContext;
}): ToolDefinition {
  const { cwd, skillOperator, canvas, ...model } = options;
  return {
    name: "draftVideoPrompt",
    label: "制作视频提示词",
    description: "根据已确认的镜头合同和参考制作 H3 英文提示词与简体中文对照，依次导演、预检、独立审核和返修。不启动生成。已有视频节点传实际 canvasId、nodeId；明确获准修改目标节点时才传 write=true。references 必须是真实获准素材及用途，顺序匹配实际输入。",
    promptSnippet: "制作或重写 H3 成片提示词时，准备真实镜头合同后调用 draftVideoPrompt，使用其通过审核的英文和中文稿。",
    parameters: z.toJSONSchema(videoPromptParameters, { io: "input", target: "draft-07" }),
    executionMode: "sequential",
    async execute(_id, params, signal, onUpdate, ctx) {
      const input = videoPromptParameters.parse(params);
      const prepared = await prepareVideoPrompt(cwd, input, canvas, signal);
      const tags = { scene: scenesByIntent[input.intent], ...prepared.templateTags };
      const candidates = findVideoPromptTemplates(tags, {
        ...prepared.templateConditions,
        duration: prepared.setup.duration,
        format: prepared.format,
        imageCount: prepared.setup.references.filter(reference => reference.kind === "image").length,
      });
      const templateMatches = candidates.map(({ id, title, matches }) => ({ id, title, matches }));
      const usage = emptyUsage();
      const skills: { name: string; scope: string; path: string; version?: string }[] = [];
      const attempts: { stage: "director" | "preflight" | "review"; findings: string[] }[] = [];
      const skillCall = async (args: Record<string, string>) =>
        (await skillOperator.execute(crypto.randomUUID(), args, signal, undefined, ctx)).details;
      const available = skillList.parse(await skillCall({ action: "list" })).skills;
      async function read(name: string, path = "SKILL.md") {
        const skill = available.find(item => item.name === name && !item.disableModelInvocation);
        if (!skill) throw new Error(`缺少已启用的制作技能：${name}`);
        const { content } = skillDocument.parse(await skillCall({ action: "read", name, scope: skill.scope, path }));
        const metadata = path === "SKILL.md" ? parseFrontmatter(content).frontmatter.metadata : undefined;
        const version = z.object({ version: z.string() }).safeParse(metadata);
        skills.push({ name, scope: skill.scope, path, ...(version.success ? { version: version.data.version } : {}) });
        return content;
      }
      const directorRules = await Promise.all([
        read("workflow"), read("workflow", "references/video-director.md"),
        read("cinematicPromptCraft"), ...directorReferences[input.intent].map(path => read("cinematicPromptCraft", `references/${path}`)),
      ]);
      const formatRules = await Promise.all([
        read("h3-prompt-writing"),
        read("h3-prompt-writing", prepared.format === "h3Ref2va" ? "references/ref-en.txt" : "references/base-en.txt"),
        read("workflow", "references/common.md"),
      ]);
      const reviewRules = await read("workflow", "references/video-prompt-review.md");
      const update = (text: string) => onUpdate?.({ content: [{ type: "text", text }], details: {} });
      const finish = (result: Record<string, unknown>) => {
        const details = { ...result, shotId: input.shotId, workflow: prepared.setup, skills, templateMatches, attempts };
        return { details, content: [{ type: "text" as const, text: JSON.stringify(details) }], usage };
      };
      const taskInput = { shot: prepared.shot, format: prepared.format, workflow: prepared.setup };
      async function specialist<T>(schema: z.ZodType<T>, name: string, task: string, rules: string[]) {
        signal?.throwIfAborted();
        update(name);
        const output = await runSubAgent({
          ...model, cwd, name, task, tools: [], signal, responseFormat: "json",
          instructions: [
            "这是只读的 H3 提示词制作任务。以下为宿主已实际加载的技能正文，直接按适用模式执行；当前任务的实际工作流优先于示例。仅根据传入的已确认剧情、素材用途与描述做判断。",
            ...rules,
          ].join("\n\n"),
        });
        addUsage(usage, output.usage);
        signal?.throwIfAborted();
        if (output.result.status !== "completed") throw new Error(`${name}未完成：${output.result.result}`);
        try { return parseReply(schema, output.result.result); }
        catch { throw new Error(`${name}未返回有效的结构化结果`); }
      }
      let lastDraft: { prompt: string; promptZh: string } | undefined;
      let findings: string[] = [];
      // ACT: 初稿与两次返修构成一次有限的制作请求，未通过时保留实际结论交回用户。
      for (let round = 0; round < 3; round++) {
        const draft = await specialist(draftSchema, round ? "导演返修" : "导演写作", [
          '输出 {"status":"ok","prompt":"英文生成正文","promptZh":"简中对照"}；缺少关键输入或无法在给定时长交付剧情时，输出 {"status":"blocked","reason":"具体原因"}。',
          "先在内部确定镜头要交付的叙事信息，再设计可见的起点、动作、接触或变化、反馈和末态。按实际模式写 H3 正文，稳定设定与逐段变化分开，英文和中文保持同样的可见事实。",
          "按已确认的剧情和素材取用匹配的拍法。模板片段含占位词、使用条件和验收点，只有条件满足时才采用相关片段，实际正文写真实可观察的事件。",
          JSON.stringify({ ...taskInput, candidates, ...(lastDraft ? { previousDraft: lastDraft, findings } : {}) }),
        ].join("\n"), [...directorRules, ...formatRules]);
        if (draft.status === "blocked") {
          attempts.push({ stage: "director", findings: [draft.reason] });
          return finish(draft);
        }
        attempts.push({ stage: "director", findings: [] });
        lastDraft = { prompt: draft.prompt, promptZh: draft.promptZh };
        findings = inspectDraft(lastDraft, prepared);
        attempts.push({ stage: "preflight", findings });
        if (findings.length) continue;

        const review = await specialist(reviewSchema, "独立提示词审核", [
          '输出 {"status":"ok","findings":[]} 或 {"status":"rejected","findings":["具体时间段或句子的问题及整改目标"]}。只审核当前稿件。',
          "逐项核对剧情硬要求、动作因果和末态、特效来源及反馈、参考用途、画面与声音可执行性以及中英事实一致性。以实际工作流对应的格式为准。画面已明确的事实不用要求重写，证据不足时明确缺项。",
          JSON.stringify({ ...taskInput, draft: lastDraft }),
        ].join("\n"), [reviewRules, ...formatRules]);
        findings = review.findings;
        attempts.push({ stage: "review", findings });
        if (review.status !== "ok") continue;

        let written = false;
        let writeError: string | undefined;
        if (input.node?.write && canvas && prepared.revision) {
          try {
            const refreshed = await prepareVideoPrompt(cwd, input, canvas, signal);
            if (refreshed.revision !== prepared.revision || JSON.stringify(refreshed.setup) !== JSON.stringify(prepared.setup)) {
              throw new Error("工作流或视频节点在审稿期间已变化，请重新制作提示词");
            }
            await canvas.call({
              name: "nodeTools",
              args: { canvasId: input.node.canvasId, nodeId: input.node.nodeId, name: "node:setPrompt", args: { ...lastDraft, expectedRevision: prepared.revision } },
            }, signal);
            written = true;
          } catch (error) {
            signal?.throwIfAborted();
            writeError = error instanceof Error ? error.message : String(error);
          }
        }
        return finish({ status: "ok", ...lastDraft, written, writeError });
      }
      return finish({ status: "rejected", findings, written: false });
    },
  };
}
