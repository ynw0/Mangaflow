import { inspectDialogue } from "@/agent/videoPrompt/dialogue";

export type VideoPromptFormat = "h3Ref2va" | "h3Frames" | "h3Text";
export type PromptInspectionContext = {
  format: VideoPromptFormat;
  setup: { duration: number; references: { label: string }[] };
  shot: {
    story: string;
    mustHave: string[];
    mustNotHave: string[];
    lockedDialogue?: string[];
    voiceCast?: { speakerId: string; characterName?: string; sourceId?: string }[];
  };
  audioEnabled?: boolean;
  nodeDraft?: { prompt: string; promptZh?: string };
  revision?: string;
  contextWarnings?: string[];
};

/** Interpret existing story/mustHave/mustNotHave; do not add a second shot-mode field.
 * Negated mentions (e.g. “不要求单镜头”) are not an instruction to prohibit cuts.
 */
export function requiresContinuousTake(shot: { story: string; mustHave: string[]; mustNotHave: string[]; lockedDialogue?: string[] }): boolean {
  const cuts = /^(?:(?:禁止|不得|不要|不许|不允许|无|避免|no)\s*)?(?:(?:任何|所有|全部|全程|any|all|every)\s*)?(?:切镜|镜头切换|切换机位|(?:camera\s+)?cuts?)\s*[。.!！]?$/i;
  if (shot.mustNotHave.some(item => cuts.test(item.trim()))) return true;
  // 作品中的原台词只是剧情内容，已批准的摄影约束仍从合同读取。
  let story = shot.story;
  for (const line of shot.lockedDialogue ?? []) {
    if (line) story = story.replaceAll(line, " ");
  }
  const requirement = [story, ...shot.mustHave].join("；");
  const single = /单一连续镜头|一个连续镜头|单镜头|单一镜头|一镜到底|全程不切镜|禁止切镜|不允许切镜|不得切镜|不许切镜|不切镜|one continuous shot|single continuous take|single shot|one shot|no cuts/gi;
  for (const match of requirement.matchAll(single)) {
    const before = requirement.slice(Math.max(0, (match.index ?? 0) - 22), match.index);
    if (/(?:不再要求|不要求|无需|无须|不必|无需强制|不强制|不限定|不限于|不是|并非|可以不是|允许|取消|放弃|改成|改为)\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}

const refSections = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
const baseSections = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];

export function inspectDraft(draft: { prompt: string; promptZh: string }, prepared: PromptInspectionContext) {
  const { prompt, promptZh } = draft;
  const { format, setup } = prepared;
  const expected = format === "h3Ref2va" ? refSections : baseSections;
  const headings = [...prompt.matchAll(/^[\t ]*(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)[\t ]*:/gm)];
  const findings: string[] = [];
  if (headings.length !== expected.length || headings.some((heading, index) => heading[1] !== expected[index])) {
    findings.push(`按实际模式完整输出这些字段：${expected.join("、")}。`);
    return { findings, warnings: [] as string[] };
  }
  const prefix = prompt.slice(0, headings[0]!.index).trim();
  // 官方 Ref2VA 允许 [keyframe completion] 和首帧/关键帧关系。
  // 只有真正绑定了 refs.first_frame / refs.last_frame 的工作流才具备专门的帧输入；
  // 普通参考图仍可作为目标帧进行语义引导，但不能承诺逐像素精准锁帧。
  if (format === "h3Ref2va" && (
    /\b(?:very\s+)?(?:first|last|initial|final)\s+(?:video\s+)?frame\s+(?:is|must\s+be|equals|matches)\s+(?:exactly|identical(?:ly)?(?:\s+to)?|pixel[- ]for[- ]pixel)\s*<Picture\s+\d+>/i.test(prompt)
    || /\b(?:pixel[- ]for[- ]pixel|bit[- ]for[- ]bit)\s+(?:identical|match|matching|reproduction)\b/i.test(prompt)
  )) {
    findings.push("普通 Ref2VA 图片可按官方规范用 keyframe completion 描述帧关系，但不保证第一帧/末帧与参考图逐像素一致。删除关于参考图必然逐像素匹配的承诺；如需专用帧输入，请切换实际绑定首尾帧的工作流。");
  }
  if (format !== "h3Frames" && prefix) findings.push("正文须直接从本模式的第一个字段开始。");
  for (const [index, heading] of headings.entries()) {
    const body = prompt.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim();
    if (!body) findings.push(`字段 ${heading[1]} 缺少内容。`);
  }
  const start = headings[format === "h3Ref2va" ? 3 : 0]!;
  const timeline = prompt.slice(start.index + start[0].length, headings.at(-2)!.index);
  // 标题只在正文中识别；对白和可见文字里的引用不构成镜头标记。
  const shotBody = timeline.replace(/<d>[\s\S]*?<\/d>|"[^"\n]*"/gi, match => match.replace(/[^\r\n]/g, " "));
  const shotMarkers = [...shotBody.matchAll(/\[Shot (\d+)\]/g)];
  const opening = shotMarkers[0];
  if (format === "h3Frames") {
    const duration = setup.duration.toFixed(2);
    const first = /Picture 1 \(from Shot 1\)[^;\r\n]*?\b0\.00-second mark/.exec(prefix);
    const last = /Picture 2 \(from Shot ([1-9]\d*)\)[^;\r\n]*?\b(\d+\.\d{2})-second mark/.exec(prefix);
    // 尾帧对齐实际剪辑的末镜，单镜时才和首帧同属 Shot 1。
    const lastShot = shotMarkers.at(-1)?.[1];
    if (/[\r\n]/.test(prefix) || !first || !last || first.index >= last.index || last[1] !== lastShot || last[2] !== duration) {
      findings.push(`首行按 H3 FL2VA 将 Picture 1 对齐开场 0.00 秒，将 Picture 2 对齐正文最后一镜和总时长 ${duration} 秒。`);
    }
  }
  if (!opening || opening[1] !== "1") {
    findings.push(`${start[1]} 的第一个镜头标记须为 [Shot 1]。`);
  } else {
    let previousCut = 0;
    for (const [index, marker] of shotMarkers.entries()) {
      const number = Number(marker[1]);
      if (number !== index + 1) {
        findings.push("多个镜头应按 [Shot 1]、[Shot 2] 顺序连续编号，不跳号、不重复。");
        break;
      }
      const following = shotBody.slice((marker.index ?? 0) + marker[0].length,
        shotMarkers[index + 1]?.index);
      if (index === 0) {
        if (/^\s*At\s+\d{2}:\d{2}/i.test(following))
          findings.push("[Shot 1] 应直接描述开场画面，不需要写切入时间。");
      } else {
        const time = /^\s*At\s+(\d{2}):(\d{2})\.(\d{3})(?:\b|,)/i.exec(following);
        if (!time) { findings.push(`[Shot ${number}] 必须以 At MM:SS.mmm 标出切镜时点。`); continue; }
        const at = Number(time[1]) * 60 + Number(time[2]) + Number(time[3]) / 1000;
        if (at <= previousCut || at >= setup.duration)
          findings.push(`[Shot ${number}] 的切镜时间必须递增且处于视频总时长内。`);
        previousCut = at;
      }
    }
    if (shotMarkers.length > 1 && requiresContinuousTake(prepared.shot))
      findings.push("用户明确要求单镜到底，但正文包含多个镜头；需保持一个 [Shot 1]。");
  }
  if (/<d>/.test(timeline.slice(0, opening?.index ?? timeline.length))) findings.push("对白须放进实际发声的 [Shot N]，并位于首个镜头标记之后。");
  const tags = new Set([...prompt.matchAll(/<(?:Picture|Video|Audio) \d+>/g)].map(match => match[0]));
  const approved = new Set(setup.references.map(item => item.label));
  if ([...tags].some(tag => !approved.has(tag)) || (format === "h3Ref2va" && [...approved].some(tag => !tags.has(tag)))) {
    findings.push("参考标签须覆盖实际引用，且编号只能来自准备结果。");
  }
  if (format === "h3Ref2va") {
    const definitions = prompt.slice(headings[0]!.index + headings[0]![0].length, headings[1]!.index);
    const subjects = [...definitions.matchAll(/^[\t ]*<Subject ([1-9]\d*)>/gm)].map(match => match[1]!);
    const used = [...prompt.matchAll(/<Subject (\d+)>/g)].map(match => match[1]!);
    if (subjects.length !== new Set(subjects).size) findings.push("每个 Subject 只能定义一次。");
    if (used.some(id => !subjects.includes(id))) findings.push("存在未在 subject_definitions 中定义的 Subject。");
    const retention = prompt.slice(headings[2]!.index + headings[2]![0].length, headings[3]!.index);
    if (subjects.some(id => !retention.includes(`<Subject ${id}>`))) findings.push("retention_analysis 必须覆盖每个已定义 Subject。");
  }
  if ((prompt.match(/<\/?d\b[^>]*>/gi)?.length ?? 0) !== (timeline.match(/<\/?d\b[^>]*>/gi)?.length ?? 0)) findings.push("对白只能出现在镜头时间轴中。");
  const dialogue = inspectDialogue(timeline, prepared.shot.lockedDialogue, prepared.audioEnabled, prepared.shot.voiceCast, format === "h3Ref2va");
  findings.push(...dialogue.findings);
  if (!/\p{Script=Han}/u.test(promptZh)) findings.push("提供与英文事实一致的简体中文对照。");
  // 跳过对白和引号原文，保留正文行号供定向返修。
  const narration = prompt.replace(/<d>[\s\S]*?<\/d>|"[^"\n]*"/gi, match => match.replace(/[^\r\n]/g, " "));
  if (/\[[^\[\]\n]*\p{Script=Han}[^\[\]\n]*\]/u.test(narration)) {
    findings.push("英文正文仍有未替换的模板占位词，请写入镜头中的真实对象或动作。");
  }
  for (const match of narration.matchAll(/\b(?:no subtitles|no dialogue)\b/gi)) {
    const line = narration.slice(0, match.index).split("\n").length;
    const correction = match[0].toLowerCase() === "no dialogue"
      ? "可检查是否已写清本镜实际能听见的声音和人物动作。"
      : "可检查字幕要求是否与当前画面和制作合同一致。";
    dialogue.warnings.push(`英文正文第 ${line} 行含「${match[0]}」。${correction}`);
  }
  return { findings, warnings: dialogue.warnings };
}

/** 检查节点当前正文，不调用模型。 */
export function inspectCurrentVideoPrompt(prepared: PromptInspectionContext) {
  if (!prepared.nodeDraft) throw new Error("请指定实际视频节点");
  const { prompt, promptZh } = prepared.nodeDraft;
  const { findings, warnings } = inspectDraft({ prompt, promptZh: promptZh ?? "" }, prepared);
  return { status: findings.length ? "needsRevision" : "ok", findings, warnings: [...(prepared.contextWarnings ?? []), ...warnings], revision: prepared.revision };
}
