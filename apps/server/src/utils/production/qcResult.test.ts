import { describe, expect, test } from "bun:test";
import { parseQcPayload, summarizeQc, validateRectificationCoverage } from "./qcResult";

describe("QC 合同与模型结果", () => {
  test("非法 JSON 属于质检执行失败，不会生成合格结论", () => {
    expect(() => parseQcPayload("not a JSON response", "video")).toThrow("质检输出无效");
  });

  test("离散帧不能证明全程未出现禁止项，但完整视频证据可以", () => {
    const requirement = { id: "mustNotHave.0", source: "mustNotHave[0]", text: "禁止出现额外手指" };
    const raw = JSON.stringify({ checks: [{
      requirementId: requirement.id, domain: "video", result: "pass",
      evidence: "观察到的人物手指数量正常", time: "0–8s",
    }] });
    const sampled = parseQcPayload(raw, "video", true, [requirement], true, false);
    expect(sampled.status).toBe("unverified");
    expect(sampled.checks[0]?.result).toBe("unverified");
    const fullVideo = parseQcPayload(raw, "video", true, [requirement], true, true);
    expect(fullVideo.status).toBe("ok");
  });
  test("QC 返回真实问题、合同要求和时间，未验证不伪装成失败", () => {
    const qc = parseQcPayload(JSON.stringify({ checks: [
      { requirementId: "mustHave.0", domain: "video", result: "fail",
        evidence: "00:04.200 只出现整块黑色翼板", problem: "三级机械翼未展开", fixHint: "核对翼舱状态参考", time: "00:04.200" },
      { requirementId: "continuityOut", domain: "video", result: "unverified", evidence: "镜尾遮挡，无法确认翼锁定", time: "00:14.000" },
    ] }), "video", true, [
      { id: "mustHave.0", source: "mustHave[0]", text: "三级机翼展开并锁止" },
      { id: "continuityOut", source: "continuityOut", text: "镜尾全部机翼可见" },
    ]);
    expect(qc.status).toBe("rejected");
    expect(qc.issues).toEqual([
      expect.objectContaining({ id: "video:mustHave.0", kind: "defect", problem: "三级机械翼未展开", expected: "三级机翼展开并锁止", time: "00:04.200" }),
      expect.objectContaining({ id: "video:continuityOut", kind: "needsEvidence", expected: "镜尾全部机翼可见" }),
    ]);
  });

  test("同编号跨画面和音频不能合并，整改计划须覆盖每项问题", () => {
    const checks = [
      { requirementId: "story", domain: "video" as const, result: "fail" as const, evidence: "动作错位" },
      { requirementId: "story", domain: "audio" as const, result: "unverified" as const, evidence: "音轨缺失" },
    ];
    const qc = summarizeQc(checks);
    expect(qc.issues?.map(issue => issue.id)).toEqual(["video:story", "audio:story"]);
    expect(() => validateRectificationCoverage(checks, [{ issueIds: ["video:story"] }])).toThrow("没有覆盖");
    expect(() => validateRectificationCoverage(checks, [{ issueIds: ["video:notExists", "audio:story"] }])).toThrow("不存在");
    expect(() => validateRectificationCoverage(checks, [{ issueIds: ["video:story", "audio:story"] }])).not.toThrow();
  });

});
