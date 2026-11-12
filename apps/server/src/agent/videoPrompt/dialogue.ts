import { DEFAULT_H3_SPEECH_RATE, defaultH3SpeechCue } from "@/agent/creativeKnowledge/voiceTemplates";

/**
 * 只用于创作前保守预算，不代表 H3 可以精确控制开口帧或实际语速。
 * 可根据真实 H3 样片的开口偏移分布再调整，不应为通过检查而提高每秒字数。
 */
export const endingReserveSeconds = 0.2;
export const speechOnsetAllowanceSeconds = 1.0;
export const speechReleaseAllowanceSeconds = 0.45;
export const speechPunctuationPauseSeconds = 0.15;

export type DialogueBeat = { index: number; number: string; start: number };

export function getVideoSpeechPolicy(audioEnabled: boolean) {
  return {
    audioEnabled,
    defaultSpeechRateMultiplier: DEFAULT_H3_SPEECH_RATE,
    defaultSpeechCue: defaultH3SpeechCue,
    endingReserveSeconds,
    speechOnsetAllowanceSeconds,
    speechReleaseAllowanceSeconds,
    speechPunctuationPauseSeconds,
    note: "单个视频节点只写一个 [Shot 1]，内部动作/对白节拍用独立的 At 00:SS.mmm 行表示，不追加切镜标签。每个有声节拍优先只有一名说话人：先为开口前动作和随机起声偏移预留时间，再给完整原台词、句内自然停顿及说完后的收束留足时间。默认自然偏快约1.3倍，但预算仍保守采用中文4字/秒、英文3词/秒；语速提示不是精确的音轨定时参数。时间不足时改变动作与说话的重叠方式或申请重新规划镜头，禁止删已确定台词。",
  };
}

function estimatedSpeechSeconds(content: string) {
  const han = content.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWords = content.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
  // 数字可能被读成完整中文数字，不按一个英文单词低估。
  const digits = content.match(/[0-9]/g)?.length ?? 0;
  const punctuation = content.match(/[，,；;：:。！？!?、]/g)?.length ?? 0;
  return han / 4 + latinWords / 3 + digits / 4 + punctuation * speechPunctuationPauseSeconds;
}

/**
 * 每一个 At 行是同一连续摄影镜头的内部时序节拍；它既不是 H3 切镜，
 * 也不保证实际模型发声恰好发生在这个时间点。
 */
export function inspectDialogue(timeline: string, duration: number, beats: DialogueBeat[]) {
  const findings: string[] = [];
  const allBlocks = [...timeline.matchAll(/<d>((?:(?!<\/?d>)[\s\S])*?)<\/d>/g)];
  if (allBlocks.length !== (timeline.match(/<d>/g)?.length ?? 0) || allBlocks.length !== (timeline.match(/<\/d>/g)?.length ?? 0)
    || (timeline.match(/<\/?d\b[^>]*>/gi)?.length ?? 0) !== allBlocks.length * 2) {
    findings.push("对白 <d> 标签须成对闭合且不能嵌套。");
  }
  for (const [index, beat] of beats.entries()) {
    const body = timeline.slice(beat.index, beats[index + 1]?.index);
    const blocks = [...body.matchAll(/<d>([\s\S]*?)<\/d>/g)];
    if (blocks.length > 1) {
      findings.push(`镜头内部 ${beat.number} 段从 ${beat.start.toFixed(1)} 秒开始含 ${blocks.length} 次对白；请为每次轮换说话人单独安排一个 At 时间节拍，不能只用整段长度估算所有人的对白。`);
    }
    let seconds = 0;
    let previousEnd = 0;
    for (const block of blocks) {
      const language = /^\s*\[([A-Za-z][A-Za-z -]*)\]\s*([\s\S]*?)\s*$/.exec(block[1]!);
      if (!language || /^[a-z]{2}(?:[-_][a-z]+)*$/i.test(language[1]!) || !language[2]) {
        findings.push(`从 ${beat.start.toFixed(1)} 秒开始的对白须使用语言全称与非空原文。`);
      }
      const preceding = body.slice(previousEnd, block.index);
      if (!/\(S[1-9]\d*(?:,S[1-9]\d*)*\)/.test(preceding)) {
        findings.push(`从 ${beat.start.toFixed(1)} 秒开始的对白前必须有说话人 (S1) 或 (S1,S2)。`);
      }
      const bareSpeech = /(?:^|[.!?。！？]\s+|\n)\s*(?:(?:\[Shot 1\]|At \d{2}:\d{2}\.\d{3},?)\s*)?(?:<Subject [1-9]\d*>\s*)+\(S[1-9]\d*(?:,S[1-9]\d*)*\)\s*(?:(?:says?|asks?|replies|speaks?)\s*)?[:,]?\s*$/i;
      if (bareSpeech.test(preceding)) findings.push(`从 ${beat.start.toFixed(1)} 秒开始的对白须写明开口动作或语气。`);
      previousEnd = block.index! + block[0].length;
      seconds += estimatedSpeechSeconds(language?.[2] ?? "");
    }
    if (seconds <= 0) continue;
    const next = beats[index + 1]?.start ?? duration;
    const end = Math.min(next, duration - endingReserveSeconds);
    const available = Math.max(0, end - beat.start);
    const required = seconds + speechOnsetAllowanceSeconds + speechReleaseAllowanceSeconds;
    if (required > available + 1e-6) {
      findings.push(`镜头内 ${beat.start.toFixed(1)}–${end.toFixed(1)} 秒对白预算不足：台词与句内停顿约 ${seconds.toFixed(2)} 秒 + 起声/前置动作缓冲 ${speechOnsetAllowanceSeconds.toFixed(2)} 秒 + 结束余量 ${speechReleaseAllowanceSeconds.toFixed(2)} 秒 = ${required.toFixed(2)} 秒，实际只有 ${available.toFixed(2)} 秒。请将该句开口提前、减少必须先完成的动作或按剧本合同调整镜头时长；不得删台词。`);
    }
  }
  return findings;
}
