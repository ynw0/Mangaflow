import { describe, expect, test } from "bun:test";
import { inspectDialogue, type DialogueBeat, speechOnsetAllowanceSeconds, speechReleaseAllowanceSeconds, endingReserveSeconds } from "./dialogue";
import { inspectDraft } from "./format";

function marks(text: string): DialogueBeat[] {
  const list: DialogueBeat[] = [{ index: text.indexOf("[Shot 1]"), number: "1", start: 0 }];
  for (const m of text.matchAll(/(?:^|\n)At (\d{2}):(\d{2})\.(\d{3}),/g)) {
    list.push({ index: m.index, number: "1", start: Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000 });
  }
  return list;
}

const lastLine = "我父亲留下的这辆旧车绝不能让你们带走了";
const say = `<Subject 3> (S3) says firmly, <d>[Chinese] ${lastLine}</d>`;

function draft(body: string) {
  return {
    cinematicPlan: {
      openingFrame: "车间固定中景，主角与另外两人同框",
      camera: { movement: "固定机位", stopSeconds: 0 },
      ending: { composition: "三人同框", visible: ["卡尔", "主角"], holdSeconds: 0 },
      beats: [{ startSeconds: 0, endSeconds: 14.5, action: "交谈", performance: "多人交谈并自然停顿" }],
    },
    prompt: ["integrated_multimodal_description:", body, "overall_soundscape: Low workshop hum.", "non_diegetic_music: N/A"].join("\n"),
    promptZh: "固定镜头中三人交谈，说话人开口与对白对应，环境声持续。",
  };
}

const prepared = {
  format: "h3Text",
  setup: { duration: 15, references: [] },
  audioEnabled: true,
} as unknown as Parameters<typeof inspectDraft>[1];

describe("H3 单镜头对白时序安全预算", () => {
  test("用保守开口缓冲、收声缓冲和镜尾余量，拒绝9秒才开始的长末句", () => {
    expect(speechOnsetAllowanceSeconds).toBeGreaterThanOrEqual(0.75);
    expect(speechReleaseAllowanceSeconds).toBeGreaterThan(0.3);
    expect(endingReserveSeconds).toBeGreaterThanOrEqual(0.2);
    const timeline = `[Shot 1] Three people face each other.\nAt 00:09.000, ${say}`;
    const issues = inspectDialogue(timeline, 15, marks(timeline));
    expect(issues.join(" ")).toContain("对白预算不足");
    expect(issues.join(" ")).toContain("不得删台词");
  });

  test("将同一末句安排到更早的节拍后可以通过；不把1.3倍提示当硬速率", () => {
    const timeline = `[Shot 1] Three people face each other.\nAt 00:07.000, ${say}`;
    expect(inspectDialogue(timeline, 15, marks(timeline))).toEqual([]);
  });

  test("一个内部时间节拍有两位人物连续发言必须重新划分开口时间", () => {
    const timeline = "[Shot 1] <Subject 1> (S1) says softly, <d>[Chinese] 请等等。</d> <Subject 2> (S2) replies loudly, <d>[Chinese] 不行！</d>";
    expect(inspectDialogue(timeline, 10, marks(timeline)).join(" ")).toContain("次对白");
  });

  test("语速估算会计入中文逗号、句号等自然停顿", () => {
    const plain = "[Shot 1] <Subject 1> (S1) says briskly, <d>[Chinese] 好好好好</d>";
    const punct = "[Shot 1] <Subject 1> (S1) says briskly, <d>[Chinese] 好，好，好，好。</d>";
    const a = inspectDialogue(plain, 2.9, marks(plain));
    const b = inspectDialogue(punct, 2.9, marks(punct));
    expect(a).toEqual([]);
    expect(b.join(" ")).toContain("对白预算不足");
  });

  test("检查真实 H3 格式：拒绝将同一连续镜头写成两个 Shot", () => {
    const body = "[Shot 1] The three remain in one continuous frame.\n[Shot 2] At 00:09.000, <Subject 3> (S3) says, <d>[Chinese] 好。</d>";
    expect(inspectDraft(draft(body), prepared).join(" ")).toContain("只能有一个 [Shot 1]");
  });

  test("单 Shot 1 + 独立 At 节拍可以合法编排对白", () => {
    const body = "[Shot 1] The three remain in one continuous frame.\nAt 00:07.000, " + say;
    expect(inspectDraft(draft(body), prepared)).toEqual([]);
  });

  test("即使不切镜，最后一秒才开始长句也必须被预检退回", () => {
    const body = "[Shot 1] The three remain in one continuous frame.\nAt 00:13.000, " + say;
    expect(inspectDraft(draft(body), prepared).join(" ")).toContain("对白预算不足");
  });

  test("时间提示必须独占一行且严格递增", () => {
    const inline = "[Shot 1] He looks away. At 00:07.000, " + say;
    expect(inspectDraft(draft(inline), prepared).join(" ")).toContain("独立行开头");
    const reverse = "[Shot 1] Three people stand still.\nAt 00:08.000, someone looks up.\nAt 00:07.000, " + say;
    expect(inspectDraft(draft(reverse), prepared).join(" ")).toContain("严格递增");
  });
});
