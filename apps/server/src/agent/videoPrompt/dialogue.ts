export function inspectDialogue(timeline: string, duration: number, segments: { index: number; number: string; start: number }[]) {
  const findings: string[] = [];
  const startTime = (index: number) => segments[index]?.start ?? NaN;
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
    const available = (index + 1 < segments.length ? startTime(index + 1) : duration) - startTime(index);
    if (Number.isFinite(available) && available > 0 && seconds > available) findings.push(`Shot ${segment.number} 的对白估算需要 ${seconds.toFixed(1)} 秒，超过该段 ${available.toFixed(1)} 秒。`);
  }
  return findings;
}
