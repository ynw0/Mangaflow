import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, readdir, unlink, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import conf from "@/utils/conf";
import { draftCinematicPlanSchema } from "@/utils/production/videoPlan";
import { savedVideoPromptParameters } from "./input";

export const resumeParameters = z.strictObject({ draftId: z.uuid().optional(), shotId: z.string().trim().min(1).max(500).optional(), discard: z.boolean().optional() })
  .refine(value => Boolean(value.draftId) !== Boolean(value.shotId) && (!value.discard || !!value.draftId), "查询传 shotId；续审或丢弃传 draftId");
const pendingSchema = z.object({
  input: savedVideoPromptParameters, draftKey: z.string().optional(), revision: z.string().optional(),
  draft: z.object({ prompt: z.string(), promptZh: z.string(), cinematicPlan: draftCinematicPlanSchema.optional() }),
  findings: z.array(z.string()),
  needsAdjacentShots: z.literal(true).optional(),
});
export type PendingDraft = z.infer<typeof pendingSchema>;

// 待审稿只允许原工作区、原会话恢复，不进入可用于生成的视频审核记录。
function pendingDirectory(cwd: string, parentFile: string) {
  const owner = createHash("sha256").update(JSON.stringify([cwd, parentFile])).digest("hex");
  return join(dirname(conf.path), "pendingVideoDrafts", owner);
}

export function pendingDraftPath(cwd: string, parentFile: string, draftId: string) {
  return join(pendingDirectory(cwd, parentFile), z.uuid().parse(draftId) + ".json");
}

export async function readPendingDraft(path: string) {
  return pendingSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function savePendingDraft(path: string, pending: PendingDraft) {
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, JSON.stringify(pending), { mode: 0o600 });
}

export async function findPendingDrafts(cwd: string, parentFile: string, shotId: string) {
  const directory = pendingDirectory(cwd, parentFile);
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  const drafts = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const draftId = name.slice(0, -5);
    const saved = await readPendingDraft(pendingDraftPath(cwd, parentFile, draftId)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (saved?.input.shotId === shotId) drafts.push({ draftId, node: saved.input.node, findings: saved.findings });
  }
  return drafts;
}

export async function removePendingDraft(path: string) {
  await unlink(path);
}
