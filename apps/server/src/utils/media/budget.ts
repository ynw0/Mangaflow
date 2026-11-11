import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, withFileAccess, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import conf from "@/utils/conf";

export const mediaBudgetSchema = z.strictObject({
  dailyRequests: z.number().int().nonnegative().optional(),
  dailyVideoSeconds: z.number().int().nonnegative().optional(),
});

const usageSchema = z.strictObject({
  date: z.string(),
  requests: z.number().int().nonnegative(),
  videoSeconds: z.number().int().nonnegative(),
  generationIds: z.array(z.string()),
});

export async function reserveMediaBudget(directory: string, mediaType: "image" | "video" | "audio", duration: number | undefined, signal?: AbortSignal, generationId?: string) {
  const limits = mediaBudgetSchema.parse(conf.get("settings.mediaBudget", {}));
  if (limits.dailyRequests === undefined && limits.dailyVideoSeconds === undefined) return;
  const workspace = process.platform === "win32" ? directory.toLowerCase() : directory;
  const workspaceKey = createHash("sha256").update(workspace).digest("hex");
  const path = join(dirname(conf.path), "mediaBudgets", workspaceKey + ".json");
  // 锁住整个额度事务，文件读写仍经由各自的文件队列。
  await withFileAccess([path + ".lock"], "write", async () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const previous = text === undefined ? undefined : usageSchema.parse(JSON.parse(text));
    const usage = previous?.date === date ? previous : { date, requests: 0, videoSeconds: 0, generationIds: [] };
    if (generationId && usage.generationIds.includes(generationId)) return;
    const seconds = mediaType === "video" && duration !== undefined ? Math.ceil(duration) : 0;
    if (mediaType === "video" && limits.dailyVideoSeconds !== undefined && !seconds) {
      throw new Error("工作区设有视频总时长额度，请选择明确时长后生成");
    }
    if (limits.dailyRequests !== undefined && usage.requests >= limits.dailyRequests) {
      throw new Error(`此工作区今日的生成次数已达上限 ${limits.dailyRequests}`);
    }
    if (limits.dailyVideoSeconds !== undefined && seconds && usage.videoSeconds + seconds > limits.dailyVideoSeconds) {
      throw new Error(`本次视频超出工作区今日剩余额度 ${Math.max(0, limits.dailyVideoSeconds - usage.videoSeconds)} 秒`);
    }
    signal?.throwIfAborted();
    usage.requests++;
    usage.videoSeconds += seconds;
    if (generationId) usage.generationIds.push(generationId);
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, JSON.stringify(usage), { mode: 0o600 });
  }, signal);
}
