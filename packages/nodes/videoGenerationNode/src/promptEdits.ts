export type PromptEdit = { field: "prompt" | "promptZh"; before: string; after: string };

/** 所有替换均以同一份原稿定位；先检查全部位置，再修改，避免替换链和局部提交。 */
export function applyPromptEdits(original: { prompt: string; promptZh: string }, edits: readonly PromptEdit[]) {
  if (!edits.length) throw new Error("请提供需要替换的原文");
  const result = { ...original };
  for (const field of ["prompt", "promptZh"] as const) {
    const source = original[field];
    const ranges = edits.filter(edit => edit.field === field).map(({ before, after }) => {
      const start = before ? source.indexOf(before) : -1;
      if (start < 0) throw new Error(field + " 中找不到指定原文，请重新读取当前提示词");
      if (source.indexOf(before, start + 1) >= 0) throw new Error(field + " 中原文出现多次，请带上能唯一定位的上下文");
      return { start, end: start + before.length, after };
    }).sort((a, b) => a.start - b.start);
    let cursor = 0;
    let text = "";
    for (const range of ranges) {
      if (range.start < cursor) throw new Error("替换范围重叠，请合并为一次精确替换");
      text += source.slice(cursor, range.start) + range.after;
      cursor = range.end;
    }
    result[field] = text + source.slice(cursor);
  }
  if (!result.prompt.trim()) throw new Error("视频提示词不能为空");
  return result;
}
