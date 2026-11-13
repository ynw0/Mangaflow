import { DEFAULT_H3_SPEECH_RATE, defaultH3SpeechCue } from "@/agent/creativeKnowledge/voiceTemplates";
import type { DraftCinematicPlan } from "@/utils/production/videoPlan";

export const endingReserveSeconds = 0.2;
const timeTolerance = 1e-6;

export function getVideoSpeechPolicy(audioEnabled: boolean) {
  return {
    audioEnabled,
    defaultSpeechRateMultiplier: DEFAULT_H3_SPEECH_RATE,
    defaultSpeechCue: defaultH3SpeechCue,
    endingReserveSeconds,
    note: "启用同期音轨的对白采用清晰、自然偏快的口语；剧情明确要求时按表演放慢。按 <d> 的顺序在 cinematicPlan.dialogue 安排开口、收句、停顿及必须先完成的动作，镜尾保留 0.2 秒。对刚好够用的句子，优先提前开口或减少顺序动作，给实际起声偏移留余量。语速与时间提示只指导生成，未绑定真实音频时不虚构音频标签。",
  };
}

export function readDialogueBlocks(timeline: string) {
  return [...timeline.matchAll(/<d>((?:(?!<\/?d>)[\s\S])*?)<\/d>/g)];
}

export function inspectDialogue(timeline: string, duration: number, plan: DraftCinematicPlan) {
  const findings: string[] = [];
  const allBlocks = readDialogueBlocks(timeline);
  if (allBlocks.length !== (timeline.match(/<d>/g)?.length ?? 0) || allBlocks.length !== (timeline.match(/<\/d>/g)?.length ?? 0)
    || (timeline.match(/<\/?d\b[^>]*>/gi)?.length ?? 0) !== allBlocks.length * 2) {
    findings.push("对白 <d> 标签须成对闭合且不能嵌套。");
  }
  if (allBlocks.length !== plan.dialogue.length) {
    findings.push(`正文有 ${allBlocks.length} 段 <d>，cinematicPlan.dialogue 有 ${plan.dialogue.length} 项，请按出现顺序逐句对应。`);
  }
  let previousBlockEnd = 0;
  let previousSpeechEnd = 0;
  for (const [index, block] of allBlocks.entries()) {
    const label = `第 ${index + 1} 句对白`;
    const language = /^\s*\[([A-Za-z][A-Za-z -]*)\]\s*([\s\S]*?)\s*$/.exec(block[1]!);
    if (!language || /^[a-z]{2}(?:[-_][a-z]+)*$/i.test(language[1]!) || !language[2]) {
      findings.push(`${label}须使用语言全称与非空原文。`);
    }
    const preceding = timeline.slice(previousBlockEnd, block.index);
    previousBlockEnd = block.index + block[0].length;
    const speaker = [...preceding.matchAll(/\((S[1-9]\d*(?:,\s*S[1-9]\d*)*)\)/g)].at(-1)?.[1];
    if (!speaker) findings.push(`${label}前须标明说话人 (S1) 或 (S1,S2)。`);
    // 只拦截明确缺少开口描述的独立句，保留自然语言里的动作和语气。
    const bareSpeech = /(?:^|[.!?。！？]\s+|\n)\s*(?:\[Shot 1\]\s*)?(?:<Subject [1-9]\d*>\s*)+\(S[1-9]\d*(?:,\s*S[1-9]\d*)*\)\s*(?:(?:says?|asks?|replies|speaks?)\s*)?[:,]?\s*$/i;
    if (bareSpeech.test(preceding)) findings.push(`${label}须写明开口动作或语气。`);

    const line = plan.dialogue[index];
    if (!line) continue;
    if (speaker && speaker.replace(/\s+/g, "") !== line.speakerIds.join(",")) {
      findings.push(`${label}正文说话人为 (${speaker})，规划为 (${line.speakerIds.join(",")})，请核对角色。`);
    }
    if (line.startSeconds < previousSpeechEnd - timeTolerance) findings.push(`${label}在 ${line.startSeconds} 秒开口，与前句重叠；齐声请写成同一个 <d>。`);
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
      findings.push(`${label}的窗口为 ${line.startSeconds}–${line.endSeconds} 秒（${windowSeconds.toFixed(2)} 秒），口播约 ${speechSeconds.toFixed(2)} 秒，另有计划停顿 ${line.pauseSeconds} 秒。请重排动作和开口时间，或调整镜头时长，保留原台词。`);
    }
  }
  return findings;
}
