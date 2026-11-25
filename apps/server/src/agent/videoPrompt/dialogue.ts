export const endingReserveSeconds = 0.2;
export const maxVideoDialogueLines = 64;
const voiceoverPhrase = "says in an off-screen voiceover";
const voiceoverSources = new Set(["vs02", "vs03", "vs04", "vs05", "vs06", "vs07"]);

export function getVideoSpeechPolicy(audioEnabled: boolean) {
  return {
    audioEnabled,
    paceGuidance: "语速按人物、情绪及台词时长安排。未指定时可省略；明确要求倍数时，可在说话动作中写 at 1.1x normal conversational speed 等。倍数是自然语言引导，不保证精确执行。",
    endingReserveSeconds,
    voiceover: {
      phrase: voiceoverPhrase,
      identity: "所有 H3 模式中，画外音、旁白、角色内心独白和无实体的网文系统对白在 (Sx) 后使用 phrase 原文。每段 </d> 后紧接一句，说明对应画面人物在这段发声期间嘴唇保持闭合。空镜写明无人入画。现场人物在构图外正常开口时写实际方向和听者。内心独白与同一角色的现场对白共用声线及编号。",
      timing: "现场对白可以被同场人物听见，听觉范围按剧本写。只给观众听的旁白与独白不改变画中人的反应。角色的口型按实际发声和可见范围写。提示音写作音效，实际参考音频才使用 <Audio N>。",
    },
    note: "有同期对白时按实际表演需要在对白标签外描述语速；未指定不必写，不另设全局语速段落。保留剧本原话。endingReserveSeconds 是镜头结束前预留时间的参考值，具体安排应符合这场戏的需要。抢话时保留各自的 <d> 和原话，关键内容仍需听清。按字数估算的时长仅用于提示风险，实际说话效果以成片为准。",
  };
}

export function readDialogueBlocks(timeline: string) {
  return [...timeline.matchAll(/<d>((?:(?!<\/?d>)[\s\S])*?)<\/d>/g)];
}

export function inspectLockedDialogue(timeline: string, lockedDialogue?: readonly string[], audioEnabled?: boolean) {
  const findings: string[] = [];
  const allBlocks = readDialogueBlocks(timeline);
  if (audioEnabled === false && (allBlocks.length || lockedDialogue?.length)) {
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
  for (const [index, block] of allBlocks.entries()) {
    const language = /^\s*\[([A-Za-z][A-Za-z -]*)\]\s*([\s\S]*?)\s*$/.exec(block[1]!);
    if (!language || /^[a-z]{2}(?:[-_][a-z]+)*$/i.test(language[1]!) || !language[2]) {
      findings.push(`第 ${index + 1} 句对白须使用语言全称与非空原文，格式为 <d>[Language] 原话</d>。`);
    } else if (lockedDialogue?.[index] !== undefined && language[2] !== lockedDialogue[index]) {
      findings.push(`第 ${index + 1} 句对白与锁定原话不一致，应为「${lockedDialogue[index]}」。`);
    }
  }
  return findings;
}

export function inspectDialogue(timeline: string, lockedDialogue?: readonly string[], audioEnabled?: boolean,
  voiceCast?: readonly { speakerId: string; characterName?: string; sourceId?: string }[], ref2va = false) {
  const findings: string[] = [];
  const warnings: string[] = [];
  const allBlocks = readDialogueBlocks(timeline);
  findings.push(...inspectLockedDialogue(timeline, lockedDialogue, audioEnabled));
  let previousBlockEnd = 0;
  const sources = new Map(voiceCast?.map(role => [role.speakerId, role]));
  // 按实际对白首次出现的顺序编号，整段视频共用同一组编号，不随内部切镜重置。
  const spoken = new Set<string>();
  for (const [index, block] of allBlocks.entries()) {
    const label = `第 ${index + 1} 句对白`;
    const preceding = timeline.slice(previousBlockEnd, block.index);
    previousBlockEnd = block.index + block[0].length;
    const speakerMatch = [...preceding.matchAll(/\((S[1-9]\d*(?:,\s*S[1-9]\d*)*)\)/g)].at(-1);
    const speakerIds = speakerMatch?.[1]?.replace(/\s+/g, "").split(",") ?? [];
    if (!speakerMatch) {
      findings.push(`${label}前须标明说话人 (S1) 或 (S1,S2)。`);
    } else {
      if (new Set(speakerIds).size !== speakerIds.length) {
        findings.push(`${label}的说话人编号不得重复。`);
      }
      for (const id of speakerIds) {
        if (spoken.has(id)) continue;
        const expected = `S${spoken.size + 1}`;
        const name = sources.get(id)?.characterName;
        if (id !== expected) {
          findings.push(`${label}首次发声的${name ? `角色「${name}」` : "说话人"}使用 ${id}，应为 ${expected}。每次独立生成视频从 S1 连续编号，内部切镜不重新编号。核对定稿并统一英文正文与中文对照；若合同编号本身错误，请退回调用方修正合同，不得交换台词或声线。`);
        }
        spoken.add(id);
      }
      const originalDelivery = preceding.slice(speakerMatch.index + speakerMatch[0].length);
      const delivery = originalDelivery.toLowerCase();
      const voiceover = /\bvoice[- ]?over\b/.test(delivery)
        || /^\s*\(off[- ]screen\)/.test(delivery)
        || /\b(?:speaks?|says?|asks?|replies|calls?|narrates?)\s+(?:from\s+)?off[- ]screen\b/.test(delivery);
      for (const speakerId of speakerIds) {
        const sourceId = sources.get(speakerId)?.sourceId;
        if (sourceId === "vs01" && voiceover) {
          findings.push(`${label}的 ${speakerId} 选了画内对白，正文却标成画外音。请按剧本核对声源和配置。`);
        }
      }
      // 现场人物在镜外说话也可能标有 off-screen，须和叙事画外音区分。
      if (speakerIds.some(id => voiceoverSources.has(sources.get(id)?.sourceId ?? "")) || /\bvoice[- ]?over\b/.test(delivery)) {
        // 只看紧挨本句说话人编号的主体引用，前面的画面动作可以正常引用同一角色。
        if (ref2va && /<Subject [1-9]\d*>\s*$/.test(preceding.slice(0, speakerMatch.index))) {
          findings.push(`${label}把画面主体直接标成了画外音的发声者。请分开写主体的可见动作和实际声源，由角色的内心声音、旁白或系统声沿用本句编号和原话。`);
        }
        if (!originalDelivery.includes(voiceoverPhrase)) findings.push(`${label}须在说话人编号后使用固定短语 ${voiceoverPhrase}。`);
        // 只读本段结束后的第一句，不能借用下一句台词或下一镜的闭口说明。
        const after = timeline.slice(previousBlockEnd, allBlocks[index + 1]?.index);
        const firstSentence = after.trimStart().replace(/^[.!?。！？]["'”’]?\s*/, "").split(/[.!?。！？\n\[]|<(?!Subject [1-9]\d*>)/, 1)[0] ?? "";
        const closed = /\b(?:lips?|mouths?)\b[^;:.!?]*?\b(?:closed|shut|sealed)\b/i.test(firstSentence);
        const emptyFrame = /\bno\s+(?:one|people|persons?|characters?|faces?)\b[^;:.!?]*?\b(?:visible|on[- ]screen|in (?:the )?(?:frame|shot)|appears?)\b/i.test(firstSentence);
        if (!closed && !emptyFrame) findings.push(`${label}的 </d> 后须立即说明对应画面人物在发声时嘴唇保持闭合；空镜写明无人入画。`);
      }
    }
  }
  for (const role of voiceCast ?? []) {
    if (!spoken.has(role.speakerId)) {
      findings.push(`声音配置中的${role.characterName ? `角色「${role.characterName}」` : "说话人"} (${role.speakerId}) 在本视频没有实际对白。请对照定稿核对是否遗漏原话；如果该角色没有发声，则退回调用方移除其说话人配置，不为未发声的人物分配 S 编号。`);
    }
  }
  return { findings, warnings };
}
