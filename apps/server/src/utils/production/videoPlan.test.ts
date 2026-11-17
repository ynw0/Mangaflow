import { describe, expect, test } from "bun:test";
import { cinematicPlanSchema, draftCinematicPlanSchema, inspectVideoPlan } from "./videoPlan";

const base = {
  openingFrame: "A woman stands at the hall entrance",
  camera: { movement: "Last shot holds the letter in a locked frame", stopSeconds: 14 },
  ending: { composition: "A close-up of the letter", visible: ["letter"], holdSeconds: 1 },
  beats: [{ startSeconds: 0, endSeconds: 3, action: "Woman enters", performance: "Alert" }],
  dialogue: [],
};
const shots = [
  { id: 1, startSeconds: 0, endSeconds: 5, camera: "Wide shot at entrance", action: "Woman enters", continuityOut: "Woman at entrance" },
  { id: 2, startSeconds: 5, endSeconds: 10, camera: "Reverse shot of companion", action: "Companion reacts", continuityIn: "Companion facing entrance" },
  { id: 3, startSeconds: 10, endSeconds: 15, camera: "Close-up of letter", action: "Letter is revealed", continuityOut: "Letter visible" },
];
const make = (next: object) => draftCinematicPlanSchema.parse({ ...base, shots, ...next });

describe("cinematicPlan 单镜与多镜兼容", () => {
  test("简单镜头只需要一个真实动作节拍，保持原结构而不新增复杂度字段", () => {
    const plan = draftCinematicPlanSchema.parse({
      openingFrame:"车间的固定中景",camera:{movement:"固定机位",stopSeconds:0},
      ending:{composition:"仪表盘保持在画框中央",visible:["仪表盘"],holdSeconds:1},
      beats:[{startSeconds:0,endSeconds:5,action:"指示灯亮起",performance:"灯光从暗到亮"}],
      dialogue:[],
    });
    expect(plan.shots).toBeUndefined();
    expect(inspectVideoPlan(plan,5)).toEqual([]);
  });
  test("历史五字段计划依旧能读；不需要 shotMode", () => {
    expect(cinematicPlanSchema.parse(base)).toEqual(base);
    expect(draftCinematicPlanSchema.parse(base)).toEqual(base);
    expect("shotMode" in cinematicPlanSchema.shape).toBe(false);
  });
  test("三镜覆盖 0-15 秒且合法使用全片 beats/dialogue", () => {
    expect(inspectVideoPlan(make({}), 15)).toEqual([]);
  });
  test("镜号不能重复或跳号", () => {
    const altered = shots.map((s, i) => i === 1 ? { ...s, id: 3 } : s);
    expect(inspectVideoPlan(make({ shots: altered }), 15)
      .some(item => item.includes("id 应为 2"))).toBe(true);
  });
  test("镜头不能重叠或出现时间空隙", () => {
    const overlap = shots.map((s, i) => i === 1 ? { ...s, startSeconds: 4.5 } : s);
    const gap = shots.map((s, i) => i === 1 ? { ...s, startSeconds: 5.5 } : s);
    expect(inspectVideoPlan(make({ shots: overlap }), 15).some(item => item.includes("不能重叠"))).toBe(true);
    expect(inspectVideoPlan(make({ shots: gap }), 15).some(item => item.includes("不能重叠"))).toBe(true);
  });
  test("最后镜头必须覆盖视频结尾，且不能超时或倒序", () => {
    const short = shots.map((s, i) => i === 2 ? { ...s, endSeconds: 14 } : s);
    const tooLong = shots.map((s, i) => i === 2 ? { ...s, endSeconds: 16 } : s);
    const badOrder = shots.map((s, i) => i === 2 ? { ...s, endSeconds: 9 } : s);
    expect(inspectVideoPlan(make({ shots: short }), 15).some(item => item.includes("最后一镜"))).toBe(true);
    expect(inspectVideoPlan(make({ shots: tooLong }), 15).some(item => item.includes("必须处于视频时长内"))).toBe(true);
    expect(inspectVideoPlan(make({ shots: badOrder }), 15).some(item => item.includes("最后一镜"))).toBe(true);
  });
  test("第一镜必须在 0 秒开始", () => {
    const shifted = shots.map((s, i) => i === 0 ? { ...s, startSeconds: 0.5 } : s);
    expect(inspectVideoPlan(make({ shots: shifted }), 15).some(item => item.includes("起点应为 0"))).toBe(true);
  });
  test("只有一个规划镜头也合法，多镜不是强制要求", () => {
    const single = [{ id:1, startSeconds:0, endSeconds:15, camera:"Locked wide", action:"Walks to the table" }];
    expect(inspectVideoPlan(make({ shots: single }), 15)).toEqual([]);
  });
  test("shots 必须有摄像机描述及实际动作，不能填空镜头", () => {
    expect(draftCinematicPlanSchema.safeParse({ ...base, shots:[{ id:1, startSeconds:0, endSeconds:15, camera:"", action:"" }] }).success).toBe(false);
  });
});
