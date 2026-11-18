import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const skill = async (relative: string) => readFile(new URL("../../../../packages/skills/" + relative, import.meta.url), "utf8");

describe("MangaFlow 视频制作 Skill 合同一致性", () => {
  test("顶层 workflow 不再固定单镜头或 16:9，并与多镜规划一致", async () => {
    const text = await skill("workflow/SKILL.md");
    expect(text).not.toContain("一个视频节点只放一个连续摄影镜头");
    expect(text).not.toContain("成片 16:9。");
    expect(text).toContain("cinematicPlan.shots");
    expect(text).toContain("[Shot N]");
    expect(text).toContain("一镜到底");
    expect(text).toContain("9:16");
  });

  test("场次知识允许有条件的多镜剪辑，不丢失单镜约束", async () => {
    const text = await skill("workflow/references/creativeKnowledge.md");
    expect(text).toContain("多个 `[Shot N]`");
    expect(text).toContain("用户明确要求单镜");
  });

  test("目标模式不再受无条件阶段确认措辞阻塞", async () => {
    const workflow = await skill("workflow/SKILL.md");
    const canvas = await skill("canvas/references/videoProduction.md");
    expect(workflow).not.toContain("并另行确认");
    expect(workflow).toContain("按当前运行模式及已授权范围决定是否等待确认");
    expect(canvas).not.toContain("确认后才推进的内容");
    expect(canvas).toContain("满足当前模式的验收关卡后推进");
  });

  test("画布指导的缺省比例与统一视频工作流的配置一致", async () => {
    const text = await skill("canvas/references/videoProduction.md");
    expect(text).toContain("默认 `16:9`");
    expect(text).not.toContain("视频使用支持的最短时长和对应最低分辨率，比例默认 `9:16`");
  });
});
