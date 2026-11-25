import { describe, expect, test } from "bun:test";
import { inspectCurrentVideoPrompt, inspectDraft, requiresContinuousTake } from "./format";
import { getVideoSpeechPolicy, inspectDialogue } from "./dialogue";
import { legacyQcContext, readQcRequirements } from "@/utils/production/qcRequirements";
import { videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { cinematicShotSchema, draftCinematicPlanSchema } from "@/utils/production/videoPlan";
import type { DraftCinematicPlan } from "@/utils/production/videoPlan";

const cinematicPlan: DraftCinematicPlan = {
  openingFrame: "The woman is at the entrance of a busy hall",
  camera: { movement: "The final close-up is locked", stopSeconds: 12 },
  ending: { composition: "A close-up of the letter", visible: ["the letter"], holdSeconds: 0.5 },
  beats: [{ startSeconds: 0, endSeconds: 14, action: "The woman discovers a letter", performance: "A quiet reaction" }],
  dialogue: [],
};
const prompt = (body: string) => [
  "subject_definitions:",
  "<Subject 1> is the woman wearing a dark coat.",
  "summary:",
  "[reference generation] The woman enters a hall and discovers a letter.",
  "retention_analysis:",
  "<Subject 1> (appears in [Shot 1]): fully_preserved - dark coat.",
  "detailed_description:",
  body,
  "overall_soundscape:",
  "Indoor ambient room tone across the whole clip.",
  "non_diegetic_music:",
  "N/A",
].join("\n");
const make = (
  body: string, story = "女主进入大厅找到一封信",
  extra: { mustHave?: string[]; mustNotHave?: string[]; plan?: DraftCinematicPlan; voiceCast?: { speakerId: string; characterName: string; sourceId?: string }[]; lockedDialogue?: string[] } = {},
) => inspectDraft({
  cinematicPlan: extra.plan ?? cinematicPlan, prompt: prompt(body), promptZh: "女主进入大厅，镜头反打展示发现信件的反应。",
}, {
  format: "h3Ref2va", setup: { duration: 15, references: [] },
  shot: { story, mustHave: extra.mustHave ?? [], mustNotHave: extra.mustNotHave ?? [], voiceCast: extra.voiceCast, lockedDialogue: extra.lockedDialogue },
} as unknown as Parameters<typeof inspectDraft>[1]).findings;

describe("Ref2VA 按合同使用单镜或多镜", () => {
  test("不引入 shotMode，历史 cinematicPlan 可继续使用且允许可选 shots", () => {
    expect(Object.keys(draftCinematicPlanSchema.shape).sort()).toEqual(
      ["openingFrame","camera","ending","beats","dialogue","shots"].sort(),
    );
    expect(draftCinematicPlanSchema.parse(cinematicPlan)).toEqual(cinematicPlan);
  });
  test("多镜规划可选且与正文三个 [Shot N] 严格对齐", () => {
    const shots = [
      { id: 1, startSeconds: 0, endSeconds: 5, camera: "Wide establishing shot",
        action: "Woman enters the hall", continuityOut: "Woman by the entrance" },
      { id: 2, startSeconds: 5, endSeconds: 10, camera: "Reverse shot",
        action: "Companion looks at the woman", continuityIn: "Companion faces the entrance" },
      { id: 3, startSeconds: 10, endSeconds: 15, camera: "Close-up",
        action: "Letter becomes visible", continuityOut: "Letter in frame" },
    ];
    const plan = draftCinematicPlanSchema.parse({ ...cinematicPlan, shots });
    expect(cinematicShotSchema.parse(shots[1])).toEqual(shots[1]);
    const body = [
      "[Shot 1] A medium shot establishes the woman at the entrance.",
      "[Shot 2] At 00:05.000, the camera cuts to her companion.",
      "[Shot 3] At 00:10.000, a close-up of a letter.",
    ].join("\n");
    expect(make(body, "女主进入大厅，看到信件", { plan })).toEqual([]);
    expect(make(body, "十五秒连续单镜头", { plan })
      .some(x => x.includes("明确要求单镜到底"))).toBe(true);
    const misaligned = body.replace("At 00:10.000", "At 00:09.000");
    expect(make(misaligned, "女主进入大厅，看到信件", { plan })
      .some(x => x.includes("cinematicPlan.shots[2] 从 10 秒开始"))).toBe(true);
    const missing = body.replace("[Shot 3]", "[Shot 4]");
    expect(make(missing, "女主进入大厅，看到信件", { plan })
      .some(x => x.includes("连续编号"))).toBe(true);
    const fewer = body.split("\n").slice(0,2).join("\n");
    expect(make(fewer, "女主进入大厅，看到信件", { plan })
      .some(x => x.includes("数量不一致"))).toBe(true);
  });
  test("新多镜规划不能和单镜提示词矛盾", () => {
    const plan = draftCinematicPlanSchema.parse({ ...cinematicPlan, shots: [
      { id:1, startSeconds:0, endSeconds:5, camera:"medium", action:"Enter" },
      { id:2, startSeconds:5, endSeconds:15, camera:"close-up", action:"React" },
    ] });
    expect(make("[Shot 1] The camera stays on the man.", "15秒一镜到底", { plan })
      .some(x => x.includes("cinematicPlan.shots 规划了多镜头"))).toBe(true);
  });
  test("用户未锁定镜头数量时，使用现有合同判断；否定表述不能误判单镜", () => {
    const body = "[Shot 1] Medium framing.\n[Shot 2] At 00:05.000, reverse shot.";
    expect(make(body, "可以反打，不要求单镜头")).toEqual([]);
    expect(make(body, "不必一镜到底，导演可以自由决定")).toEqual([]);
    expect(requiresContinuousTake({ story: "不强制 single shot", mustHave: [], mustNotHave: [] })).toBe(false);
    expect(make(body, "男主面对镜头，可以按需要切镜")).toEqual([]);
    // 禁止某一种剪辑手法不意味着禁止所有切镜。
    expect(make(body, "男主找信", {mustNotHave: ["蒙太奇"]})).toEqual([]);
    expect(make("[Shot 1] Medium shot.\n[Shot 2] At 00:05.000, a close-up of a letter.",
      "男主找信", {mustNotHave: ["反打"]})).toEqual([]);
  });
  test("明确一镜到底或 mustNotHave 禁止切镜时仍严格执行", () => {
    const body = "[Shot 1] Medium framing.\n[Shot 2] At 00:05.000, reverse shot.";
    expect(make(body, "15秒一个连续镜头").some(x => x.includes("明确要求单镜到底"))).toBe(true);
    expect(make(body, "男主找信", {mustNotHave: ["切镜"]})
      .some(x => x.includes("明确要求单镜到底"))).toBe(true);
  });
  test("无效切点、倒序切点及超出片段时长均被拦截", () => {
    const late = make("[Shot 1] Establishing.\n[Shot 2] At 00:15.000, too late.");
    expect(late.some(x => x.includes("切镜时间必须递增"))).toBe(true);
    const backward = make(
      "[Shot 1] Establishing.\n[Shot 2] At 00:10.000, reverse.\n[Shot 3] At 00:05.000, cut.",
    );
    expect(backward.some(x => x.includes("切镜时间必须递增"))).toBe(true);
  });

  test("允许标准切点、反打、蒙太奇和多镜头动作描述", () => {
    const findings = make([
      "[Shot 1] A medium shot establishes the woman at the entrance.",
      "[Shot 2] At 00:05.000, the camera cuts to a reverse shot of her companion.",
      "[Shot 3] At 00:10.000, a montage cut reveals a close-up of the letter.",
    ].join("\n"));
    expect(findings).toEqual([]);
  });
  test("用户要求一镜到底时，不能擅自切镜", () => {
    const findings = make("[Shot 1] One view.\n[Shot 2] At 00:05.000, a reverse shot.",
      "15秒单镜头，保持连续摄影不切换机位");
    expect(findings.some(x => x.includes("明确要求单镜到底"))).toBe(true);
  });
  test("切镜编号必须按顺序且切点不能超出总时长", () => {
    const findings = make("[Shot 1] A wide view.\n[Shot 3] At 00:18.000, close-up.");
    expect(findings.some(x => x.includes("顺序连续编号"))).toBe(true);
  });
  test("第二镜必须标出准确的切点", () => {
    const findings = make("[Shot 1] Medium shot.\n[Shot 2] A different angle.");
    expect(findings.some(x => x.includes("At MM:SS.mmm"))).toBe(true);
  });
  test("明确单镜合同可以使用单个 [Shot 1]", () => {
    expect(make("[Shot 1] The camera follows the woman continuously as she picks up the letter.",
      "15秒单镜头，不切镜。")).toEqual([]);
  });
});


describe("对白编号按整段视频首次发声顺序校验", () => {
  const lines = ["注意。", "三号闸不对。", "哪里不对？"];
  const makePlan = (ids: string[][]): DraftCinematicPlan => ({
    ...cinematicPlan,
    dialogue: ids.map((speakerIds, i) => ({ speakerIds, startSeconds: i * 4, endSeconds: i * 4 + 2, pauseSeconds: 0 })),
  });
  const body = (ids: string[]) => [
    `[Shot 1] Announcer (${ids[0]}) says in an off-screen voiceover <d>[Mandarin Chinese] ${lines[0]}</d> No one is visible in the shot.`,
    `[Shot 2] At 00:04.000, Tan Xiaoman (${ids[1]}) says <d>[Mandarin Chinese] ${lines[1]}</d>.`,
    `Zheng Kai (${ids[2]}) asks <d>[Mandarin Chinese] ${lines[2]}</d>.`,
  ].join("\n");
  const cast = (ids: string[]) => ids.map((speakerId, index) => ({
    speakerId, characterName: ["播报员", "谭小满", "郑楷"][index]!,
  }));
  test("即使正文与导演计划一致，仍拦截 S7/S4/S3", () => {
    const ids = ["S7", "S4", "S3"];
    const findings = make(body(ids), "画外播报后两位工作人员问答", {
      plan: makePlan(ids.map(id => [id])), voiceCast: cast(ids), lockedDialogue: lines,
    });
    expect(findings.some(x => x.includes("角色「播报员」使用 S7，应为 S1"))).toBe(true);
    expect(findings.some(x => x.includes("角色「谭小满」使用 S4，应为 S2"))).toBe(true);
  });
  test("连续但首次发声顺序错误的 S1/S3/S2 也不能通过", () => {
    const ids = ["S1", "S3", "S2"];
    expect(make(body(ids), "画外播报后问答", { plan: makePlan(ids.map(id => [id])) })
      .some(x => x.includes("使用 S3，应为 S2"))).toBe(true);
  });
  test("切镜后连续编号，画外播报计入编号，未配置声线也允许", () => {
    const ids = ["S1", "S2", "S3"];
    expect(make(body(ids), "画外播报后问答", { plan: makePlan(ids.map(id => [id])), lockedDialogue: lines })).toEqual([]);
    expect(make(body(ids), "画外播报后问答", {
      plan: makePlan(ids.map(id => [id])), voiceCast: cast(ids), lockedDialogue: lines,
    })).toEqual([]);
  });
  test("未实际发声的角色不能占用声音配置中的编号", () => {
    const ids = ["S1", "S2", "S3"];
    const findings = make(body(ids), "画外播报后问答", {
      plan: makePlan(ids.map(id => [id])),
      voiceCast: [...cast(ids), { speakerId: "S4", characterName: "温潞" }],
    });
    expect(findings.some(x => x.includes("角色「温潞」 (S4) 在本视频没有实际对白"))).toBe(true);
  });
  test("齐声、切镜后重复发声及第三位首次发声均使用正确编号", () => {
    const timeline = "[Shot 1] The pair (S1,S2) says <d>[Mandarin Chinese] 好。</d>.\n"
      + "[Shot 2] At 00:04.000, one (S2) says <d>[Mandarin Chinese] 走吧。</d>.\n"
      + "Another person (S3) says <d>[Mandarin Chinese] 等等。</d>.";
    expect(inspectDialogue(timeline, 15, makePlan([["S1", "S2"], ["S2"], ["S3"]])).findings).toEqual([]);
    expect(inspectDialogue(timeline.replace("(S1,S2)", "(S1,S1)"), 15, makePlan([["S1", "S1"], ["S2"], ["S3"]])).findings
      .some(x => x.includes("编号不得重复"))).toBe(true);
  });
});


test("画布正文无导演计划或默认语速时仍可检查并保护对白及单镜要求", () => {
  const body = "[Shot 1] The woman (S1) asks <d>[Mandarin Chinese] 你用的还是原来那根销子？</d>.";
  const original = { prompt: prompt(body), promptZh: "女主询问原来那根销子。" };
  const prepared = { format: "h3Ref2va", setup: { duration: 15, references: [] }, shot: { story: "一镜到底", mustHave: [], mustNotHave: [], lockedDialogue: ["你用的还是原来那根销子？"] }, nodeDraft: original, revision: "node-revision" } as unknown as Parameters<typeof inspectDraft>[1];
  expect(inspectCurrentVideoPrompt(prepared).status).toBe("ok");
  expect(inspectDraft(original, prepared).findings).toEqual([]);
  expect(inspectDraft({ ...original, prompt: original.prompt.replace("原来那根销子", "旧销") }, prepared).findings.some(x => x.includes("锁定原话"))).toBe(true);
  expect(inspectDraft({ ...original, prompt: prompt(body + "\n[Shot 2] At 00:05.000, the camera cuts.") }, prepared).findings.some(x => x.includes("单镜到底"))).toBe(true);
  expect(getVideoSpeechPolicy(true)).not.toHaveProperty("defaultSpeechRateMultiplier");
  expect(getVideoSpeechPolicy(true)).not.toHaveProperty("defaultSpeechCue");
});

test("无审核编号的生成请求可保存剧情验收依据并保护锁定台词", async () => {
  const request = videoGenerationSchema.parse({
    providerId: "comfyui", modelId: "h3", duration: 15, prompt: "A woman holds a pin. (S1) asks <d>[Mandarin Chinese] 你用的还是原来那根销子？</d>",
    qcContract: { story: "女主询问销子", mustHave: ["销子保持原来的形状"], mustNotHave: ["擅自改动台词"], continuityIn: "", continuityOut: "", lockedDialogue: ["你用的还是原来那根销子？"] },
  });
  expect(request.reviewId).toBeUndefined();
  const requirements = await readQcRequirements(".", request);
  expect(requirements.find(x => x.id === "mustHave.0")?.text).toContain("销子保持原来的形状");
  expect(requirements.find(x => x.id === "dialogue.0")?.text).toContain("你用的还是原来那根销子？");
  const fallback = await readQcRequirements(".", { ...request, qcContract: undefined });
  expect(fallback.find(x => x.id === "prompt.visual")?.text).toContain("A woman holds a pin.");
  expect(fallback.find(x => x.id === "dialogue.0")?.source).toBe("prompt.dialogue[0]");
});


test("历史审核记录只提供原剧情，局部修改后不沿用旧时间定位或跨工作区数据", () => {
  const originalPrompt = "(S1) asks <d>[Mandarin Chinese] 你用的还是原来那根销子？</d>";
  const request = videoGenerationSchema.parse({ providerId: "comfyui", modelId: "h3", duration: 15, prompt: originalPrompt });
  const review = {
    snapshot: { directory: "/workspace", modelId: "h3", host: "local", prompt: originalPrompt, seedMode: "random",
      parameters: { duration: 15 }, references: [], workflow: "{}" },
    audit: {
      shot: { story: "女主询问销子", mustHave: ["销子保持原来的形状"], mustNotHave: [], continuityIn: "", continuityOut: "",
        lockedDialogue: ["你用的还是原来那根销子？"] },
      cinematicPlan: { ...cinematicPlan, dialogue: [{ speakerIds: ["S1"], startSeconds: 1, endSeconds: 5, pauseSeconds: 0 }] },
    },
  };
  const exact = legacyQcContext("/workspace", request, review);
  expect(exact?.dialoguePlan?.[0]?.startSeconds).toBe(1);
  const changed = legacyQcContext("/workspace", { ...request, prompt: originalPrompt.replace("asks", "asks at 1.1x normal conversational speed") }, review);
  expect(changed?.shot.lockedDialogue).toEqual(["你用的还是原来那根销子？"]);
  expect(changed?.shot.mustHave).toEqual(["销子保持原来的形状"]);
  expect(changed?.dialoguePlan).toBeUndefined();
  expect(legacyQcContext("/another-workspace", request, review)).toBeUndefined();
  expect(legacyQcContext("/workspace", { ...request, duration: 10 }, review)?.dialoguePlan).toBeUndefined();
});
