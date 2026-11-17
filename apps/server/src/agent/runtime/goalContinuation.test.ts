import { describe, expect, test } from "bun:test";
import { continueGoalUntilFinished } from "./goalContinuation";

describe("目标模式不设固定续跑轮次", () => {
  test("超过原有8轮仍继续，直到调用 completeGoal", async () => {
    let rounds = 0;
    await continueGoalUntilFinished({
      isComplete: () => rounds >= 15,
      isStopped: () => false,
      continueOnce: async () => { rounds++; },
    });
    expect(rounds).toBe(15);
  });

  test("用户停止立即阻止下一轮", async () => {
    let rounds = 0;
    const controller = new AbortController();
    await continueGoalUntilFinished({
      isComplete: () => false,
      isStopped: () => controller.signal.aborted,
      continueOnce: async () => { if (++rounds === 3) controller.abort(); },
    });
    expect(rounds).toBe(3);
  });

  test("模型错误或上下文压缩失败后不再续跑", async () => {
    for (const kind of ["model", "compaction"]) {
      let rounds = 0;
      let failure: string | undefined;
      await continueGoalUntilFinished({
        isComplete: () => false,
        isStopped: () => Boolean(failure),
        continueOnce: async () => { if (++rounds === 2) failure = kind; },
      });
      expect(rounds).toBe(2);
    }
  });

  test("目标已完成时不发起多余请求", async () => {
    let rounds = 0;
    await continueGoalUntilFinished({
      isComplete: () => true,
      isStopped: () => false,
      continueOnce: async () => { rounds++; },
    });
    expect(rounds).toBe(0);
  });

  test("SDK 异常继续向外抛出，不吞掉失败或偷偷重试", async () => {
    let rounds = 0;
    await expect(continueGoalUntilFinished({
      isComplete: () => false,
      isStopped: () => false,
      continueOnce: async () => { rounds++; throw new Error("provider down"); },
    })).rejects.toThrow("provider down");
    expect(rounds).toBe(1);
  });
});
