import { createHash } from "node:crypto";

// 设置里的第三方密钥。读取时换成哨兵，保存时哨兵还原成已存值，空字符串表示清除。
export const redactedSecret = "[REDACTED]";

const secretField = /(?:apiKey|autodlToken|password|secret|accessToken|refreshToken|authorization)$/i;
// 已公开泄露的凭证摘要，启动清理与设置保存使用同一份记录。
const leakedSecretHashes = new Set([
  "aecad4dd9832e363cffa28165c27b1e66242ba742e5830ed905ba206c59d682c",
  "fe3320cb7af5a15aae802dda63f5e2479b039d5717912e760166ff808cb1a8d4",
  "553bfd1bb1c5fd235576c4deb8eed302fff3642616db1ebe34677b14cd3ca5b5",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function leakedSettingsFields(value: unknown, clear = false) {
  const fields: string[] = [];
  function visit(entry: unknown, parent: string[]) {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, [...parent, String(index)]));
      return;
    }
    if (!isRecord(entry)) return;
    for (const [key, item] of Object.entries(entry)) {
      const path = [...parent, key];
      if (typeof item === "string" && item && leakedSecretHashes.has(createHash("sha256").update(item).digest("hex"))) {
        fields.push(path.join("."));
        if (clear) entry[key] = "";
      } else {
        visit(item, path);
      }
    }
  }
  visit(value, []);
  return fields;
}

export function redactSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => redactSettings(item));
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = secretField.test(key) && typeof item === "string" && item ? redactedSecret : redactSettings(item);
  }
  return next;
}

export function restoreSettingsSecrets(incoming: unknown, previous: unknown): unknown {
  if (Array.isArray(incoming)) {
    const prior = Array.isArray(previous) ? previous : [];
    return incoming.map((item, index) => {
      if (isRecord(item) && typeof item.id === "string") {
        const match = prior.find(entry => isRecord(entry) && entry.id === item.id);
        return restoreSettingsSecrets(item, match);
      }
      return restoreSettingsSecrets(item, prior[index]);
    });
  }
  if (!isRecord(incoming)) return incoming;
  const prior = isRecord(previous) ? previous : {};
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(incoming)) {
    if (secretField.test(key) && typeof item === "string") {
      next[key] = item === redactedSecret ? (typeof prior[key] === "string" ? prior[key] : "") : item;
    } else {
      next[key] = restoreSettingsSecrets(item, prior[key]);
    }
  }
  return next;
}
