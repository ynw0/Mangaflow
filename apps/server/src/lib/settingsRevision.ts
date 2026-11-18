import { createHmac, randomBytes } from "node:crypto";

// 版本标记覆盖完整配置，进程私钥避免通过标记猜测凭证。
const revisionKey = randomBytes(32);
export function settingsRevision(settings: unknown) {
  return createHmac("sha256", revisionKey).update(JSON.stringify(settings)).digest("hex");
}
