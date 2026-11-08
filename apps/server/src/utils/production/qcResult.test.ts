import { describe, expect, test } from "bun:test";
import { parseQcPayload } from "./qcResult";

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
});
