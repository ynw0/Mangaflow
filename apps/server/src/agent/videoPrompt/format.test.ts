import { describe, expect, test } from "bun:test";
import { inspectDraft, requiresContinuousTake } from "./format";
import { draftCinematicPlanSchema } from "@/utils/production/videoPlan";
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
  extra: { mustHave?: string[]; mustNotHave?: string[] } = {},
) => inspectDraft({
  cinematicPlan, prompt: prompt(body), promptZh: "女主进入大厅，镜头反打展示发现信件的反应。",
}, {
  format: "h3Ref2va", setup: { duration: 15, references: [] },
  shot: { story, mustHave: extra.mustHave ?? [], mustNotHave: extra.mustNotHave ?? [] },
} as unknown as Parameters<typeof inspectDraft>[1]);

describe("Ref2VA 按合同使用单镜或多镜", () => {
  test("不引入 shotMode 或 shots 结构，历史 cinematicPlan 可继续使用", () => {
    expect(Object.keys(draftCinematicPlanSchema.shape).sort()).toEqual(
      ["openingFrame","camera","ending","beats","dialogue"].sort(),
    );
    expect(draftCinematicPlanSchema.parse(cinematicPlan)).toEqual(cinematicPlan);
  });
  test("用户未锁定镜头数量时，使用现有合同判断；否定表述不能误判单镜", () => {
    const body = "[Shot 1] Medium framing.\n[Shot 2] At 00:05.000, reverse shot.";
    expect(make(body, "可以反打，不要求单镜头")).toEqual([]);
    expect(make(body, "不必一镜到底，导演可以自由决定")).toEqual([]);
    expect(requiresContinuousTake({ story: "不强制 single shot", mustHave: [], mustNotHave: [] })).toBe(false);
    expect(make(body, "男主面对镜头，可以按需要切镜")).toEqual([]);
    // 禁止某一种剪辑手法不意味着禁止所有切镜。
    expect(make(body, "男主找信", {mustNotHave: ["蒙太奇", "反打"]})).toEqual([]);
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
