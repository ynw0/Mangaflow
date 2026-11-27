import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { readProduction } from "./config";
import { gemmaModelFile, gemmaTargetId, isGemmaModelFile, assertGemmaModelEnabled } from "./gemmaQcModels";
import { assertQcCallAllowed, captureQcPolicy, productionForQc } from "./qcPolicy";

const bf16 = "nested/gemma4_e4b_it_bf16.safetensors";
const fp8 = "gemma4_e4b_it_fp8_scaled.safetensors";
const id = "qc/gemma4:" + bf16;
function config() {
  const config = { ...readProduction(), gemmaQcHost: "local" as const, localComfyuiBaseUrl: "http://127.0.0.1:8188", disabledWorkflowIds: [], enabledGemmaQcModels: {} };
  return { ...config, enabledGemmaQcModels: { [gemmaTargetId(config)]: [bf16] } };
}
describe("Gemma QC 精确模型与实例", () => {
  test("Gemma 共用一个工作流，使用 ComfyUI 默认采样参数及 32768 输出上限", () => {
    const root = new URL("../../../../../workflows/qc/", import.meta.url);
    expect(readdirSync(root).filter(name => name.endsWith(".json"))).toEqual(["gemma4Api.json"]);
    const workflow = JSON.parse(readFileSync(new URL("gemma4Api.json", root), "utf8"));
    expect(workflow["4"].class_type).toBe("CLIPLoader");
    expect(workflow["5"].inputs).toMatchObject({
      clip: ["4", 0], video: ["2", 0], audio: ["2", 1], max_length: 32768,
      sampling_mode: "on", "sampling_mode.temperature": 0.7, "sampling_mode.top_k": 64,
      "sampling_mode.top_p": 0.95, "sampling_mode.min_p": 0.05,
      "sampling_mode.repetition_penalty": 1.05, "sampling_mode.presence_penalty": 0,
      thinking: false, use_default_template: true, mtp: "off",
    });
  });
  test("完整文件名和精度不被替代", () => {
    expect(gemmaModelFile(id)).toBe(bf16);
    expect(isGemmaModelFile(bf16)).toBe(true);
    expect(isGemmaModelFile("gemma4_mmproj.safetensors")).toBe(false);
    expect(isGemmaModelFile("qwen.safetensors")).toBe(false);
    expect(assertGemmaModelEnabled(config(), id)).toBe(bf16);
    expect(() => assertGemmaModelEnabled(config(), "qc/gemma4:" + fp8)).toThrow("未在当前质检实例启用");
    expect(() => assertGemmaModelEnabled(config(), "qc/gemma4E4b")).toThrow("旧版");
    expect(() => assertGemmaModelEnabled({...config(), disabledWorkflowIds: ["qc/gemma4"]}, id)).toThrow();
    expect(() => assertGemmaModelEnabled({...config(), localComfyuiBaseUrl:"http://127.0.0.2:8188"}, id)).toThrow();
  });
  test("节点策略和实际授权，关闭自动不关闭手动", () => {
    const cfg = {...config(), qcMethod:"model" as const, qcLevel:"videoAudio" as const, qcTrigger:"manual" as const, videoQcModelId:"other", audioQcModelId:"other"};
    const policy = captureQcPolicy({mode:"custom", qcTrigger:"auto", videoQcModelId:id}, cfg);
    expect(policy.videoQcModelId).toBe(id);
    expect(policy.audioQcModelId).toBe(id);
    expect(() => assertQcCallAllowed(policy,false,true)).toThrow("modelCallConfirmed");
    expect(() => assertQcCallAllowed(policy,true,true)).not.toThrow();
    const off = captureQcPolicy({mode:"off"}, {...cfg,qcTrigger:"auto"});
    expect(off.qcTrigger).toBe("manual");
    expect(() => assertQcCallAllowed(off,false,true)).not.toThrow();
    expect(() => assertQcCallAllowed(off,false,false)).toThrow();
    expect(() => captureQcPolicy({mode:"custom", videoQcModelId:id, audioQcModelId:"qc/gemma4:"+fp8},cfg)).toThrow("同一个实际模型");
    expect(productionForQc(policy,{...cfg,videoQcModelId:"changed"}).videoQcModelId).toBe(id);
    expect(() => productionForQc(policy,{...cfg,localComfyuiBaseUrl:"http://127.0.0.2:8188"})).toThrow("原质检实例已变化");
  });
});
