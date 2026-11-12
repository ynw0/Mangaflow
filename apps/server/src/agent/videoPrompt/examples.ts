import type { z } from "zod";
import type { VideoPromptInput } from "./input";
import type { draftSchema } from "./format";

const contract = {
  shotId: "example01",
  story: "车间里，师傅低声说「等一下。」工友闭嘴等候。",
  purpose: "交代工友停下等候",
  style: "写实车间，固定中景双人镜头",
  continuityIn: "",
  continuityOut: "",
  mustHave: ["师傅说「等一下。」", "工友闭嘴等候"],
  mustNotHave: ["字幕"],
  intent: "dialogue" as const,
};
export const videoPromptInputExample = {
  ...contract, duration: 4, ratio: "16:9", references: [],
} satisfies VideoPromptInput;

const draft = {
  status: "ok",
  cinematicPlan: {
    openingFrame: "固定中景，师傅和工友在工作台两侧。",
    camera: { movement: "固定机位", stopSeconds: 0 },
    ending: { composition: "双人同框", visible: ["师傅", "工友"], holdSeconds: 0.5 },
    beats: [{ startSeconds: 0, endSeconds: 3.5, action: "师傅低声让工友等一下", performance: "工友嘴唇闭合，抬眼等候" }],
  },
  prompt: [
    "integrated_multimodal_description:",
    "[Shot 1] A locked medium two-shot shows <Subject 1>, the foreman, and <Subject 2>, his colleague, on opposite sides of a workbench. <Subject 1> (S1) says quietly, <d>[Chinese] 等一下。</d> The colleague looks up and waits with lips closed. The camera holds both people in frame.",
    "overall_soundscape: A low workshop hum continues.",
    "non_diegetic_music: N/A",
  ].join("\n"),
  promptZh: "固定中景双人镜头，师傅与工友分站工作台两侧。师傅低声说「等一下。」工友抬眼，嘴唇闭合等候。镜头保持双人同框，车间低鸣持续，无配乐。",
} satisfies z.infer<typeof draftSchema>;

export const directorSubmissionExample = {
  input: { shot: contract, format: "h3Text", workflow: { duration: 4, ratio: "16:9", references: [] } },
  submitResult: draft,
};

export const reviewSubmissionExample = {
  input: {
    reviewRequirements: [
      { id: "story", text: contract.story },
      { id: "framing", text: "固定机位下镜尾仍须双人同框" },
    ],
    draft,
  },
  submitResult: {
    status: "ok",
    framingEvidence: "固定中景持续到镜尾，两人未离开工作台两侧。",
    coverage: [
      { requirementId: "story", evidence: "Shot 1 中师傅低声说「等一下。」工友嘴唇闭合并等候。" },
      { requirementId: "framing", evidence: "Shot 1 末句明确保持双人同框。" },
    ],
    findings: [],
  },
};
