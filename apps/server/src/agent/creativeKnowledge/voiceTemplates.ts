/** H3 同期声音提示词库：文本指导不是声纹锁定或方言准确性的承诺。 */
export const voiceCategories = ["timbre", "emotion", "personality", "pace", "age", "foreignAccent", "dialect", "delivery"] as const;
export type VoiceCategory = (typeof voiceCategories)[number];
export type VoiceTemplate = {
  id: string;
  title: string;
  category: VoiceCategory;
  descriptionZh: string;
  englishCue: string;
  tags: string[];
  speedMultiplier?: number;
};
type VoiceRow = [id: string, title: string, descriptionZh: string, englishCue: string, tags: string, speedMultiplier?: number];
export const defaultH3SpeechCue = "speaks at a brisk, natural conversational pace, approximately 1.3 times normal speed, with crisp articulation and brief, purposeful pauses; no unnecessary slow delivery or drawn-out syllables";

const rows: Record<VoiceCategory, VoiceRow[]> = {
  timbre: [
    ["vt01", "清亮青年", "中高音清亮，咬字清楚", "bright, clean mid-high youthful timbre with crisp diction", "青年,清亮,主角"],
    ["vt02", "温润磁性", "中低音温暖、有自然胸腔共鸣", "warm, resonant mid-low voice with natural chest resonance", "温柔,磁性,可靠"],
    ["vt03", "粗粝沙哑", "低音、微沙哑但字词清晰", "low and subtly raspy textured voice, with distinct consonants", "反派,粗粝,沙哑"],
    ["vt04", "少年明快", "偏高音区、气息轻盈", "light and energetic higher-pitched youthful voice", "少年,青春,活泼"],
    ["vt05", "成熟厚重", "低音稳定、厚实但不压喉", "mature full-bodied low voice with unforced resonance", "成熟,厚重,权威"],
    ["vt06", "柔软气声", "轻柔、有少许空气感", "soft breath-edged tone with intelligible speech", "气声,轻柔,亲密"],
    ["vt07", "清脆利落", "字头干净、句尾短促", "crisp clean-edged voice with decisive phrase endings", "干练,清脆,果断"],
    ["vt08", "疲惫干涩", "轻微干涩低能量，仍能听清", "slightly dry and weary timbre with clear diction", "疲倦,虚弱,沧桑"],
    ["vt09", "紧绷鼻音", "稍高音域、轻微鼻腔紧张感", "slightly high, tense and nasal-edged voice without shrillness", "紧张,反差,搞怪"],
    ["vt10", "机械合成", "平稳音高、精确清晰、机械感", "steady, precisely articulated synthesized-sounding voice", "系统,机械,AI"],
    ["vt11", "细窄冷亮", "偏中高音、共鸣靠前，字头清脆，收尾短", "narrow forward mid-high resonance, crisp onsets and short releases", "冷亮,辨识度,锋利"],
    ["vt12", "宽厚中音", "中音区共鸣宽，元音圆润，弱读字仍清楚", "broad mid-range resonance with rounded vowels and clear unstressed syllables", "中音,圆润,辨识度"],
    ["vt13", "干净低柔", "贴近说话的低音，音量轻，字音轮廓清楚", "clean close low register with soft volume and defined syllables", "低柔,贴近,辨识度"],
  ],
  emotion: [
    ["ve01", "克制愤怒", "低音量，关键词重读，尾音收紧", "restrained anger, controlled volume and clipped emphatic endings", "愤怒,克制,冲突"],
    ["ve02", "突然震惊", "停顿后急促吐出关键句", "brief stunned pause, then an urgent clearly spoken phrase", "震惊,惊讶,反应"],
    ["ve03", "狂喜兴奋", "音调上扬，节奏明快", "delighted excitement, brighter pitch and lively rhythm", "兴奋,狂喜,快乐"],
    ["ve04", "悲伤强忍", "声音发紧、偶有短暂停顿", "suppressed sadness, gently constricted tone and short pauses", "悲伤,隐忍,告别"],
    ["ve05", "焦虑慌张", "急促短呼吸，不吞字", "anxious urgency with short breaths and intelligible words", "焦虑,慌张,危险"],
    ["ve06", "冷漠疏离", "语调收敛、句尾干脆", "cool detachment with restrained pitch changes", "冷漠,理性,高冷"],
    ["ve07", "冷笑威胁", "含笑轻讽、重读关键词", "low dry sarcasm with a faint smile and pointed stress", "嘲讽,冷笑,反派"],
    ["ve08", "温柔安慰", "温和、平缓、亲切起伏", "gentle reassuring tone with warm pitch movement", "温柔,安慰,亲情"],
    ["ve09", "坚定决绝", "字头扎实、短句有力", "resolute conviction, firm consonants and decisive phrasing", "坚定,决绝,热血"],
    ["ve10", "惊恐低语", "压低音量、气息紧绷", "frightened hushed delivery with tense audible breaths", "惊恐,低语,悬疑"],
    ["ve11", "得意自满", "语气微扬、带笑", "self-satisfied delivery with a subtle smile and buoyant endings", "得意,炫耀,喜剧"],
    ["ve12", "平静释然", "呼气后轻柔收尾", "relieved calm with a gentle exhale and softer phrase ending", "释然,平静,温暖"],
    ["ve13", "礼貌施压", "表面礼貌，提出要求时短促重读", "outwardly courteous delivery with compact stress on the demand", "礼貌,施压,谈判"],
    ["ve14", "犹豫后确定", "开口前留一次短促吸气，随后清晰说完", "one short preparatory inhale before a hesitant opening that settles into clear speech", "迟疑,犹豫,吸气"],
  ],
  personality: [
    ["vp01", "理性工程师", "逻辑清晰、解释精准、重读术语", "precise analytical delivery, concise and slightly emphasizing technical terms", "工程师,技术,理性"],
    ["vp02", "狡黠商人", "含笑试探，转折处突然加重", "wily, teasing delivery with playful pauses and sudden emphasis", "商人,狡黠,反派"],
    ["vp03", "沉稳领导", "停顿从容，少用强重音", "composed authoritative delivery with confident measured pauses", "领导,权威,沉稳"],
    ["vp04", "直爽青年", "短句直接、开朗坦率", "forthright youthful delivery with candid direct phrases", "青年,直爽,朋友"],
    ["vp05", "毒舌吐槽", "冷静表面下重读讽刺词", "deadpan witty delivery with precisely placed sarcastic stress", "毒舌,吐槽,搞笑"],
    ["vp06", "胆小谨慎", "轻声试探，句首略犹豫", "cautious, tentative openings with soft checking intonation", "胆小,谨慎,焦虑"],
    ["vp07", "热血冲动", "情绪饱满、开口迅速", "impulsive energetic delivery with rapid engagement", "热血,冲动,主角"],
    ["vp08", "慈祥长者", "温柔耐心，句尾下落舒缓", "kind elder-like delivery with patient warm cadence", "慈祥,长者,亲情"],
    ["vp09", "审慎质问者", "问句紧凑，关键信息略重读，句尾有分寸地下落", "compact questioning with precise stress on key details and a measured downward release", "质问,审慎,冷静"],
    ["vp10", "热心邻居", "音量亲近，语调随回应自然扬落，紧凑接话", "friendly close-range voice with responsive rises and falls and quick turn-taking", "亲切,街坊,自然"],
    ["vp11", "朴实务实", "句子短实，咬字松弛，谈到具体物件时重读", "plainspoken delivery with relaxed diction and stress on concrete details", "务实,朴实,短句"],
  ],
  pace: [
    ["vr01", "默认自然偏快", "比普通对话略快，换气自然", defaultH3SpeechCue, "默认,1.3倍,自然", 1.3],
    ["vr02", "轻快", "活跃紧凑，停顿自然", "lively quick cadence with natural breath gaps", "轻快,欢快,节奏", 1.15],
    ["vr03", "紧急快语", "明显加速但不含混", "urgently fast yet intelligible delivery", "急促,紧张,快语", 1.5],
    ["vr04", "沉稳慢速", "慢一点、停顿有分量", "deliberate measured cadence and weighted pauses", "慢速,沉稳,权威", 0.9],
    ["vr05", "缓慢低语", "拉开间隔、低声清楚", "slow hushed phrases with discreet pauses", "低语,秘密,悬疑", 0.8],
    ["vr06", "连续快嘴", "语句密集但不吞字", "rapid-fire conversational delivery with clear diction", "快嘴,喜剧,吐槽", 1.65],
    ["vr07", "庄重缓述", "镜头明确要求庄重时放缓，关键停顿短而有分量", "ceremonial measured delivery with clear diction and deliberate pauses at key phrases", "庄重,慢声,宣告", 0.85],
  ],
  age: [
    ["va01", "稚嫩童声感", "稚嫩轻高音，避免成人腔", "childlike voice impression, light high pitch and youthful articulation", "儿童,稚嫩,童声"],
    ["va02", "青春少年感", "中高音、未成熟的声带质感", "adolescent voice impression, slightly high with mild vocal instability", "少年,青春,校园"],
    ["va03", "二十出头青年感", "清亮有弹性", "early-twenties voice impression, clear and flexible natural speech", "青年,二十岁,主角"],
    ["va04", "成熟三四十岁感", "共鸣稳定、语调自持", "adult voice impression in the thirties or forties, steady resonance", "成年,成熟,中年"],
    ["va05", "五六十岁阅历感", "略粗、气息稳定，不刻意虚弱", "seasoned older-adult voice impression with subtle texture", "中老年,沧桑,阅历"],
    ["va06", "高龄长者感", "自然换气或轻颤，不夸张", "elderly voice impression with subtle breath breaks, never exaggerated", "高龄,老年,长者"],
  ],
  foreignAccent: [
    ["vf01", "英语母语者说中文", "普通话原文，轻微英语韵律迁移", "intelligible Mandarin with subtle English-first-language stress timing and tone influence", "外国人说中文,英语口音,英语母语"],
    ["vf02", "美式英语背景说中文", "普通话流利、轻微美式英语节奏", "fluent Mandarin with a mild American-English-influenced rhythm", "外国人说中文,美式,英语背景"],
    ["vf03", "英式英语背景说中文", "普通话流利、轻微英式英语节奏", "fluent Mandarin with a restrained British-English-influenced cadence", "外国人说中文,英式,英语背景"],
    ["vf04", "法语背景说中文", "普通话可懂、轻微法语韵律", "intelligible Mandarin with a subtle French-language rhythmic influence", "外国人说中文,法语,法国"],
    ["vf05", "俄语背景说中文", "普通话清楚、辅音稍硬朗", "clear Mandarin with subtle Russian-language rhythm and firm consonants", "外国人说中文,俄语,俄罗斯"],
    ["vf06", "日语背景说中文", "普通话流利，音节节奏略匀", "fluent Mandarin with a gentle Japanese-language-influenced syllabic rhythm", "外国人说中文,日语,日本"],
    ["vf07", "韩语背景说中文", "普通话清晰，句尾略有韩语韵律", "clear Mandarin with a subtle Korean-language-influenced phrase cadence", "外国人说中文,韩语,韩国"],
    ["vf08", "西语背景说中文", "普通话清楚，节奏弹性略强", "clear Mandarin with a mild Spanish-language rhythmic lilt", "外国人说中文,西班牙语,拉美"],
    ["vf09", "非母语中文感", "不指定国籍，轻度非母语韵律", "fluent intelligible Mandarin with a mild unspecified non-native cadence", "外国人说中文,非母语,通用"],
  ],
  dialect: [
    ["vd01", "东北口音普通话", "普通话原词，略带东北语调", "Mandarin with a subtle Northeastern Chinese regional accent", "东北,东北话,地方口音"],
    ["vd02", "四川口音普通话", "普通话原词，略带四川语调", "Mandarin with a light Sichuan-influenced regional accent", "四川,川普,地方口音"],
    ["vd03", "重庆口音普通话", "普通话原词，略带重庆语调", "Mandarin with a mild Chongqing regional cadence", "重庆,西南,地方口音"],
    ["vd04", "广东口音普通话", "轻微粤语背景普通话声调", "Mandarin with a restrained Cantonese-influenced accent", "广东,粤普,地方口音"],
    ["vd05", "上海口音普通话", "轻微吴语背景普通话韵律", "Mandarin with a subtle Shanghainese-influenced rhythm", "上海,吴语,地方口音"],
    ["vd06", "河南口音普通话", "略带中原地域语调", "Mandarin with a light Henan regional intonation", "河南,中原,地方口音"],
    ["vd07", "山东口音普通话", "爽直、略带山东语调", "Mandarin with a mild Shandong regional cadence", "山东,北方,地方口音"],
    ["vd08", "陕西口音普通话", "略带关中地区音调", "Mandarin with a restrained Shaanxi Guanzhong-influenced intonation", "陕西,关中,地方口音"],
    ["vd09", "湖南口音普通话", "略带湘语背景韵律", "Mandarin with a subtle Hunan-influenced rhythm", "湖南,湘语,地方口音"],
    ["vd10", "福建口音普通话", "略带闽语背景韵律", "Mandarin with a slight Fujian-area Min-language-influenced cadence", "福建,闽南,地方口音"],
    ["vd11", "天津口音普通话", "清晰活泼的天津地区语调", "Mandarin with a restrained Tianjin regional pitch contour", "天津,北方,地方口音"],
    ["vd12", "台湾地区口音普通话", "轻微台湾华语日常语调", "Mandarin with subtle Taiwan-region conversational intonation", "台湾,华语,地方口音"],
  ],
  delivery: [
    ["vx01", "自然口语", "真实交流、有细微连读与停顿", "natural spontaneous conversation with slight connected speech and micro-pauses", "自然,口语,日常"],
    ["vx02", "近距离耳语", "低音量、空气感，保持清楚", "intimate close-mic hushed delivery with clear diction", "耳语,低声,秘密"],
    ["vx03", "远处呼喊", "气息支撑的远距离喊话", "projected speech directed toward someone far away, without distortion", "喊话,远处,呼叫"],
    ["vx04", "标准播报", "音量均匀、停顿规整", "even-volume announcement with clear consonants and orderly pauses", "播报,通知,系统"],
    ["vx05", "咬牙挤出", "短促、牙关紧绷仍可听懂", "short clipped words through a tense jaw, still intelligible", "咬牙,忍耐,愤怒"],
    ["vx06", "喘息间说话", "短句、可听换气、不缺词", "short phrases between audible breaths while retaining every scripted word", "喘息,奔跑,疲惫"],
    ["vx07", "含笑发言", "音色带笑、词语轻微上扬", "smiling through the words with subtle buoyant emphasis", "含笑,开心,亲切"],
    ["vx08", "冷静机械播音", "精确且节奏有序、无明显情感波动", "precise synthesized-announcement delivery with steady loudness", "机械,系统,AI"],
    ["vx09", "清晰接话", "前一位说完后自然接话，字头和换气清楚", "clean turn handoff after the previous speaker finishes, with a clear onset and natural breath", "接话,轮流说话,交锋"],
    ["vx10", "紧凑收句", "末字发清楚并收住尾音，结束后嘴唇自然闭合", "clearly articulate the final syllable, release it promptly, and close the lips naturally afterwards", "收句,闭口,镜尾"],
    ["vx11", "正经说怪话", "表面郑重，荒诞落点只给一次短重音", "straight-faced earnest delivery with one brief accent on the absurd punch beat", "抽象,搞怪,冷幽默"],
  ],
};
export const voiceTemplates: VoiceTemplate[] = voiceCategories.flatMap(category =>
  rows[category].map(([id, title, descriptionZh, englishCue, tags, speedMultiplier]) => ({
    id, title, category, descriptionZh, englishCue, tags: tags.split(","),
    ...(speedMultiplier === undefined ? {} : { speedMultiplier }),
  })));
export const DEFAULT_H3_SPEECH_RATE = 1.3;
export type VoiceCastRole = {
  speakerId: string;
  characterName: string;
  voiceIdentity?: string;
  timbreId?: string;
  ageId?: string;
  personalityId?: string;
  foreignAccentId?: string;
  dialectId?: string;
  emotionId?: string;
  deliveryId?: string;
  paceId?: string;
  speedMultiplier?: number;
};
const slots = {
  timbreId: "timbre", ageId: "age", personalityId: "personality", foreignAccentId: "foreignAccent",
  dialectId: "dialect", emotionId: "emotion", deliveryId: "delivery", paceId: "pace",
} as const;
/** 每位说话人保有独立的声音身份；情绪、语速可逐镜调整。 */
export function compileVoiceCast(cast: readonly VoiceCastRole[]) {
  const errors: string[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  const roles = cast.map(role => {
    if (seen.has(role.speakerId)) errors.push(`说话人 ${role.speakerId} 重复`);
    seen.add(role.speakerId);
    if (role.foreignAccentId && role.dialectId) errors.push(`${role.speakerId} 不能同时指定外国背景与中国地方口音`);
    if (role.paceId && role.speedMultiplier !== undefined) errors.push(`${role.speakerId} 语速模板与数值覆盖二选一`);
    const selected: VoiceTemplate[] = [];
    for (const [key, category] of Object.entries(slots) as [keyof typeof slots, VoiceCategory][]) {
      const id = role[key];
      if (!id) continue;
      const template = voiceTemplates.find(item => item.category === category && item.id === id);
      if (!template) errors.push(`${role.speakerId} ${key} 模板不存在或类型错误：${id}`);
      else selected.push(template);
    }
    const voiceIdentity = role.voiceIdentity?.trim();
    if (!voiceIdentity && !selected.some(item => ["timbre", "age", "personality"].includes(item.category))) warnings.push(`${role.speakerId} 缺少长期稳定的声音身份；仅靠情绪无法保持跨镜声线`);
    const pace = selected.find(item => item.category === "pace");
    const speedMultiplier = role.speedMultiplier ?? pace?.speedMultiplier ?? DEFAULT_H3_SPEECH_RATE;
    const identityCues = selected.filter(item => ["timbre", "age", "personality", "foreignAccent", "dialect"].includes(item.category)).map(item => item.englishCue);
    const performanceCues = selected.filter(item => ["emotion", "delivery"].includes(item.category)).map(item => item.englishCue);
    const paceCue = speedMultiplier === DEFAULT_H3_SPEECH_RATE
      ? defaultH3SpeechCue
      : [pace?.englishCue, `speaks at about ${speedMultiplier} times normal conversational pace with clear articulation`].filter(Boolean).join("; ");
    const cues = [voiceIdentity, ...identityCues, ...performanceCues, paceCue].filter(Boolean);
    return {
      speakerId: role.speakerId, characterName: role.characterName,
      ...(voiceIdentity ? { voiceIdentity } : {}),
      templateIds: selected.map(item => item.id), speedMultiplier, identityCues, performanceCues,
      promptCue: `${role.characterName} (${role.speakerId}): ${cues.join("; ")}.`,
    };
  });
  return {
    status: errors.length ? "invalid" as const : warnings.length ? "review" as const : "ok" as const,
    errors, warnings, defaultSpeedMultiplier: DEFAULT_H3_SPEECH_RATE, roles,
    guidance: "H3 生成视频时同步生成音轨。每位说话人选用符合性格且可辨别的音区、共鸣或咬字特征；固定声线跨镜复用，情绪和语速可随本镜调整。仅对白使用语速提示，口音是生成指导。保留原台词，音频引用须来自真实素材。",
  };
}
