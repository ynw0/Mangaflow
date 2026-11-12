import { DEFAULT_H3_SPEECH_RATE, defaultH3SpeechCue } from "@/agent/creativeKnowledge/voiceTemplates";

export const endingReserveSeconds = 0.2;

export function getVideoSpeechPolicy(audioEnabled: boolean) {
  return {
    audioEnabled,
    defaultSpeechRateMultiplier: DEFAULT_H3_SPEECH_RATE,
    defaultSpeechCue: defaultH3SpeechCue,
    endingReserveSeconds,
    note: "有对白且启用同期音轨时采用清晰连贯、自然偏快的日常口语，停顿紧凑并保留自然语气。镜头明确要求慢声、迟疑、拖腔或庄重缓述时相应放慢。台词及必要停顿须在可用时长内完成，语速提示不保证实际倍速。未绑定真实音频素材时不虚构音频标签。",
  };
}

export function inspectDialogue(timeline: string, duration: number, segments: { index: number; number: string; start: number }[]) {
  const findings: string[] = [];
  const allBlocks = [...timeline.matchAll(/<d>((?:(?!<\/?d>)[\s\S])*?)<\/d>/g)];
  if (allBlocks.length !== (timeline.match(/<d>/g)?.length ?? 0) || allBlocks.length !== (timeline.match(/<\/d>/g)?.length ?? 0)
    || (timeline.match(/<\/?d\b[^>]*>/gi)?.length ?? 0) !== allBlocks.length * 2) {
    findings.push("对白 <d> 标签须成对闭合且不能嵌套。");
  }
  for (const [index, segment] of segments.entries()) {
    const body = timeline.slice(segment.index, segments[index + 1]?.index);
    let previousEnd = 0;
    let seconds = 0;
    for (const block of body.matchAll(/<d>([\s\S]*?)<\/d>/g)) {
      const language = /^\s*\[([A-Za-z][A-Za-z -]*)\]\s*([\s\S]*?)\s*$/.exec(block[1]!);
      if (!language || /^[a-z]{2}(?:[-_][a-z]+)*$/i.test(language[1]!) || !language[2]) {
        findings.push(`Shot ${segment.number} 的对白须使用语言全称与非空原文。`);
      }
      const speaker = body.slice(previousEnd, block.index);
      if (!/\(S[1-9]\d*(?:,S[1-9]\d*)*\)/.test(speaker)) findings.push(`Shot ${segment.number} 的每段对白前须标明说话人 (S1) 或 (S1,S2)。`);
      // 只拦截明确缺少开口描述的独立句，保留自然语言里的动作和语气。
      const bareSpeech = /(?:^|[.!?。！？]\s+|\n)\s*(?:\[Shot \d+\]\s*(?:At \d{2}:\d{2}\.\d{3}\s*)?)?(?:<Subject [1-9]\d*>\s*)+\(S[1-9]\d*(?:,S[1-9]\d*)*\)\s*(?:(?:says?|asks?|replies|speaks?)\s*)?[:,]?\s*$/i;
      if (bareSpeech.test(speaker)) findings.push(`Shot ${segment.number} 的对白须写明开口动作或语气，例如 turns toward the worker and says 或 says quietly。`);
      previousEnd = block.index + block[0].length;
      // ACT: 按项目规则估算中文 4 字/秒、英文 3 词/秒；只检查整个时间段也容纳不下的情况，不代替语音实测。
      const text = language?.[2] ?? "";
      seconds += (text.match(/\p{Script=Han}/gu)?.length ?? 0) / 4 + (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0) / 3;
    }
    const segmentEnd = segments[index + 1]?.start ?? duration;
    const available = Math.min(segmentEnd, duration - endingReserveSeconds) - segment.start;
    if (seconds > 0 && Number.isFinite(available) && seconds - Math.max(available, 0) > 1e-6) {
      const reserve = segmentEnd > duration - endingReserveSeconds ? `（镜尾保留 ${endingReserveSeconds} 秒）` : "";
      findings.push(`Shot ${segment.number} 的对白估算需要 ${seconds.toFixed(1)} 秒，该段只剩 ${Math.max(available, 0).toFixed(1)} 秒${reserve}。请提前开口、延长镜头或按合同拆镜。`);
    }
  }
  return findings;
}
