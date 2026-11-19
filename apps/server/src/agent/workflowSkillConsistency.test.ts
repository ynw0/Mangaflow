import { describe, expect, test } from "bun:test";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    expect(workflow).toContain("每阶段按当前运行模式和已有授权推进");
    expect(workflow).toContain("目标模式可继续已授权的目标");
    expect(canvas).not.toContain("确认后才推进的内容");
    expect(canvas).toContain("满足当前模式的验收关卡后推进");
  });

  test("对白精修复用编剧子 Agent，位于剧本复核和分镜之间", async () => {
    const workflow = await skill("workflow/SKILL.md");
    const episode = await skill("workflow/references/episodeScript.md");
    const dialogue = await skill("dialoguePolish/SKILL.md");
    expect(dialogue).toContain("name: dialoguePolish");
    expect(dialogue).toContain("正反例");
    expect(dialogue).toContain("保留原稿");
    expect(workflow).toContain("dialoguePolish/SKILL.md");
    expect(workflow.indexOf("| 对白精修")).toBeGreaterThan(workflow.indexOf("| 场次剧本"));
    expect(workflow.indexOf("| 分镜")).toBeGreaterThan(workflow.indexOf("| 对白精修"));
    expect(episode).toContain('tasks[].role: "story"');
    expect(episode).toContain("不增加独立审核 Agent");
    expect(episode).toContain("已有定稿仅需拆镜时不启动该步骤");
  });

  test("画布指导的缺省比例与统一视频工作流的配置一致", async () => {
    const text = await skill("canvas/references/videoProduction.md");
    expect(text).toContain("默认 `16:9`");
    expect(text).not.toContain("视频使用支持的最短时长和对应最低分辨率，比例默认 `9:16`");
  });

  test("动画、漫剧和音乐的创作判断不再按反转与表演频率硬套，同时保留执行合同", async () => {
    const cn = await skill("3d-animation-short-generator/SKILL.cn.md");
    const en = await skill("3d-animation-short-generator/SKILL.md");
    const table = await skill("3d-animation-short-generator/references/shot-table-spec.md");
    const panels = await skill("3d-animation-short-generator/references/storyboard-guidelines.md");
    const storyboard = await skill("workflow/references/story-planner.md");
    const asset = await skill("workflow/references/asset-planner.md");
    const music = await skill("music-video-subtitle-generator/SKILL.cn.md");
    const hand = await skill("handdrawn-live-video-generator/SKILL.cn.md");
    expect(cn).not.toContain("每连续 3 镜至少 1 镜");
    expect(cn).not.toContain("表演必须夸张弹性");
    expect(cn).toContain("六项必检");
    expect(cn).toContain("每秒指令覆盖");
    expect(cn).toContain("Hook 作用与分布");
    expect(en).toContain("Global Visual Style Lock");
    expect(table).not.toContain("at least one of every three consecutive shots");
    expect(table).toContain("exactly six columns");
    expect(table).toContain("Six required checks");
    expect(table).toContain("no shot exceeds 15 seconds");
    expect(table).toContain("no shot contains more than three important characters");
    expect(panels).toContain("narrator-mouth-closed: true");
    expect(storyboard).toContain("duration_hint_seconds");
    expect(storyboard).toContain("continuity_out");
    expect(storyboard).not.toContain("情绪爆点/爽点、结尾钩子或阶段结果");
    expect(asset).toContain("asset_key");
    expect(asset).toContain("reuse_existing");
    expect(music).not.toContain("每个镜头的空间必须明显不同");
    expect(hand).toContain("首段接触、持续变形、追逐与结尾空间级变化");
  });

  test("内置 Skill 文档内相对链接均存在，不依赖已删除的旧引用", async () => {
    const root = fileURLToPath(new URL("../../../../packages/skills/", import.meta.url));
    const directories = [root];
    const docs: string[] = [];
    while (directories.length > 0) {
      const dir = directories.pop()!;
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const absolute = resolve(dir, item.name);
        if (item.isDirectory()) directories.push(absolute);
        else if (item.isFile() && item.name.endsWith(".md")) docs.push(absolute);
      }
    }
    const failures: string[] = [];
    for (const doc of docs) {
      const content = await readFile(doc, "utf8");
      for (const match of content.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)) {
        const link = match[1].trim().replace(/^<|>$/g, "").split("#")[0].split("?")[0];
        if (!link || /^(?:[a-z]+:|\/\/|\/)/i.test(link) || /[{}]/.test(link)) continue;
        const target = resolve(dirname(doc), decodeURIComponent(link));
        if (!target.startsWith(root)) {
          failures.push(`${doc}: reference outside bundled skills ${link}`);
          continue;
        }
        try { await access(target); } catch { failures.push(`${doc}: missing ${link}`); }
      }
    }
    expect(failures).toEqual([]);
  });

  test("全部内置 Skill 有效并区分创作自由与工程合同", async () => {
    const names = [
      "3d-animation-short-generator", "brand-promo-video-generator", "canvas",
      "cinematicPromptCraft", "co-op-game-intro-generator", "dialoguePolish",
      "h3-prompt-writing", "h3SamplingStrategy", "handdrawn-live-video-generator",
      "minimalist-product-ad-generator", "music-video-subtitle-generator",
      "paper-collage-explainer-generator", "papercraft-stop-motion-explainer",
      "v118workflow", "workflow",
    ];
    const all = await Promise.all(names.map(async name => ({ name, content: await skill(`${name}/SKILL.md`) })));
    for (const { name, content } of all) {
      expect(content).toContain(`name: ${name}`);
      expect(content.length).toBeGreaterThan(100);
    }
    const styleNames = names.filter(name => name.endsWith("-generator") || name.endsWith("-explainer"));
    for (const name of styleNames) {
      const chinese = await skill(`${name}/SKILL.cn.md`);
      expect(chinese).toContain("name: " + name);
      expect(chinese).toContain("## ");
    }
    const storyboard = await skill("workflow/references/story-planner.md");
    const genre = await skill("workflow/references/genreCraft.md");
    const animationTable = await skill("3d-animation-short-generator/references/shot-table-spec.md");
    const oldImage = await skill("v118workflow/references/knowledge/imagePromptCraft.md");
    const h3 = await skill("h3-prompt-writing/SKILL.md");
    expect(storyboard).not.toContain("开场第一拍须有主体运动");
    expect(genre).not.toContain("全剧有三次加重的失败");
    expect(animationTable).not.toContain("Performance must be exaggerated and elastic");
    expect(animationTable).toContain("exactly six columns");
    expect(oldImage).not.toContain("(shotCraft.md#");
    expect(h3).toContain("subject_definitions");
    expect(h3).toContain("integrated_multimodal_description");
  });
});
