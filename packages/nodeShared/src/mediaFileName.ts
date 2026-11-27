export type ShotVideoContext = { projectName: string; canvasFile: string };

const invalidFileChars = /[\\/:*?"<>|\u0000-\u001f]/g;

export function projectFileName(projectName: string) {
  const name = projectName.replace(invalidFileChars, "").trim();
  if (!name) throw new Error("项目名不能作为文件名");
  return name;
}

export function episodeCode(canvasFile: string) {
  const stem = canvasFile.split(/[\\/]/).pop()?.replace(/\.json$/i, "") ?? "";
  const match = /^EP(\d{1,3})$/i.exec(stem);
  if (!match?.[1]) throw new Error("画布文件名需为 EP001 这种集号");
  return `EP${match[1].padStart(3, "0")}`;
}

export function shotCode(label: string) {
  const match = /^\s*[VS](\d{1,3})\b/i.exec(label);
  if (!match?.[1]) throw new Error("节点名称需以 V01 或 S01 这样的镜号开头");
  return `S${match[1].padStart(2, "0")}`;
}

/** 单镜头成片主干：项目名 + EP*** + S**，不含版本和扩展名。 */
export function shotVideoBaseName(projectName: string, canvasFile: string, label: string) {
  return `${projectFileName(projectName)}${episodeCode(canvasFile)}${shotCode(label)}`;
}

/** 同镜头的一次生成：主干后加 V**，例如 咪咪EP001S02V01。 */
export function versionedShotBaseName(stem: string, version: number) {
  if (!Number.isInteger(version) || version < 1) throw new Error("版本号无效");
  return `${stem}V${String(version).padStart(2, "0")}`;
}

/** 剪辑节点导出的整集成片。 */
export function episodeVideoFileName(projectName: string, canvasFile: string) {
  return `${projectFileName(projectName)}${episodeCode(canvasFile)}.mp4`;
}
