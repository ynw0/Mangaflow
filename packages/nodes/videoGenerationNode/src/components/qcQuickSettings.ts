import type { NodeVideoRequest } from "@toonflow/nodes-scaffold/runtime";

type QcOverride = NodeVideoRequest["qcOverride"];
type CustomQc = Extract<NonNullable<QcOverride>, { mode: "custom" }>;
export type QcScope = NonNullable<CustomQc["qcLevel"]>;
type Defaults = { qcLevel?: string; qcTrigger?: string } | undefined;

/** Present existing policy without converting legacy {mode:"off"} into {qcLevel:"none"}.
 * The former only disables automatic QC; manual checks remain possible.
 */
export function getQcDisplayState(override: QcOverride, defaults: Defaults) {
  const custom = override?.mode === "custom" ? override : undefined;
  const value = custom?.qcLevel ?? defaults?.qcLevel ?? "video";
  const level: QcScope = value === "none" || value === "videoAudio" ? value : "video";
  const trigger = custom?.qcTrigger ?? defaults?.qcTrigger ?? "manual";
  return { level, automatic: level !== "none" && override?.mode !== "off" && trigger === "auto" };
}
export function changeQcLevel(override: QcOverride, level: QcScope): CustomQc {
  return {
    ...(override?.mode === "custom" ? override : {}),
    mode: "custom", qcLevel: level,
    ...(override?.mode === "off" ? {qcTrigger: "manual" as const} : {}),
  };
}
export function changeQcAuto(override: QcOverride, automatic: boolean): NonNullable<QcOverride> {
  if (!automatic && override?.mode !== "custom") return {mode: "off"};
  return { ...(override?.mode === "custom" ? override : {}), mode: "custom", qcTrigger: automatic ? "auto" : "manual" };
}
