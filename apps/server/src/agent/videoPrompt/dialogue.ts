import { DEFAULT_H3_SPEECH_RATE, defaultH3SpeechCue } from "@/agent/creativeKnowledge/voiceTemplates";
import type { DraftCinematicPlan } from "@/utils/production/videoPlan";

export const endingReserveSeconds = 0.2;
const timeTolerance = 1e-6;
const voiceoverPhrase = "says in an off-screen voiceover";

export function getVideoSpeechPolicy(audioEnabled: boolean) {
  return {
    audioEnabled,
    defaultSpeechRateMultiplier: DEFAULT_H3_SPEECH_RATE,
    defaultSpeechCue: defaultH3SpeechCue,
    endingReserveSeconds,
    voiceover: {
      phrase: voiceoverPhrase,
      identity: "旁白和内心独白在说话人编号后标明画外发声，纯文本和首尾帧按指南使用 phrase。台词外写实际声源与 (Sx)，<d> 内只放语言标签与原台词。独立系统声和旁白按本视频首次发声顺序编号；内心独白与同一角色的画内对白共用声线及编号。",
      timing: "每段画外发声纳入 cinematicPlan.dialogue。按剧本标明谁听得见；观众旁白不驱动画中人物反应。对应人物入画且未开口时，交代口型保持静止，其他人继续剧本中的行为。提示音写作音效，实际参考音频才使用 <Audio N>。",
    },
    note: "启用同期音轨时按剧本和已确认的语速说原话。按起声顺序记录开口、收句、停顿和前置动作，镜尾保留 0.2 秒。定稿明确安排抢话时，每人保留自己的 <d> 和原话，关键内容仍需听清。字数估时提示风险，实际发声以成片为准。实际参考音频才使用音频标签。",
  };
}

export function readDialogueBlocks(timeline: string) {
  return [...timeline.matchAll(/<d>((?:(?!<\/?d>)[\s\S])*?)<\/d>/g)];
}

export function inspectDialogue(timeline: string, duration: number, plan: DraftCinematicPlan, lockedDialogue?: readonly string[], audioEnabled?: boolean,
  voiceCast?: readonly { speakerId: string; sourceId?: string }[]) {
  const findings: string[] = [];
  const warnings: string[] = [];
  const allBlocks = readDialogueBlocks(timeline);
  if (audioEnabled === false && (allBlocks.length || plan.dialogue.length)) {
    findings.push("同期音轨已关闭，稿件却安排了发声。请核对音轨与制作合同；已批准的台词须保留。");
  }
  // 只按本镜锁定原话逐句核对，邻镜引用与画面文字不参与。
  if (lockedDialogue && lockedDialogue.length !== allBlocks.length) {
    findings.push(`本镜锁定了 ${lockedDialogue.length} 句台词，正文有 ${allBlocks.length} 句，请按原顺序保留全部原话。`);
  }
  if (allBlocks.length !== (timeline.match(/<d>/g)?.length ?? 0) || allBlocks.length !== (timeline.match(/<\/d>/g)?.length ?? 0)
    || (timeline.match(/<\/?d\b[^>]*>/gi)?.length ?? 0) !== allBlocks.length * 2) {
    findings.push("对白 <d> 标签须成对闭合且不能嵌套。");
  }
  if (allBlocks.length !== plan.dialogue.length) {
    findings.push(`正文有 ${allBlocks.length} 段 <d>，cinematicPlan.dialogue 有 ${plan.dialogue.length} 项，请按出现顺序逐句对应。`);
  }
  let previousBlockEnd = 0;
  let previousSpeechStart = 0;
  let previousSpeechEnd = 0;
  const sources = new Map(voiceCast?.map(({ speakerId, sourceId }) => [speakerId, sourceId]));
  for (const [index, block] of allBlocks.entries()) {
    const label = `第 ${index + 1} 句对白`;
    const language = /^\s*\[([A-Za-z][A-Za-z -]*)\]\s*([\s\S]*?)\s*$/.exec(block[1]!);
    if (!language || /^[a-z]{2}(?:[-_][a-z]+)*$/i.test(language[1]!) || !language[2]) {
      findings.push(`${label}须使用语言全称与非空原文。`);
    }
    const preceding = timeline.slice(previousBlockEnd, block.index);
    if (lockedDialogue?.[index] !== undefined && language?.[2] !== lockedDialogue[index]) {
      findings.push(`${label}与锁定原话不一致，应为「${lockedDialogue[index]}」。`);
    }
    previousBlockEnd = block.index + block[0].length;
    const speakerMatch = [...preceding.matchAll(/\((S[1-9]\d*(?:,\s*S[1-9]\d*)*)\)/g)].at(-1);
    const speakerIds = speakerMatch?.[1]?.replace(/\s+/g, "").split(",") ?? [];
    if (!speakerMatch) {
      findings.push(`${label}前须标明说话人 (S1) 或 (S1,S2)。`);
    } else {
      // 只核对明确选定的画内对白、旁白和内心独白，其余声源按剧本审核。
      const delivery = preceding.slice(speakerMatch.index + speakerMatch[0].length).toLowerCase();
      const voiceover = /\bvoice[- ]?over\b/.test(delivery)
        || /^\s*\(off[- ]screen\)/.test(delivery)
        || /\b(?:speaks?|says?|asks?|replies|calls?|narrates?)\s+(?:from\s+)?off[- ]screen\b/.test(delivery);
      for (const speakerId of speakerIds) {
        const sourceId = sources.get(speakerId);
        if (sourceId === "vs01" && voiceover) {
          findings.push(`${label}的 ${speakerId} 选了画内对白，正文却标成画外音。请按剧本核对声源和配置。`);
        }
        if ((sourceId === "vs02" || sourceId === "vs03") && !voiceover) {
          findings.push(`${label}的 ${speakerId} 选了旁白或内心独白，正文须按画外音格式标明声源。若剧本要求画内开口，先修正声源配置。`);
        }
      }
    }

    const line = plan.dialogue[index];
    if (!line) continue;
    if (speakerIds.length && speakerIds.join(",") !== line.speakerIds.join(",")) {
      findings.push(`${label}正文说话人为 (${speakerIds.join(",")})，规划为 (${line.speakerIds.join(",")})，请核对角色。`);
    }
    if (line.startSeconds < previousSpeechStart - timeTolerance) {
      findings.push(`${label}的起声早于上一句，须按实际起声顺序排列对白计划和 <d>。`);
    } else if (line.startSeconds < previousSpeechEnd - timeTolerance) {
      warnings.push(`${label}在 ${line.startSeconds} 秒开口，与前面的台词交叠。审核按定稿判断交叠是否有依据，成片核对关键台词是否听清。`);
    }
    previousSpeechStart = line.startSeconds;
    previousSpeechEnd = Math.max(previousSpeechEnd, line.endSeconds);
    if (line.endSeconds <= line.startSeconds) findings.push(`${label}结束时间须晚于开口时间。`);
    if (line.endSeconds > duration - endingReserveSeconds + timeTolerance) {
      findings.push(`${label}在 ${line.endSeconds} 秒才结束，须在 ${(duration - endingReserveSeconds).toFixed(2)} 秒前说完，给镜尾留 ${endingReserveSeconds} 秒。`);
    }
    if (line.afterBeat !== undefined) {
      const beat = plan.beats[line.afterBeat - 1];
      if (!beat) findings.push(`${label}引用了不存在的前置节拍 ${line.afterBeat}。`);
      else if (line.startSeconds < beat.endSeconds - timeTolerance) {
        findings.push(`${label}须等节拍 ${line.afterBeat}（${beat.action}）在 ${beat.endSeconds} 秒完成，规划却在 ${line.startSeconds} 秒开口。`);
      }
    }
    // ACT: 字速是保守估算。句内停顿按导演计划单独计入，1.3 倍是表演指令。
    const text = language?.[2] ?? "";
    const speechSeconds = (text.match(/\p{Script=Han}/gu)?.length ?? 0) / 4
      + (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0) / 3;
    const windowSeconds = line.endSeconds - line.startSeconds;
    if (windowSeconds > 0 && speechSeconds + line.pauseSeconds > windowSeconds + timeTolerance) {
      warnings.push(`${label}留了 ${windowSeconds.toFixed(2)} 秒，按字数粗估需 ${(speechSeconds + line.pauseSeconds).toFixed(2)} 秒（含停顿）。成片时听验是否完整说完。`);
    }
  }
  return { findings, warnings };
}
