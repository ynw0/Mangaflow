/** H3 同期声音提示词库：文本指导不是声纹锁定或方言准确性的承诺。 */
export const voiceCategories = ["timbre", "emotion", "personality", "pace", "age", "foreignAccent", "dialect", "delivery", "source"] as const;
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
export function speechRateCue(multiplier: number) {
  return `speaks at about ${multiplier === 1 ? "1.0" : multiplier} times their usual conversational pace, with clear words and natural pauses`;
}

const rows: Record<VoiceCategory, VoiceRow[]> = {
  timbre: [
    ["vt01", "清亮的青年声线", "中高音清亮，咬字清楚", "bright, clean mid-high youthful timbre with crisp diction", "青年,清亮,主角"],
    ["vt02", "温润而富有磁性的声音", "中低音温暖、有自然胸腔共鸣", "warm, resonant mid-low voice with natural chest resonance", "温柔,磁性,可靠"],
    ["vt03", "粗粝沙哑", "低音略沙哑，词音仍清楚", "low, slightly raspy voice with clear words", "低音,粗粝,沙哑"],
    ["vt04", "明快的少年声线", "偏高音区、气息轻盈", "light and energetic higher-pitched youthful voice", "少年,青春,活泼"],
    ["vt05", "成熟厚重的低音", "低音稳定、厚实但不压喉", "mature full-bodied low voice with unforced resonance", "成熟,厚重,权威"],
    ["vt06", "柔软气声", "声音轻柔，带有少量气声", "soft breath-edged tone with intelligible speech", "气声,轻柔,亲密"],
    ["vt07", "清脆利落", "每个字开头的发音清楚，句尾收得较快", "crisp clean-edged voice with decisive phrase endings", "干练,清脆,果断"],
    ["vt08", "疲惫干涩", "声音略显干涩和疲惫，但仍能听清每个字", "slightly dry and weary timbre with clear diction", "疲倦,虚弱,沧桑"],
    ["vt09", "紧绷鼻音", "音高略高，鼻腔共鸣带有轻微紧张感", "slightly high, tense and nasal-edged voice without shrillness", "紧张,反差,搞怪"],
    ["vt10", "机械合成", "音高平稳，发音准确清楚，带有机械感", "steady, precisely articulated synthesized-sounding voice", "系统,机械,AI"],
    ["vt11", "清冷明亮、共鸣集中的中高音", "音高偏中高音区，共鸣位置靠前，每个字开头发音清脆，句尾收得较快", "narrow forward mid-high resonance, crisp onsets and short releases", "清冷明亮,辨识度,锋利"],
    ["vt12", "宽厚中音", "中音区的共鸣饱满，元音圆润，轻读的字也能听清", "broad mid-range resonance with rounded vowels and clear unstressed syllables", "中音,圆润,辨识度"],
    ["vt13", "清晰轻柔的低音", "像在近距离交谈时的低音，音量较轻，每个字仍能听清", "clean close low register with soft volume and defined syllables", "轻柔的低音,贴近,辨识度"],
    // 优先用音区、共鸣和发音质地拉开声线，停顿和语气由其他模板控制。
    ["vt14", "性别特征不明显、气声较少的合成音", "中音区，没有明显的性别特征，气声较少，每个音节清晰可辨", "gender-neutral synthetic mid-register with very little breath and sharply defined syllables", "网文系统,机械系统,电子音,中性,合成音"],
    ["vt15", "甜亮电子女声", "女声中高音，明亮略带电子泛音，齿音柔和", "bright mid-high female timbre with a gentle synthetic overtone and soft sibilants", "网文系统,女声系统,甜美,萌妹,电子音"],
    ["vt16", "低沉而富有磁性的 AI 管家声音", "中低音区的男声，声音饱满而平滑，带有轻微的电子共鸣", "smooth full-bodied mid-low male voice with a faint electronic resonance", "网文系统,AI管家,电子音,男声,磁性"],
    ["vt17", "弹簧感卡通音", "偏高音，元音明亮有弹性，带有轻微鼻音，让声音更容易辨认", "springy higher-register cartoon timbre with bright vowels and light nasal resonance", "网文系统,搞怪系统,卡通,吐槽,高音"],
    ["vt18", "轻盈空灵的声音", "中高音，发声轻，余音短", "light, airy mid-high voice with a short tail", "神秘传音,空灵,系统,科幻"],
    ["vt19", "窄频电子警示音", "中高音区的共鸣较集中，声音带有轻薄的金属质感，每个字开头的发音清楚", "focused mid-high voice with a thin metallic edge and crisp consonant onsets", "警报,系统警告,电子音,播报"],
    ["vt20", "深沉纪录片旁白", "中低音区的男声，胸腔共鸣深沉，略带沙哑，轻读的字也能听清", "deep mid-low male narrator with chest resonance, a trace of grain and clear unstressed syllables", "旁白,纪录片,叙事,男声"],
    ["vt21", "贴耳故事女声", "中低音区的女声，元音温和柔软，带有少量近距离说话时的气声", "intimate mid-low female storytelling voice with soft vowels and a light breath edge", "旁白,故事,女声,贴耳"],
    ["vt22", "冷静纪实女声", "清澈的中音，口腔共鸣居中，齿音不过分突出", "clear neutral mid-register female timbre with centered oral resonance and restrained sibilance", "旁白,纪实,解说,女声"],
    ["vt23", "清亮公共播音", "中高音区的声音传得清楚，元音集中，即使环境嘈杂也容易辨认", "projected mid-high announcer timbre with focused vowels and clearly separated consonants", "广播,车站,播音,通知"],
    ["vt24", "厂区扩音喇叭", "中频突出，略有扬声器共振，字音边缘保持清楚", "midrange-focused voice with a light horn-speaker coloration and intelligible consonants", "广播,厂区,扩音器,喇叭"],
    ["vt25", "老式无线电声", "以较窄的中频为主，声音略带颗粒感，但人声仍然清楚", "narrow midrange radio voice with a little grain and intact speech intelligibility", "广播,对讲机,无线电,电话"],
    ["vt26", "清澈的中性青年声线", "清亮的中音，听起来年轻，性别特征不明显", "clear youthful mid-register voice with a gender-neutral tone", "中性,青年,清透,角色"],
    ["vt27", "冷静低音女声", "自然的低音女声，口腔共鸣饱满，元音音色偏暗但发音清楚", "naturally low female voice with firm oral resonance and dark, clearly formed vowels", "女低音,冷静,权威,角色"],
    ["vt28", "略带沙哑的年长女声", "中低音略有颤动，气息略带沙哑质感，咬字清楚", "older female mid-low timbre with a slight tremor, fine breath grain and clear consonants", "年长,女声,轻哑,角色"],
    ["vt29", "年长工匠男声", "年长男声，中低音区的声音略显干涩和粗糙", "older male mid-low voice with a slightly dry and rough sound", "年长,工匠,男声,厂长,角色"],
    ["vt30", "圆润儿童声", "音高偏高的童声，元音圆润轻柔，气息短而细，齿音柔和", "rounded higher-register child timbre with light vowels, fine breath and soft sibilants", "儿童,童声,圆润,角色"],
  ],
  emotion: [
    ["ve01", "克制愤怒", "低音量，关键词重读，尾音收紧", "restrained anger, controlled volume and clipped emphatic endings", "愤怒,克制,冲突"],
    ["ve02", "突然震惊", "意外改变当下口气，反应跟着所见所闻发生", "surprise breaks through in the voice as the character registers what just happened", "震惊,惊讶,反应"],
    ["ve03", "狂喜兴奋", "音调上扬，节奏明快", "delighted excitement, brighter pitch and lively rhythm", "兴奋,狂喜,快乐"],
    ["ve04", "强忍悲伤", "照常对眼前的人说，提到难以说出口的事时声音发紧", "keeps talking to the listener, with a slight strain when reaching the hardest part of the line", "悲伤,隐忍,告别"],
    ["ve05", "焦虑慌张", "呼吸短促，说话时不吞字", "anxious urgency with short breaths and intelligible words", "焦虑,慌张,危险"],
    ["ve06", "冷漠疏离", "语调收敛、句尾干脆", "cool detachment with restrained pitch changes", "冷漠,理性,高冷"],
    ["ve07", "冷笑威胁", "带着笑意轻声讽刺，重读关键词", "low dry sarcasm with a faint smile and pointed stress", "嘲讽,冷笑,反派"],
    ["ve08", "温柔安慰", "温和、平缓、亲切起伏", "gentle reassuring tone with warm pitch movement", "温柔,安慰,亲情"],
    ["ve09", "坚定决绝", "咬字扎实，重音落在决定上", "firm articulation with stress on the words expressing the decision", "坚定,决绝,热血"],
    ["ve10", "惊恐低语", "压低音量、气息紧绷", "frightened hushed delivery with tense audible breaths", "惊恐,低语,悬疑"],
    ["ve11", "得意自满", "语气微扬、带笑", "self-satisfied delivery with a subtle smile and buoyant endings", "得意,炫耀,喜剧"],
    ["ve12", "平静释然", "听清让人放心的那句话后，声音逐渐放松", "the voice eases once the speaker hears what puts them at ease", "释然,平静,温暖"],
    ["ve13", "礼貌施压", "口气保持客气，需要对方答复的那部分说清楚", "remains polite while making the part that needs an answer clear", "礼貌,施压,谈判"],
    ["ve14", "犹豫后确定", "犹豫的位置跟着人物正在斟酌的意思，作出决定后语气转稳", "hesitation where the character is weighing their words, with a steadier tone as their decision becomes clear", "迟疑,犹豫,拿定主意"],
  ],
  personality: [
    ["vp01", "理性工程师", "解释时语气稳，重音落在对方此刻需要听清的信息上", "level, precise delivery with emphasis on what the listener needs to understand in this exchange", "工程师,技术,理性"],
    ["vp02", "试探口吻", "观察对方的回应再接下一句，语气可带一点笑意", "feels out the listener's response before carrying on, with a slight smile if it fits", "试探,商谈,谈判"],
    ["vp03", "沉稳领导", "停顿从容，少用强重音", "composed authoritative delivery with confident measured pauses", "领导,权威,沉稳"],
    ["vp04", "直爽青年", "声线明朗，语气坦率，重音随谈话变化", "bright youthful tone with candid delivery and stress that follows the conversation", "青年,直爽,朋友"],
    ["vp05", "毒舌吐槽", "表面保持冷静，对带有讽刺意味的词语稍加重读", "deadpan witty delivery with precisely placed sarcastic stress", "毒舌,吐槽,搞笑"],
    ["vp06", "谨慎开口", "不了解对方态度时会试探，确认之后说话转稳", "sounds tentative when unsure how the listener will respond, then speaks more steadily once it is clear", "谨慎,试探,焦虑"],
    ["vp07", "热血冲动", "情绪饱满、开口迅速", "impulsive energetic delivery with rapid engagement", "热血,冲动,主角"],
    ["vp08", "耐心听完再回答", "话说给眼前的人听，给对方留出自然的接话时间", "speaks patiently to the listener and gives them time to respond", "耐心,亲切,亲情"],
    ["vp09", "审慎质问者", "问句节奏紧凑，关键信息稍加重读，句尾语调适度下降", "compact questioning with precise stress on key details and a measured downward release", "质问,审慎,冷静"],
    ["vp10", "熟人间的热心口吻", "像同熟人聊天，音量贴合双方距离，听到对方回应再往下说", "speaks as to someone familiar, keeping volume right for the distance and responding to what they say", "亲切,街坊,自然"],
    ["vp11", "朴实务实", "咬字松弛，重音落在眼下要谈的事上", "relaxed articulation with stress on what matters in the exchange", "务实,朴实,口语"],
  ],
  pace: [
    ["vr01", "自然偏快", "比普通对话略快，换气自然", "slightly quicker than usual conversational pace with natural breaths", "1.3倍,自然,偏快", 1.3],
    ["vr02", "轻快", "说话轻快，节奏紧凑，停顿自然", "lively quick cadence with natural breath gaps", "轻快,欢快,节奏", 1.15],
    ["vr03", "紧急情况下的快速讲话", "明显加速但不含混", "urgently fast yet intelligible delivery", "急促,紧张,快语", 1.5],
    ["vr04", "沉稳慢速", "慢一点、停顿有分量", "deliberate measured cadence and weighted pauses", "慢速,沉稳,权威", 0.9],
    ["vr05", "放慢交谈", "留出说清这一句需要的停顿，音量由场景决定", "unhurried speech with time to finish the thought", "慢速,低语,秘密,悬疑", 0.8],
    ["vr06", "连续快速讲话", "语句密集但不吞字", "rapid-fire conversational delivery with clear diction", "快嘴,喜剧,吐槽", 1.65],
    ["vr07", "庄重而缓慢地讲话", "镜头明确要求庄重时放缓，关键停顿短而有分量", "ceremonial measured delivery with clear diction and deliberate pauses at key phrases", "庄重,慢声,宣告", 0.85],
  ],
  age: [
    ["va01", "稚嫩的童声", "声音稚嫩，音高偏高且轻盈，避免成人的声线和口吻", "childlike voice impression, light high pitch and youthful articulation", "儿童,稚嫩,童声"],
    ["va02", "少年的声音", "少年声线，音色尚未定型", "a youthful adolescent voice with naturally changing pitch", "少年,青春,校园"],
    ["va03", "二十岁出头的青年声线", "清亮有弹性", "early-twenties voice impression, clear and flexible natural speech", "青年,二十岁,主角"],
    ["va04", "三四十岁的成熟声线", "共鸣稳定，语调从容克制", "adult voice impression in the thirties or forties, steady resonance", "成年,成熟,中年"],
    ["va05", "五六十岁、富有阅历的声线", "声音略显粗糙，气息稳定，不刻意表现得虚弱", "seasoned older-adult voice impression with subtle texture", "中老年,沧桑,阅历"],
    ["va06", "高龄长者的声音", "自然换气或轻颤，不夸张", "elderly voice impression with subtle breath breaks, never exaggerated", "高龄,老年,长者"],
  ],
  foreignAccent: [
    ["vf01", "英语母语者说中文", "保留普通话原文，说话时带有轻微的英语重音节奏和语调特征", "intelligible Mandarin with subtle English-first-language stress timing and tone influence", "外国人说中文,英语口音,英语母语"],
    ["vf02", "美式英语背景说中文", "普通话流利，说话节奏略带美式英语特征", "fluent Mandarin with a mild American-English-influenced rhythm", "外国人说中文,美式,英语背景"],
    ["vf03", "英式英语背景说中文", "普通话流利，说话节奏略带英式英语特征", "fluent Mandarin with a restrained British-English-influenced cadence", "外国人说中文,英式,英语背景"],
    ["vf04", "法语背景说中文", "普通话清楚易懂，带有轻微的法语节奏特征", "intelligible Mandarin with a subtle French-language rhythmic influence", "外国人说中文,法语,法国"],
    ["vf05", "俄语背景说中文", "普通话清楚，辅音发音略显硬朗", "clear Mandarin with subtle Russian-language rhythm and firm consonants", "外国人说中文,俄语,俄罗斯"],
    ["vf06", "日语背景说中文", "普通话流利，各音节之间的节奏较为均匀", "fluent Mandarin with a gentle Japanese-language-influenced syllabic rhythm", "外国人说中文,日语,日本"],
    ["vf07", "韩语背景说中文", "普通话清晰，句尾略有韩语韵律", "clear Mandarin with a subtle Korean-language-influenced phrase cadence", "外国人说中文,韩语,韩国"],
    ["vf08", "西班牙语背景的说话人说中文", "普通话清楚，说话节奏略有起伏", "clear Mandarin with a mild Spanish-language rhythmic lilt", "外国人说中文,西班牙语,拉美"],
    ["vf09", "带有轻微非母语口音的中文", "不指定国籍，中文发音和语调带有轻微的非母语特征", "fluent intelligible Mandarin with a mild unspecified non-native cadence", "外国人说中文,非母语,通用"],
  ],
  dialect: [
    ["vd01", "东北口音普通话", "保留普通话台词原文，说话时略带东北语调", "Mandarin with a subtle Northeastern Chinese regional accent", "东北,东北话,地方口音"],
    ["vd02", "四川口音普通话", "保留普通话台词原文，说话时略带四川语调", "Mandarin with a light Sichuan-influenced regional accent", "四川,川普,地方口音"],
    ["vd03", "重庆口音普通话", "保留普通话台词原文，说话时略带重庆语调", "Mandarin with a mild Chongqing regional cadence", "重庆,西南,地方口音"],
    ["vd04", "广东口音普通话", "普通话的声调略带粤语口音", "Mandarin with a restrained Cantonese-influenced accent", "广东,粤普,地方口音"],
    ["vd05", "上海口音普通话", "普通话的节奏略带吴语口音", "Mandarin with a subtle Shanghainese-influenced rhythm", "上海,吴语,地方口音"],
    ["vd06", "河南口音普通话", "略带中原地域语调", "Mandarin with a light Henan regional intonation", "河南,中原,地方口音"],
    ["vd07", "山东口音普通话", "保留普通话台词原文，说话时略带山东语调", "Mandarin with a mild Shandong regional cadence", "山东,北方,地方口音"],
    ["vd08", "陕西口音普通话", "略带关中地区音调", "Mandarin with a restrained Shaanxi Guanzhong-influenced intonation", "陕西,关中,地方口音"],
    ["vd09", "湖南口音普通话", "略带湘语背景韵律", "Mandarin with a subtle Hunan-influenced rhythm", "湖南,湘语,地方口音"],
    ["vd10", "福建口音普通话", "略带闽语背景韵律", "Mandarin with a slight Fujian-area Min-language-influenced cadence", "福建,闽南,地方口音"],
    ["vd11", "天津口音普通话", "保留普通话台词原文，说话时略带天津语调", "Mandarin with a restrained Tianjin regional pitch contour", "天津,北方,地方口音"],
    ["vd12", "台湾地区口音普通话", "说话时略带台湾地区日常华语的语调", "Mandarin with subtle Taiwan-region conversational intonation", "台湾,华语,地方口音"],
  ],
  delivery: [
    ["vx01", "自然口语", "对着实际的交谈对象说话，根据想表达的意思安排停顿和重音", "speaks to the other person, with pauses and emphasis where they follow the meaning", "自然,口语,日常"],
    ["vx02", "近距离耳语", "音量较低，带有轻微气声，发音保持清楚", "intimate close-mic hushed delivery with clear diction", "耳语,低声,秘密"],
    ["vx03", "远处呼喊", "以充足的气息向远处的人喊话", "projected speech directed toward someone far away, without distortion", "喊话,远处,呼叫"],
    ["vx04", "标准播报", "音量均匀、停顿规整", "even-volume announcement with clear consonants and orderly pauses", "播报,通知,系统"],
    ["vx05", "咬着牙说话", "说话短促，虽然咬紧牙关，但仍能听清每个字", "short clipped words through a tense jaw, still intelligible", "咬牙,忍耐,愤怒"],
    ["vx06", "喘息间说话", "根据人物用力的情况和原有台词安排换气，保留完整台词", "audible breaths timed to the exertion and the full scripted line", "喘息,奔跑,疲惫"],
    ["vx07", "含笑发言", "音色带笑、词语轻微上扬", "smiling through the words with subtle buoyant emphasis", "含笑,开心,亲切"],
    ["vx08", "冷静机械播音", "精确且节奏有序、无明显情感波动", "precise synthesized-announcement delivery with steady loudness", "机械,系统,AI"],
    ["vx09", "清晰接话", "按照定稿规定的开口时机接话；抢话时，仍应能听清两位说话人的关键信息", "responds at the scripted cue, keeping key words audible during any planned overlap", "接话,轮流说话,交锋"],
    ["vx10", "按时清楚地说完台词", "说清最后一个字，在原定时机说完这一句", "finishes the line on cue, keeping the last word clear", "台词结束,闭口,镜尾"],
    ["vx11", "正经说怪话", "说话时一本正经，只在产生荒诞效果的关键处作一次短暂重读", "straight-faced earnest delivery with one brief accent on the absurd punch beat", "抽象,搞怪,冷幽默"],
  ],
  // 声源层描述声音来自哪里、谁听得见，音色与语速仍由角色选配。
  source: [
    ["vs01", "画内对白", "声音来自画面中的说话人，口型与他本人说出的台词同步", "speech comes from the visible speaker with their mouth moving in sync", "声源,画内对白,口型"],
    ["vs02", "剧情旁白", "旁白面向观众。说话人编号后使用固定短语，该段对白结束后立即写明画面人物嘴唇闭合", "says in an off-screen voiceover", "声源,旁白,画外音,叙事"],
    ["vs03", "角色内心独白", "沿用角色声线。说话人编号后使用固定短语，该段对白结束后立即写明画面人物嘴唇闭合", "says in an off-screen voiceover", "声源,内心独白,心理活动,画外音"],
    ["vs04", "冷漠机械系统", "无实体的系统播报。说话人编号后使用固定短语，该段对白结束后立即写明画面人物嘴唇闭合", "says in an off-screen voiceover", "声源,系统,网文系统,系统声音,机械系统,画外音"],
    ["vs05", "甜美女声系统", "无实体的系统提示。说话人编号后使用固定短语，该段对白结束后立即写明画面人物嘴唇闭合", "says in an off-screen voiceover", "声源,系统,网文系统,系统声音,甜美,萌妹,画外音"],
    ["vs06", "AI 管家系统", "声音来自没有实体形象的智能助理。说话人编号后使用固定短语，该段对白结束后立即写明画面人物嘴唇闭合", "says in an off-screen voiceover", "声源,系统,网文系统,系统声音,AI管家,画外音"],
    ["vs07", "搞怪系统", "声音来自没有实体形象的系统，玩笑内容以原有场戏为准。说话人编号后使用固定短语，该段对白结束后立即写明画面人物嘴唇闭合", "says in an off-screen voiceover", "声源,系统,网文系统,系统声音,搞怪,吐槽,画外音"],
    ["vs08", "神秘传音", "无实体的定向传音，只让剧本指定的人听见", "a disembodied mystical voice reaches only its intended listener", "声源,神秘传音,心灵传音,画外音"],
    ["vs09", "电子广播", "声音来自场景内的扩音设备，能够听见广播的人可以作出反应", "an unseen announcer is heard through the scene's loudspeakers by the people within earshot", "声源,广播,电子广播,画外音"],
    ["vs10", "回忆声音", "既有角色的回忆声沿用其声线和编号，当前场景中的人物按照剧本作出反应", "a remembered voice carries the original speaker's timbre over the present scene", "声源,回忆声音,闪回,画外音"],
    ["vs11", "电话声音", "声音从电话传出，是否开免提、谁能听见由剧本决定", "the remote speaker is heard through the phone by those who can hear it in the scripted setup", "声源,电话,电话声音,画外音"],
  ],
};
export const voiceTemplates: VoiceTemplate[] = voiceCategories.flatMap(category =>
  rows[category].map(([id, title, descriptionZh, englishCue, tags, speedMultiplier]) => ({
    id, title, category, descriptionZh, englishCue, tags: tags.split(","),
    ...(speedMultiplier === undefined ? {} : { speedMultiplier }),
  })));
export type VoiceCastRole = {
  speakerId: string;
  characterName: string;
  voiceIdentity?: string;
  sourceId?: string;
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
  sourceId: "source", timbreId: "timbre", ageId: "age", personalityId: "personality", foreignAccentId: "foreignAccent",
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
    const source = selected.find(item => item.category === "source");
    if (!voiceIdentity && !selected.some(item => ["timbre", "age", "personality"].includes(item.category))) warnings.push(`${role.speakerId} 缺少长期稳定的声线描述或音色模板`);
    const machineVoice = selected.some(item =>
      (item.category === "timbre" || item.category === "delivery")
      && (/合成|机械|电子音/.test(item.tags.join(",")) || /synthesized|synthetic|electronic/i.test(item.englishCue)));
    const machineRole = (source && (/system|disembodied|announce|loudspeaker/i.test(source.englishCue) || /系统|广播/.test(source.tags.join(","))))
      || /系统|机械|广播|机器|AI|机器人|电子/.test(`${role.characterName} ${voiceIdentity ?? ""}`);
    if (machineVoice && !machineRole) warnings.push(`${role.speakerId} 选用了机械/合成音色；仅适用于系统、广播或机器角色。`);
    const pace = selected.find(item => item.category === "pace");
    const speedMultiplier = role.speedMultiplier ?? pace?.speedMultiplier;
    const identityCues = selected.filter(item => ["timbre", "age", "personality", "foreignAccent", "dialect"].includes(item.category)).map(item => item.englishCue);
    const performanceCues = selected.filter(item => ["emotion", "delivery"].includes(item.category)).map(item => item.englishCue);
    const paceCue = [pace?.englishCue, speedMultiplier === undefined ? undefined : speechRateCue(speedMultiplier)].filter(Boolean).join("; ");
    const cues = [source?.englishCue, voiceIdentity, ...identityCues, ...performanceCues, paceCue].filter(Boolean);
    return {
      speakerId: role.speakerId, characterName: role.characterName,
      ...(voiceIdentity ? { voiceIdentity } : {}),
      ...(source ? { source: { id: source.id, title: source.title, cue: source.englishCue } } : {}),
      templateIds: selected.map(item => item.id), speedMultiplier, identityCues, performanceCues,
      promptCue: `${role.characterName} (${role.speakerId}): ${cues.join("; ")}.`
    };
  });
  return {
    status: errors.length ? "invalid" as const : warnings.length ? "review" as const : "ok" as const,
    errors, warnings, roles,
    guidance: "不同镜头应沿用角色已经确定的声线。只为本次交谈选择合适的语气和语速，根据人物想表达的意思安排停顿和重音。台词、接话顺序、说话人以及谁能听见，均以定稿为准。口音只改变原有台词的发音方式，不改变台词内容。音频引用必须使用实际素材。",
  };
}
