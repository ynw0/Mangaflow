// 设置里的第三方密钥。读取时换成哨兵，保存时哨兵还原成已存值，空字符串表示清除。
export const redactedSecret = "[REDACTED]";

const secretField = /(?:apiKey|autodlToken|password|secret|accessToken|refreshToken|authorization)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
