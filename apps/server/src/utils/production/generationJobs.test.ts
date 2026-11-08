import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MediaGenerationRequest, GeneratedMedia, VideoExecution } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { generationJobStatus, getStoredGenerationRequest, listGenerationJobs, runGenerationJob } from "./generationJobs";

describe("持久化视频生成任务恢复", () => {
  test("原请求可找回；重新执行相同 ID 不再重复提交；不同请求和工作区被拒绝", async () => {
    const directory = await mkdtemp(join(tmpdir(), "manga-video-job-"));
    const another = await mkdtemp(join(tmpdir(), "manga-other-job-"));
    const id = randomUUID();
    const jobPath = join(dirname(conf.path), "generationJobs", `${id}.json`);
    const request: MediaGenerationRequest = {
      providerId: "comfyui", modelId: "video/h3_erca_16x9", prompt: "Original prompt",
      generationId: id, outputDirectory: "assets/test-node", duration: 8, ratio: "16:9",
    };
    const execution: VideoExecution = { promptId: "comfy-original-id", host: "local" };
    const generated: GeneratedMedia = { path: "original.mp4", mimeType: "video/mp4", mediaType: "video" };
    let submissions = 0;
    let registrations = 0;
    const options = {
      directory, request,
      generate: async ({ submitting, submitted }: {
        submitting: () => Promise<void>;
        submitted: (execution: VideoExecution) => Promise<void>;
      }) => {
        submissions++;
        await submitting();
        await submitted(execution);
        return { files: [{ bytes: new Uint8Array([0, 0, 0, 24]), mimeType: "video/mp4" }], execution };
      },
      save: async () => {
        await writeFile(join(directory, "original.mp4"), new Uint8Array([0, 0, 0, 24]));
        return [generated];
      },
      record: async () => { registrations++; },
    };
    try {
      expect(await runGenerationJob(options)).toEqual([generated]);
      expect(await getStoredGenerationRequest(directory, id)).toEqual(request);
      const status = await generationJobStatus(directory, id);
      expect(status).toMatchObject({
        generationId: id, phase: "completed", promptId: "comfy-original-id",
        outputDirectory: "assets/test-node", canResumeById: true,
      });
      expect((await listGenerationJobs(directory)).find(job => job.generationId === id)?.outputDirectory)
        .toBe("assets/test-node");
      expect(await runGenerationJob(options)).toEqual([generated]);
      expect(submissions).toBe(1);
      expect(registrations).toBe(1);
      await expect(runGenerationJob({
        ...options, request: { ...request, prompt: "A changed prompt" },
      })).rejects.toThrow("生成参数已改变");
      await expect(getStoredGenerationRequest(another, id)).rejects.toThrow("任务不属于当前工作区");
    } finally {
      await rm(jobPath, { force: true });
      await rm(directory, { recursive: true, force: true });
      await rm(another, { recursive: true, force: true });
    }
  });

  test("旧版记录未保存原请求时，不允许凭任务 ID 猜测参数重新提交", async () => {
    const directory = await mkdtemp(join(tmpdir(), "manga-legacy-job-"));
    const id = randomUUID();
    const jobPath = join(dirname(conf.path), "generationJobs", `${id}.json`);
    try {
      await writeFile(jobPath, JSON.stringify({
        id, directory, fingerprint: "legacy", phase: "submitted", createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), execution: { promptId: "old", host: "local" },
      }));
      await expect(getStoredGenerationRequest(directory, id)).rejects.toThrow("缺少可信原始生成参数");
    } finally {
      await rm(jobPath, { force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
});
