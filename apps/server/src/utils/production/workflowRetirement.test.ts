import { describe, expect, test } from "bun:test";
import { canonicalVideoWorkflowId, isRetiredWorkflowId, readProduction, unifiedH3WorkflowId } from "./config";

describe("废弃工作流与旧画布兼容", () => {
  test("四个旧双采 ID 不再列出，历史引用仍解析到统一双采", () => {
    for (const id of ["video/h3_erca_16x9", "video/h3_erca_9x16", "video/h3_erca_16x9_autodl", "video/h3_erca_9x16_autodl"]) {
      expect(isRetiredWorkflowId(id)).toBe(true);
      expect(canonicalVideoWorkflowId(id)).toBe(unifiedH3WorkflowId);
      expect(readProduction({ videoWorkflow: id }).videoWorkflow).toBe(unifiedH3WorkflowId);
    }
  });
  test("旧 Gemma 工作流不再列出，现有及自定义工作流不受影响", () => {
    for (const id of ["qc/gemma4E2b", "qc/gemma4E4b", "qc/gemma4_12B"]) expect(isRetiredWorkflowId(id)).toBe(true);
    for (const id of ["qc/gemma4", unifiedH3WorkflowId, "video/h3_ref2va_1080p", "video/h3_flf_repair", "video/my_h3", "video/h3_erca_16x9_custom", "image/qwenImage21T2i"]) {
      expect(isRetiredWorkflowId(id)).toBe(false);
      expect(canonicalVideoWorkflowId(id)).toBe(id);
    }
  });
});
