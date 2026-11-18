import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, unlink, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import conf from "@/utils/conf";
import { draftCinematicPlanSchema } from "@/utils/production/videoPlan";
import { videoPromptParameters } from "./input";

export const resumeParameters = z.strictObject({ draftId: z.uuid() });
const pendingSchema = z.object({
  input: videoPromptParameters, cacheKey: z.string(), revision: z.string().optional(),
  draft: z.object({ prompt: z.string(), promptZh: z.string(), cinematicPlan: draftCinematicPlanSchema }),
  findings: z.array(z.string()),
});
export type PendingDraft = z.infer<typeof pendingSchema>;

// 待审稿只允许原工作区、原会话恢复，不进入可用于生成的视频审核记录。
export function pendingDraftPath(cwd: string, parentFile: string, draftId: string) {
  const owner = createHash("sha256").update(JSON.stringify([cwd, parentFile])).digest("hex");
  return join(dirname(conf.path), "pendingVideoDrafts", owner, resumeParameters.shape.draftId.parse(draftId) + ".json");
}

export async function readPendingDraft(path: string) {
  return pendingSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function savePendingDraft(path: string, pending: PendingDraft) {
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, JSON.stringify(pending), { mode: 0o600 });
}

export async function removePendingDraft(path: string) {
  await unlink(path);
}
