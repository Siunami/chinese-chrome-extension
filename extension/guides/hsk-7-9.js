// HSK 7, 8 and 9 — the advanced band of HSK 3.0.
//
// The three levels share one syllabus, one word list and one exam paper, so
// the published statistics are identical for all three and are repeated here
// unchanged. The guides differ by capability, which is how the standard itself
// distinguishes the levels. No pinyin is stored: readings are generated at
// display time from CC-CEDICT.

export const LEVELS_7_9 = [
  // -------------------------------------------------------------------------
  // HSK 7
  // -------------------------------------------------------------------------
  {
    level: 7,
    band: 'Advanced',
    name: 'HSK 7',
    tagline: "Professional and academic reading at speed: formal connectives, dense attributives.",
    stats: {
      newWords: 5636,
      totalWords: 11092,
      newChars: 1200,
      totalChars: 3000,
      studyHours: "roughly 2600-3200 cumulative hours, about 600 of them beyond HSK 6",
      grammarPoints: 148,
    },
    overview:
      "HSK 7 opens the advanced band. HSK 7-9 is published as one syllabus and sat as one exam, so the standard supplies no per-level split of words or characters; the figures shown here are the band totals and are deliberately identical in all three advanced guides. What separates levels 7, 8 and 9 is what you are asked to be able to do, not an invented difference in word count. At level 7 the target is unforced general and professional reading: news analysis, workplace and academic prose, and formal correspondence, taken at close to normal speed, with written connectives and long attributive chains no longer slowing you down.",
    canDo: [
      "Read a newspaper analysis or a policy commentary once through and come away with the argument, not just the topic.",
      "Follow written sentences in which three or four modifiers stack up in front of the head noun.",
      "Draft workplace documents that hold their register: a project proposal, a meeting summary, a letter of apology to a client.",
      "Take part in a professional meeting held entirely in Chinese, including disagreeing politely and asking for clarification.",
      "Work through an undergraduate textbook chapter or a review article in a familiar field at a usable speed.",
      "Recognise the common 成语 in context and use the most frequent of them accurately in your own writing.",
    ],
    grammar: [
      {
        point: "Formal preamble with 鉴于",
        formula: '鉴于 + 情况, 主句',
        explain:
          "鉴于 introduces a situation both sides already accept, and the main clause states the decision that follows from it. It belongs to notices, reports and legal prose; in speech you would use 因为 or 既然. The clause after 鉴于 states a fact, never a reason being argued for.",
        examples: [
          { zh: '鉴于双方分歧较大，谈判暂时中止。', en: "Given the considerable gap between the two sides, the talks have been suspended for now." },
          { zh: '鉴于该产品存在安全隐患，公司决定全面召回。', en: "In view of the safety risk in the product, the company has decided on a full recall." },
          { zh: '鉴于以上情况，特此说明。', en: "In view of the above, this clarification is hereby issued." },
        ],
      },
      {
        point: "Limiting the scope of a claim with 就……而言 / 就……而论",
        formula: '就 + 范围 + 而言, 主句',
        explain:
          "This frame marks the angle from which a judgement holds and quietly concedes that it may not hold from other angles. 而言 is the neutral written form; 而论 is heavier and belongs to close, point-by-point argument. Academic prose uses both to keep a claim from sounding absolute.",
        examples: [
          { zh: '就成本而言，这个方案并不划算。', en: "As far as cost goes, this plan is not economical." },
          { zh: '就目前掌握的数据而论，还不足以下结论。', en: "On the evidence available so far, it is not yet enough to draw a conclusion." },
          { zh: '就技术难度而言，两者相差无几。', en: "In terms of technical difficulty there is almost nothing between the two." },
        ],
      },
      {
        point: "Fronting the result with 之所以……, 是因为……",
        formula: '主语 + 之所以 + 结果, 是因为 + 原因',
        explain:
          "Ordinary word order puts the cause first. 之所以 inverts it, so the result becomes the topic and the cause arrives as the news. Writers reach for it when the reader already knows the outcome and wants the explanation. The second clause may be 是因为, 是由于, or at higher register 盖因.",
        examples: [
          { zh: '该政策之所以推行缓慢，是因为地方配套资金迟迟没有到位。', en: "The reason the policy has been slow to roll out is that matching local funds have been a long time coming." },
          { zh: '他之所以选择辞职，并非待遇问题。', en: "His reason for resigning was not a question of pay." },
          { zh: '这本书之所以广受欢迎，是由于它把复杂的问题讲得通俗易懂。', en: "This book is so widely read because it explains complicated matters in plain terms." },
        ],
      },
      {
        point: "Stacked attributives before the head noun",
        formula: '限定语 + 描写语 + 的 + 中心语',
        explain:
          "Written Chinese loads three or four modifiers in front of a noun where English would hang relative clauses behind it. Read to the last 的, take the noun after it as the head, then unpack the modifiers backwards. The usual order is scope or ownership, then time or place, then a clause-like description, then quality.",
        examples: [
          { zh: '由有关部门联合发布的关于规范网络交易的实施细则已经生效。', en: "The implementing rules on regulating online transactions, issued jointly by the departments concerned, have taken effect." },
          { zh: '那位在会上第一个提出反对意见的年轻研究员后来成了项目负责人。', en: "The young researcher who was first to raise an objection at the meeting later became head of the project." },
        ],
      },
      {
        point: "Assigning a role or standard with 以……为……",
        formula: '以 + A + 为 + B',
        explain:
          "以 A 为 B gives A the role, standard or basis named by B, and is the written equivalent of 把 A 当作 B. The frequent frames are 以……为主, 以……为准, 以……为基础, 以……为核心 and 以……为例. B is normally a noun, and the whole phrase sits before the main verb.",
        examples: [
          { zh: '本次调查以在校大学生为主要对象。', en: "This survey takes university students as its main subjects." },
          { zh: '若两个版本有出入，以纸质文本为准。', en: "If the two versions differ, the paper text shall prevail." },
          { zh: '以长三角地区为例，产业转移已初见成效。', en: "Taking the Yangtze River Delta as an example, industrial relocation is already showing results." },
        ],
      },
      {
        point: "Light verbs 加以 / 予以 / 给予",
        formula: '对 + 宾语, 加以 + 双音节动词',
        explain:
          "These carry a two-syllable verb whose object has been fronted as the topic, which keeps a long sentence balanced. 加以 is neutral, 予以 and 给予 are heavier and typical of official language. The verb after them must be disyllabic: 加以说明 is fine, 加以说 is not.",
        examples: [
          { zh: '对上述问题，本文将逐一加以分析。', en: "This paper will analyse each of the above questions in turn." },
          { zh: '对违规行为，将依法予以处罚。', en: "Violations will be punished in accordance with the law." },
          { zh: '有关部门对这一建议给予了高度重视。', en: "The departments concerned attached great importance to this suggestion." },
        ],
      },
      {
        point: "Consequence chains: 从而 / 进而 / 继而 / 因而",
        formula: '前一分句, 从而 + 结果',
        explain:
          "从而 marks a result the first clause made possible, 进而 a further step in the same direction, 继而 the next event in time, and 因而 plain cause and effect. All four are written-only, none takes a subject of its own, and none of them is a stylistic variant of the others.",
        examples: [
          { zh: '新工艺降低了能耗，从而提高了整体利润。', en: "The new process cut energy use and thereby raised overall profit." },
          { zh: '研究先确认了现象的存在，进而探讨其成因。', en: "The study first confirmed that the phenomenon exists, and went on to examine its causes." },
          { zh: '他起初只是沉默，继而拂袖而去。', en: "At first he simply said nothing, and then he walked out in a huff." },
        ],
      },
      {
        point: "Weighing two options with 与其 A, 不如 B",
        formula: '与其 A, 不如 B',
        explain:
          "The writer rejects A in favour of B after comparing them, so the judgement is comparative rather than absolute and B need not be good in itself. 不如 can be strengthened to 倒不如 or 还不如, and raised to 毋宁 in formal writing. 与其 always precedes the rejected option.",
        examples: [
          { zh: '与其空谈理想，不如先把手头的事做好。', en: "Rather than talk airily about ideals, better to do the job in hand well first." },
          { zh: '与其等着上级安排，不如主动提出方案。', en: "Rather than wait for instructions from above, it is better to put a plan forward yourself." },
        ],
      },
    ],
    vocab: [
      {
        theme: '书面语连接成分 (written connectives)',
        words: [
          { zh: '鉴于', en: "in view of; given that" },
          { zh: '从而', en: "thus making it possible to; thereby" },
          { zh: '进而', en: "and go a step further" },
          { zh: '继而', en: "and then; next in time" },
          { zh: '反之', en: "conversely; the other way round" },
          { zh: '亦即', en: "that is to say; namely" },
          { zh: '据此', en: "on this basis; accordingly" },
          { zh: '综上所述', en: "to sum up the above" },
          { zh: '相比之下', en: "by comparison" },
          { zh: '乃至', en: "and even; going as far as" },
          { zh: '以致', en: "with the result that (usually unwanted)" },
          { zh: '诚然', en: "admittedly; it is true that" },
        ],
      },
      {
        theme: '公文与职场 (documents and the workplace)',
        words: [
          { zh: '呈报', en: "submit a report to a superior body" },
          { zh: '批复', en: "written reply from a higher authority" },
          { zh: '备案', en: "put on record; file with the authorities" },
          { zh: '落实', en: "put into effect; make good on" },
          { zh: '磋商', en: "consult; negotiate" },
          { zh: '洽谈', en: "hold business talks" },
          { zh: '履行', en: "fulfil a duty or a contract" },
          { zh: '拟定', en: "draw up; draft" },
          { zh: '部署', en: "make arrangements for; deploy" },
          { zh: '督促', en: "urge and press for action" },
          { zh: '审议', en: "deliberate on; review formally" },
          { zh: '特此', en: "hereby (fixed in notices)" },
        ],
      },
      {
        theme: '新闻与评论 (news and commentary)',
        words: [
          { zh: '舆论', en: "public opinion" },
          { zh: '披露', en: "disclose; reveal" },
          { zh: '质疑', en: "call into question" },
          { zh: '澄清', en: "clarify; set the record straight" },
          { zh: '抨击', en: "attack in print; lash out at" },
          { zh: '渲染', en: "play up; lay it on" },
          { zh: '炒作', en: "hype; whip up attention" },
          { zh: '走势', en: "trend; the way something is moving" },
          { zh: '社论', en: "editorial" },
          { zh: '权威', en: "authority; authoritative" },
          { zh: '追踪', en: "track; follow a story up" },
          { zh: '头条', en: "lead story; headline" },
        ],
      },
      {
        theme: '学术写作 (academic writing)',
        words: [
          { zh: '论证', en: "argue for; demonstrate" },
          { zh: '假设', en: "hypothesis; to suppose" },
          { zh: '样本', en: "sample" },
          { zh: '综述', en: "survey of the literature" },
          { zh: '阐述', en: "expound; set out at length" },
          { zh: '界定', en: "define the boundaries of" },
          { zh: '剖析', en: "dissect; analyse closely" },
          { zh: '归纳', en: "generalise from cases; induction" },
          { zh: '演绎', en: "deduce; deduction" },
          { zh: '实证', en: "empirical; evidence-based" },
          { zh: '文献', en: "literature; source documents" },
          { zh: '梳理', en: "comb through and sort out" },
        ],
      },
      {
        theme: '抽象名词 (abstract nouns)',
        words: [
          { zh: '机制', en: "mechanism" },
          { zh: '格局', en: "overall pattern; configuration" },
          { zh: '范畴', en: "category; domain" },
          { zh: '前提', en: "premise; precondition" },
          { zh: '依据', en: "grounds; basis" },
          { zh: '层面', en: "level; dimension of an issue" },
          { zh: '效应', en: "effect (as a named phenomenon)" },
          { zh: '共识', en: "consensus" },
          { zh: '弊端', en: "drawback; abuse in a system" },
          { zh: '契机', en: "opening; turning point" },
          { zh: '症结', en: "crux; the nub of the problem" },
          { zh: '脉络', en: "thread; line of development" },
        ],
      },
      {
        theme: '高频成语 (high-frequency idioms)',
        words: [
          { zh: '潜移默化', en: "influence imperceptibly over time" },
          { zh: '因地制宜', en: "suit measures to local conditions" },
          { zh: '循序渐进', en: "proceed step by step in order" },
          { zh: '举足轻重', en: "of decisive weight" },
          { zh: '层出不穷', en: "keep appearing one after another" },
          { zh: '势在必行', en: "imperative given the circumstances" },
          { zh: '一如既往', en: "just as always" },
          { zh: '不言而喻', en: "it goes without saying" },
          { zh: '有的放矢', en: "aim at a definite target" },
          { zh: '事半功倍', en: "twice the result for half the effort" },
          { zh: '行之有效', en: "proven to work in practice" },
          { zh: '无可厚非', en: "not open to serious blame" },
        ],
      },
    ],
    passage: {
      title: '城市竞争中的慢变量',
      text:
        '近二十年来，中国城市面貌变化之快，几乎超出了任何一份早期规划文本的预期。人们习惯用高楼、地铁和机场来衡量一座城市的成长，因为这些指标看得见、算得清，也最容易写进年度报告。然而，真正决定一座城市能否长久保持活力的，往往并非这些见效迅速的硬指标，而是那些不易量化的因素：教育质量、公共服务的均等程度、社区的自治能力，以及一套让普通人愿意长期定居的制度安排。\n\n' +
        '鉴于统计口径的限制，上述因素在多数评估体系中被明显低估。以人口流入为例，媒体披露的数据通常只反映户籍变动，而未能体现实际居住状况；据此得出的结论，难免与居民的切身感受存在出入。相比之下，一些经济总量并不突出的中等城市，因在住房、托育和医疗上持续投入，反而留住了较为稳定的年轻人口。\n\n' +
        '综上所述，城市治理的重心正从建设转向运营。这一转变对管理者提出了更高的要求：既要看得懂财务报表，也要读得懂人心。可以预见，未来十年，城市之间的竞争将不再取决于谁的天际线更高，而在于谁能让居民在漫长的日常里仍然愿意留下来。',
      en:
        "Over the past twenty years Chinese cities have changed faster than any early planning document foresaw. It is easy to measure growth in towers, metro lines and airports, because those figures are visible, countable and simple to put in an annual report. What actually keeps a city alive, though, tends to be the things that resist counting: the quality of its schools, how evenly public services are spread, whether neighbourhoods can run themselves, and an institutional arrangement that makes ordinary people willing to settle for the long term. Statistical categories understate all of this. Reported migration figures usually track household registration rather than where people actually live, so conclusions drawn from them sit awkwardly beside what residents feel. Mid-sized cities with unremarkable economic output have held on to young populations by spending steadily on housing, childcare and health. The centre of gravity in city government is therefore moving from construction to operation, which asks more of administrators: they have to read a balance sheet and read people. Over the next decade cities will compete less on the height of their skylines than on whether residents still want to stay.",
    },
    pitfalls: [
      {
        title: "Treating the written connectives as interchangeable",
        detail:
          "从而, 进而, 继而 and 因而 are not stylistic variants of one another. 从而 needs the first clause to make the second possible, 进而 needs the second to go further in the same direction, 继而 is purely sequential in time, and 因而 is plain cause and effect. Swapping them leaves grammatical sentences that quietly say something you did not mean.",
      },
      {
        title: "Reading a long attributive from the front",
        detail:
          "In a noun phrase with three modifiers, the meaning is anchored by the head noun at the very end. Learners who translate left to right build a picture and then have to throw it away. Train the opposite habit: jump to the last 的, take the noun after it, then attach the modifiers back one at a time.",
      },
      {
        title: "Spoken vocabulary in a written document",
        detail:
          "挺, 特别, 好多, 一下子, 老是 and 差不多 are perfectly good Chinese and perfectly wrong in a report. Their written counterparts are 相当, 尤其, 大量, 一时, 经常 and 大致. One of these in an otherwise formal paragraph is more conspicuous to a Chinese reader than a grammar mistake.",
      },
      {
        title: "Over-nominalising",
        detail:
          "Learners who discover 进行, 加以 and 予以 tend to run every verb through them, producing sentences like 对该问题进行了深入的研究的开展. Use a light verb only when the main verb is disyllabic and its object has been fronted for balance, and keep at most one per clause.",
      },
    ],
    tips: [
      "Read one long news analysis a day and mark every connective before you look up a single noun. The connectives carry the argument; the nouns are only its furniture.",
      "When a sentence stalls you, find the last 的 and the noun after it. That noun is the head, and everything in front of it is description.",
      "Keep two vocabulary lists, one for reading and one for writing. A word moves to the writing list only after you have seen a native writer use it three times.",
      "Write a 300-character summary of something you read each week, then reread it hunting for any word that would sound out of place in a report.",
    ],
    exam: {
      format:
        "One paper serves all three advanced levels. It runs to roughly three hours and has five sections: listening (about 40 items), reading (about 47 items), writing (two tasks), written translation, and speaking, which includes interpreting and an extended monologue. Whether the certificate says HSK 7, 8 or 9 depends on the total score, so there is no separate level 7 test to sit.",
      tips:
        "Reading is the section that runs people out of time. Practise with a clock from the start, answer in the order the questions appear, and never stop to look something up mid-passage. In writing, spend two minutes planning before you start: a plain, well-organised piece that finishes scores better than an ornate one that does not.",
    },
  },

  // -------------------------------------------------------------------------
  // HSK 8
  // -------------------------------------------------------------------------
  {
    level: 8,
    band: 'Advanced',
    name: 'HSK 8',
    tagline: "Literary and rhetorical range: idioms used well, classical residue, authorial stance.",
    stats: {
      newWords: 5636,
      totalWords: 11092,
      newChars: 1200,
      totalChars: 3000,
      studyHours: "roughly 3200-4000 cumulative hours, most of the difference spent reading",
      grammarPoints: 148,
    },
    overview:
      "HSK 8 sits in the middle of a band that is examined as a single test. Because HSK 7-9 shares one syllabus and one word list, the standard publishes no per-level breakdown of words, characters or grammar points, and the counts below are the band figures repeated unchanged in all three advanced guides. The distinction between the levels is capability, not quantity. At level 8 the demand is literary and rhetorical range: essays, fiction and sustained argument; 成语 and 惯用语 used correctly rather than merely recognised; the classical patterns that survive in modern formal writing; and an ear for irony, understatement and where an author actually stands.",
    canDo: [
      "Read contemporary essays and short fiction for pleasure, catching irony and understatement rather than only the events.",
      "Use several hundred 成语 and 惯用语 with the right register and the right praise-or-blame colouring.",
      "Parse the classical residue in modern formal writing: 之, 其, 者, 所, 以, 而 and the frames built on them.",
      "Write a structured argumentative essay of 800 characters or more with varied sentence rhythm and controlled emphasis.",
      "Identify an author's position when it is never stated outright, and point to the wording that carries it.",
      "Give a prepared talk on an abstract topic and handle challenges without dropping into casual speech.",
    ],
    grammar: [
      {
        point: "所 as a nominaliser",
        formula: '所 + 动词 (+ 的) + 名词',
        explain:
          "所 turns a transitive verb into the thing acted upon: 所见 is what one sees, 所言 is what is said. With 的 it forms an attributive such as 他所说的话, and with 为 it forms the formal passive 为……所……. Dropping 所 rarely changes the sense, but keeping it lifts the register and makes the phrase read as a single unit.",
        examples: [
          { zh: '这些不过是他个人的所见所闻，不足为凭。', en: "These are no more than what he personally saw and heard, and are not enough to go on." },
          { zh: '报告中所提到的三点建议，均已落实。', en: "All three suggestions mentioned in the report have been carried out." },
          { zh: '这种做法为舆论所诟病。', en: "The practice has been censured by public opinion." },
        ],
      },
      {
        point: "者 as a nominaliser",
        formula: '动词/形容词 + 者',
        explain:
          "者 names the one who does or is something, giving 作者, 读者, 前者, 后者, 强者. It attaches to a whole phrase, not just a word, so 主张改革者 means those who advocate reform. In argument it also appears in 二者 and 三者 when counting items already listed.",
        examples: [
          { zh: '前者重在效率，后者重在公平。', en: "The former stresses efficiency, the latter fairness." },
          { zh: '主张全面放开者，多半低估了监管的难度。', en: "Those who argue for opening up across the board mostly underrate how hard regulation is." },
          { zh: '有志者未必都能如愿。', en: "Not everyone with ambition gets what they want." },
        ],
      },
      {
        point: "之 as attributive marker and as object pronoun",
        formula: 'A + 之 + B / 动词 + 之',
        explain:
          "In modern formal writing 之 does two unrelated jobs. Between two nouns it is a literary 的, as in 人生之路 or 前车之鉴. After a verb it is an object pronoun standing for something already mentioned, as in 取而代之, 一笑置之 and 总之. Reading the second use as 的 produces nonsense.",
        examples: [
          { zh: '这不过是权宜之计。', en: "This is no more than a stopgap." },
          { zh: '旧办法已不适用，新的规定取而代之。', en: "The old method no longer applies, and new rules have taken its place." },
          { zh: '对这类流言，他一笑置之。', en: "He laughed off rumours of that kind." },
        ],
      },
      {
        point: "其 as a formal determiner",
        formula: '其 + 名词',
        explain:
          "其 is the written equivalent of 他的, 她的, 它的 and 他们的, and also of 那 inside 其中, 其余 and 其后. It does not stand alone as a subject in modern prose: it always leans on a following noun or on a fixed frame such as 其中之一 or 各得其所.",
        examples: [
          { zh: '这项技术及其应用前景值得关注。', en: "This technology and its prospects for application are worth watching." },
          { zh: '与会者共二十人，其中半数来自海外。', en: "There were twenty participants, half of them from overseas." },
          { zh: '该书内容详实，其价值不容低估。', en: "The book is full and factual, and its value should not be underrated." },
        ],
      },
      {
        point: "以 as instrument and as purpose",
        formula: '以 + 手段 + 动词 / 动词, 以 + 目的',
        explain:
          "Before a noun 以 means by means of or according to, as in 以事实为依据. Before a verb phrase at the end of a clause it means in order to, as in 加强监管, 以防风险. The purpose sense is often spelled out as 以便, 以免 or 以期, and the whole construction is written-only.",
        examples: [
          { zh: '应以事实为依据，以法律为准绳。', en: "Facts should be the basis and the law the yardstick." },
          { zh: '现将有关材料一并附上，以供参考。', en: "The relevant materials are attached herewith for your reference." },
          { zh: '请提前报备，以免延误。', en: "Please register in advance so as to avoid delay." },
        ],
      },
      {
        point: "而 as coordinator and as adversative",
        formula: 'A 而 B',
        explain:
          "而 links two predicates sharing one subject. Between compatible qualities it simply coordinates, as in 简洁而有力; between clashing ones it means but. It also links manner to action, as in 缓缓而行, and lives inside 而是, 而已, 因而 and 从而. Nothing in the character tells you which reading applies; the relation between the two sides does.",
        examples: [
          { zh: '文章短小而精悍。', en: "The article is short but hard-hitting." },
          { zh: '他说得头头是道，而实际做起来一塌糊涂。', en: "He talks a good game, yet in practice he makes a complete mess of it." },
          { zh: '这不是能力问题，而是态度问题。', en: "This is not a question of ability but of attitude." },
        ],
      },
      {
        point: "Universal claims with 无不 and 莫不",
        formula: '主语 + 无不 + 动词',
        explain:
          "Two negatives make an emphatic positive: 无不 and 莫不 mean there is none that does not. Both are stronger and more literary than 都 and need a plural or generic subject. Note that 莫不是 is a different word altogether, meaning could it possibly be that.",
        examples: [
          { zh: '在场的人无不为之动容。', en: "There was no one present who was not moved by it." },
          { zh: '凡是读过这本书的，莫不称赞。', en: "Everyone who has read this book praises it." },
          { zh: '他的每一项决定，无不经过反复推敲。', en: "Not one of his decisions was made without repeated deliberation." },
        ],
      },
      {
        point: "Emphatic comparison with 不啻",
        formula: '不啻 + 名词短语',
        explain:
          "不啻 means no less than or amounting to, and says that something is as serious, or as valuable, as the thing it is set against. It is high register and always carries an evaluative charge. The everyday equivalents are 简直是 and 无异于, neither of which sounds the same on the page.",
        examples: [
          { zh: '这对当地经济不啻一场灾难。', en: "For the local economy this amounted to nothing short of a disaster." },
          { zh: '对一个初学者来说，这本书不啻一部宝典。', en: "For a beginner, this book is nothing less than a treasury." },
        ],
      },
      {
        point: "Four-character parallel structures",
        formula: '四字格 + 四字格, 前后对称',
        explain:
          "Formal Chinese likes clauses that balance in length and shape, as in 内容充实, 结构严谨 or 上有政策, 下有对策. The pairing carries meaning by itself, because the second half is read against the first. When you write one, keep the halves the same length and matched in word class; an unbalanced pair reads as an error rather than as a style.",
        examples: [
          { zh: '这篇论文选题新颖，论证严密。', en: "The paper has a fresh topic and a tightly built argument." },
          { zh: '上有政策，下有对策。', en: "For every measure from above there is a counter-measure from below." },
          { zh: '少说空话，多干实事。', en: "Less empty talk, more real work." },
        ],
      },
    ],
    vocab: [
      {
        theme: '文言遗存虚词 (classical particles in modern prose)',
        words: [
          { zh: '之', en: "literary 的; or an object pronoun after a verb" },
          { zh: '其', en: "his, her, its, their; that one" },
          { zh: '者', en: "the one who; the thing which" },
          { zh: '所', en: "nominaliser before a transitive verb" },
          { zh: '以', en: "by means of; in order to" },
          { zh: '而', en: "and yet; and so; and thereby" },
          { zh: '乃', en: "thus; namely; it turns out to be" },
          { zh: '则', en: "then; whereas (contrastive)" },
          { zh: '亦', en: "also; too (written)" },
          { zh: '皆', en: "all, without exception (written)" },
          { zh: '颇', en: "rather; quite (written)" },
          { zh: '未尝', en: "have never; not necessarily" },
        ],
      },
      {
        theme: '评论性成语 (idioms for criticism and praise)',
        words: [
          { zh: '一针见血', en: "go straight to the heart of it" },
          { zh: '画蛇添足', en: "ruin something by overdoing it" },
          { zh: '别具一格', en: "in a style of its own" },
          { zh: '耐人寻味', en: "repays thinking about" },
          { zh: '意味深长', en: "loaded with implication" },
          { zh: '独树一帜', en: "strike out on one's own line" },
          { zh: '淋漓尽致', en: "done with full vividness and thoroughness" },
          { zh: '言简意赅', en: "concise and complete" },
          { zh: '老生常谈', en: "the same old platitude" },
          { zh: '味同嚼蜡', en: "as dull as chewing wax" },
          { zh: '引人入胜', en: "absorbing; draws the reader in" },
          { zh: '扣人心弦', en: "gripping; tugs at the heart" },
        ],
      },
      {
        theme: '惯用语 (three-character set phrases)',
        words: [
          { zh: '打交道', en: "have dealings with" },
          { zh: '走过场', en: "go through the motions" },
          { zh: '唱反调', en: "take the opposite line" },
          { zh: '泼冷水', en: "pour cold water on" },
          { zh: '碰钉子', en: "be rebuffed; hit a wall" },
          { zh: '拖后腿', en: "hold someone back" },
          { zh: '摆架子', en: "put on airs" },
          { zh: '掉链子', en: "fail at the critical moment" },
          { zh: '打圆场', en: "smooth an awkward moment over" },
          { zh: '钻空子', en: "exploit a loophole" },
          { zh: '露马脚', en: "give the game away" },
          { zh: '唱高调', en: "make lofty but empty statements" },
        ],
      },
      {
        theme: '文学与批评 (literature and criticism)',
        words: [
          { zh: '意象', en: "image; imagery" },
          { zh: '隐喻', en: "metaphor" },
          { zh: '象征', en: "symbol; to symbolise" },
          { zh: '白描', en: "plain unadorned description" },
          { zh: '反讽', en: "irony" },
          { zh: '笔触', en: "brushstroke; a writer's touch" },
          { zh: '意境', en: "the mood a work creates" },
          { zh: '韵味', en: "lingering flavour; charm" },
          { zh: '叙事', en: "narration; narrative" },
          { zh: '抒情', en: "lyrical; expressing feeling" },
          { zh: '基调', en: "keynote; underlying tone" },
          { zh: '底蕴', en: "inner substance; accumulated depth" },
        ],
      },
      {
        theme: '态度与评价 (stance and evaluation)',
        words: [
          { zh: '褒贬', en: "praise and censure" },
          { zh: '揶揄', en: "tease; make fun of" },
          { zh: '调侃', en: "banter; poke gentle fun at" },
          { zh: '讥讽', en: "sneer at; jeer" },
          { zh: '含蓄', en: "implicit; holding something back" },
          { zh: '委婉', en: "tactful; roundabout" },
          { zh: '中肯', en: "pertinent; to the point" },
          { zh: '偏颇', en: "biased; one-sided" },
          { zh: '犀利', en: "incisive; sharp" },
          { zh: '冷峻', en: "grave and unsparing" },
          { zh: '刻薄', en: "harsh; cutting" },
          { zh: '诙谐', en: "humorous; witty" },
        ],
      },
      {
        theme: '抽象与情感 (abstract and emotional vocabulary)',
        words: [
          { zh: '吊诡', en: "paradoxical; strange" },
          { zh: '荒诞', en: "absurd" },
          { zh: '虚无', en: "nothingness; nihilistic" },
          { zh: '宿命', en: "fate; what is predestined" },
          { zh: '疏离', en: "estrangement; alienation" },
          { zh: '悲悯', en: "compassion for suffering" },
          { zh: '苍凉', en: "desolate; bleak" },
          { zh: '惆怅', en: "melancholy; wistful" },
          { zh: '孤寂', en: "solitary and still" },
          { zh: '沉郁', en: "sombre; pent-up" },
          { zh: '淡泊', en: "indifferent to fame and gain" },
          { zh: '超脱', en: "detached; above worldly concerns" },
        ],
      },
    ],
    passage: {
      title: '旧书摊',
      text:
        '少年时，我常在城南的旧书摊前流连。摊主是位沉默的老人，终日坐在马扎上，手里握一柄蒲扇，既不吆喝，也不还价。书按大小胡乱堆着，谁要买，自己去翻，翻出什么算什么，这大约就是他所谓的缘分。\n\n' +
        '那时我并不懂得，一个人肯把生计交给运气，需要何等的底气，只觉得他懒。多年以后重回故地，书摊早已不在，原址上是一间灯火通明的连锁咖啡馆，玻璃擦得一尘不染，里面的人低头看着各自的屏幕，彼此隔着一层客气的沉默。我站在门口，忽然想起老人那把蒲扇，想起夏日午后翻书时手指沾到的灰。\n\n' +
        '人们总说时代在进步，此话固然不错。只是进步二字，向来只计算得失之中可以计算的那一部分；至于那些无从折算的东西，比如一个下午的闲散，比如在一堆旧书里毫无目的地摸索所带来的欢喜，则被悄悄归入不值一提之列。我并非要为旧日辩护，旧日自有其寒酸与不便。我所惋惜的，不过是我们如今连惋惜的语言都渐渐生疏了。',
      en:
        "As a boy I used to linger at the second-hand book stall in the south of the city. The owner was a silent old man who sat all day on a folding stool with a palm-leaf fan in his hand, neither calling out to customers nor haggling. The books were piled up anyhow by size; if you wanted one you dug for it yourself and took whatever turned up, which was more or less what he meant by fate. I did not understand then how much nerve it takes to leave your livelihood to chance. I simply thought him lazy. Years later I went back. The stall was long gone and a brightly lit chain cafe stood in its place, the glass spotless, everyone inside bent over a screen with a layer of polite silence between them. Standing in the doorway I suddenly remembered that fan, and the dust on my fingers from turning pages on a summer afternoon. People say the times are improving, and that is true enough. But the word improvement has only ever counted the part of the ledger that can be counted; the things that cannot be converted into figures, an idle afternoon, or the pleasure of rummaging aimlessly through a heap of old books, get quietly filed under not worth mentioning. I am not defending the old days, which had their own shabbiness and inconvenience. What I regret is only that we are losing even the language of regret.",
    },
    pitfalls: [
      {
        title: "Glossing an idiom from its characters",
        detail:
          "差强人意 means just about passable, not disappointing. 首当其冲 means first to bear the brunt, not first in line for something good. 空穴来风 in current mainland usage means a rumour that has some basis, the opposite of the literal guess. Learn each idiom from a real sentence and check a Chinese-Chinese dictionary before you use it in writing.",
      },
      {
        title: "Ignoring the praise-or-blame colouring",
        detail:
          "无微不至 is warm and 无所不至 is damning, although they look like the same frame. 处心积虑, 蠢蠢欲动, 趋之若鹜 and 始作俑者 are all negative, and learners regularly deploy them as neutral description. Record 褒义, 贬义 or 中性 alongside every idiom you collect, and note who is allowed to be its subject.",
      },
      {
        title: "Reading classical particles as their modern homographs",
        detail:
          "之 after a verb is an object pronoun, not 的: 取而代之 means take its place, not the place of taking. 所 is not short for 所以, 以 before a verb phrase means in order to rather than by means of, and 而 is as often but as and. Decide from the relation between the two sides of the character, not from a default gloss.",
      },
      {
        title: "Idiom density",
        detail:
          "Four 成语 in one paragraph reads as a school composition rather than as adult prose. Good writers place one where the argument turns and leave the surrounding sentences plain. If two idioms in a paragraph carry roughly the same meaning, delete the weaker one and keep the sentence.",
      },
    ],
    tips: [
      "Never learn an idiom from its gloss alone. Collect it with the sentence it appeared in, and note whether it praises, criticises or is neutral.",
      "Read the same essay twice: once for what it says, once for how the writer signals what they think of it.",
      "Keep a running page of classical particles with two examples each, one where the character has its classical value and one where it is the modern homograph.",
      "Imitate before you innovate. Copy out a paragraph you admire, then write your own on a different subject using the same skeleton.",
      "Read a page of fiction aloud every week. Rhythm is most of what separates written Chinese from translated Chinese.",
    ],
    exam: {
      format:
        "There is no separate level 8 paper. Levels 7, 8 and 9 are certified from the same three-hour HSK 7-9 test, made up of listening, reading, writing, written translation and speaking, and the level awarded is the band your total score falls into. Level 8 is the middle band, which in practice means holding up in writing and translation as well as in reading.",
      tips:
        "Writing and translation reward control, not display. Choose one idiom you are certain of over three you half-remember, hold each paragraph to a single idea, and make sure the closing paragraph answers the question that was set. In speaking, slow down: examiners are listening for precision, not fluency of delivery.",
    },
  },

  // -------------------------------------------------------------------------
  // HSK 9
  // -------------------------------------------------------------------------
  {
    level: 9,
    band: 'Advanced',
    name: 'HSK 9',
    tagline: "Near-native precision: register control, near-synonyms, and extended argument.",
    stats: {
      newWords: 5636,
      totalWords: 11092,
      newChars: 1200,
      totalChars: 3000,
      studyHours: "4000 hours and upward; the last stretch is counted in years of reading",
      grammarPoints: 148,
    },
    overview:
      "HSK 9 is the top of the scale, and it is certified from the same paper as levels 7 and 8. The standard treats HSK 7-9 as one syllabus with one word list, so no per-level counts exist; the statistics here repeat the band totals exactly as the other two advanced guides do, because inventing a split would be inventing data. Level 9 is defined by precision rather than by volume: register control across scholarly, legal, journalistic and colloquial modes, secure choices between near-synonyms, command of the rhetoric and architecture of extended argument, translation-grade accuracy, and an awareness of regional and stylistic variation.",
    canDo: [
      "Move between scholarly, legal, journalistic and colloquial registers on purpose, and notice at once when a text slips.",
      "Choose correctly between near-synonyms such as 制定 and 制订, or 权利 and 权力, without stopping to think.",
      "Translate in both directions to a standard fit for publication, carrying tone and implication as well as content.",
      "Follow the structure of an argument running over several thousand characters and say exactly where it turns.",
      "Handle regional and stylistic variation across mainland, Taiwan, Hong Kong and Singapore usage without being thrown.",
      "Speak at length on a specialist subject with the precision an educated native speaker would expect of a colleague.",
    ],
    grammar: [
      {
        point: "Raised-register causation: 之所以……, 盖因……",
        formula: '之所以 + 结果, 盖因 + 原因',
        explain:
          "盖 as a causal conjunction survives from classical Chinese and is now confined to scholarly and editorial prose. 盖因 and 盖由于 replace 是因为 when the writer wants a reflective, slightly detached tone. In a business email or a spoken answer the same words sound like costume drama.",
        examples: [
          { zh: '这一学说之所以长盛不衰，盖因它回答了每一代人都会遇到的问题。', en: "This doctrine has never lost its hold because it answers a question every generation runs into." },
          { zh: '古籍之所以难读，盖因其省略甚多。', en: "Classical texts are hard to read because so much in them is left unsaid." },
        ],
      },
      {
        point: "Reframing a claim with 与其说 A, 毋宁说 B",
        formula: '与其说 A, 毋宁说 B',
        explain:
          "This is not a choice between courses of action but a correction of a description: the writer grants that A is roughly true and offers B as the more accurate account. 毋宁 is the formal member of the family, 不如说 the everyday one, and 倒不如说 adds a note of challenge.",
        examples: [
          { zh: '与其说这是一次改革，毋宁说是一次妥协。', en: "Rather than call this a reform, it would be truer to call it a compromise." },
          { zh: '与其说他失败了，不如说他从未真正开始。', en: "Rather than say he failed, it is more accurate to say he never really began." },
        ],
      },
      {
        point: "Exclusive condition: 惟有 / 唯有……方能……",
        formula: '惟有 + 条件, 方能 + 结果',
        explain:
          "惟 and 唯 are the written forms of 只, and 方 is the written form of 才. Together they say that the stated condition is the only route to the result, a clear register step above 只有……才能. The two graphs are interchangeable here, though 唯 is now the commoner one in mainland publishing.",
        examples: [
          { zh: '惟有制度上的保障，方能杜绝此类事件。', en: "Only institutional safeguards can put a stop to incidents of this kind." },
          { zh: '唯有沉下心来读原著，才能真正理解他的思想。', en: "Only by settling down with the original works can one really grasp his thought." },
        ],
      },
      {
        point: "Arguing from the stronger case: 连 A 尚且……, 何况 B",
        formula: '连 A 尚且 + 谓语, 何况 B？',
        explain:
          "The pattern reasons from a stronger case to a weaker one: if even A falls short, B certainly does. 尚且 marks the concession and 何况, 更何况 or 遑论 draws the inference, usually as a rhetorical question that expects no answer. The two halves must be genuinely comparable or the argument collapses.",
        examples: [
          { zh: '连专业人士尚且难以判断，何况普通消费者？', en: "If even specialists find it hard to judge, what hope has the ordinary consumer?" },
          { zh: '他连自己的事都管不好，更何况管别人？', en: "He cannot even manage his own affairs, let alone anyone else's." },
        ],
      },
      {
        point: "Emphatic assignment: 非……莫属 and 非……不可",
        formula: '非 + 名词 + 莫属',
        explain:
          "非 X 莫属 says that X and nobody else fits, and takes a person, a team or an object as X. The related 非……不可 attaches to a verb phrase and expresses necessity or resolve. Both are negative on the surface and strongly positive in force, which is why a literal reading inverts them.",
        examples: [
          { zh: '这个位置非他莫属。', en: "That post belongs to him and to no one else." },
          { zh: '要把事情弄清楚，非查档案不可。', en: "To get to the bottom of it there is nothing for it but to check the archives." },
          { zh: '今年的冠军非这支队伍莫属。', en: "This year the title can only go to this team." },
        ],
      },
      {
        point: "Formal conditionals with 若……则……",
        formula: '若 + 条件, 则 + 结果',
        explain:
          "若 replaces 如果 and 则 replaces 就 in legal, scientific and editorial writing, with 倘若, 设若 and 一旦 in the same family. 则 also works on its own between two parallel clauses, where it means whereas rather than then, and that contrastive use is the one learners tend to miss.",
        examples: [
          { zh: '若逾期未付，则视为违约。', en: "If payment is not made by the deadline, it shall be treated as a breach of contract." },
          { zh: '前者重在预防，后者则重在补救。', en: "The former stresses prevention, whereas the latter stresses remedy." },
          { zh: '若无确凿证据，不宜轻下结论。', en: "In the absence of hard evidence it is unwise to reach a conclusion lightly." },
        ],
      },
      {
        point: "Understatement with 未尝不 and 不无",
        formula: '未尝不 + 动词 / 不无 + 双音节名词',
        explain:
          "Both are double negatives that make a guarded positive claim. 未尝不 means it is not that one never, or it may well be; 不无 plus an abstract noun means not without, as in 不无道理 and 不无遗憾. They let a writer concede a point without endorsing it, which is why review and commentary are full of them.",
        examples: [
          { zh: '他的批评不无道理。', en: "There is something in his criticism." },
          { zh: '这种做法未尝不是一种出路。', en: "This approach may well be a way out." },
          { zh: '结局虽好，过程却不无遗憾。', en: "The ending was a happy one, though the process was not without its regrets." },
        ],
      },
      {
        point: "Rhetorical negation with 岂 and 何以",
        formula: '岂 + 动词短语 + ？',
        explain:
          "岂 turns a statement into a question that expects the opposite answer: 岂能 means how could one possibly, 岂止 means far more than merely. 何以 is the written form of 为什么 or 凭什么 and shifts the burden of explanation onto the other side. Both are instruments of argument, not of genuine enquiry, and neither belongs in speech.",
        examples: [
          { zh: '事关公共安全，岂能敷衍了事？', en: "With public safety at stake, how could this be handled perfunctorily?" },
          { zh: '受到影响的岂止一两个行业？', en: "Is it really only one or two industries that have been affected?" },
          { zh: '名不正，何以服众？', en: "If the title is not right, how is one to carry the public?" },
        ],
      },
    ],
    vocab: [
      {
        theme: '近义辨析 (near-synonyms to keep apart)',
        words: [
          { zh: '制定', en: "draw up something binding: laws, policy, strategy" },
          { zh: '制订', en: "work out a plan or scheme, often still provisional" },
          { zh: '权利', en: "a right one is entitled to" },
          { zh: '权力', en: "power; authority to decide" },
          { zh: '淡薄', en: "thin, faint: mist, air, feeling" },
          { zh: '淡泊', en: "indifferent to fame and gain" },
          { zh: '起用', en: "appoint or reinstate a person" },
          { zh: '启用', en: "bring a facility, system or seal into use" },
          { zh: '反映', en: "report upward; mirror a state of affairs" },
          { zh: '反应', en: "react; a reaction" },
          { zh: '界限', en: "the limit between abstractions" },
          { zh: '界线', en: "a dividing line on the ground or on a map" },
        ],
      },
      {
        theme: '法律与政策 (law and policy)',
        words: [
          { zh: '条款', en: "clause; provision" },
          { zh: '追溯', en: "trace back; apply retroactively" },
          { zh: '豁免', en: "exempt; immunity" },
          { zh: '裁定', en: "rule on; a ruling" },
          { zh: '仲裁', en: "arbitrate; arbitration" },
          { zh: '生效', en: "come into force" },
          { zh: '撤销', en: "revoke; rescind" },
          { zh: '授权', en: "authorise; grant powers to" },
          { zh: '责令', en: "order a party to act" },
          { zh: '违约', en: "breach an agreement" },
          { zh: '管辖', en: "have jurisdiction over" },
          { zh: '条例', en: "regulations; an ordinance" },
        ],
      },
      {
        theme: '论证与治学 (argument and scholarship)',
        words: [
          { zh: '范式', en: "paradigm" },
          { zh: '证伪', en: "falsify a hypothesis" },
          { zh: '佐证', en: "corroborating evidence" },
          { zh: '谬误', en: "fallacy; error in reasoning" },
          { zh: '语境', en: "context of use" },
          { zh: '类比', en: "analogy; argue by analogy" },
          { zh: '甄别', en: "screen and distinguish" },
          { zh: '厘清', en: "disentangle; get clear" },
          { zh: '商榷', en: "take issue with; offer for discussion" },
          { zh: '立论', en: "set out a position" },
          { zh: '驳斥', en: "refute" },
          { zh: '严谨', en: "rigorous; carefully built" },
        ],
      },
      {
        theme: '语体与修辞 (register and rhetoric)',
        words: [
          { zh: '文体', en: "genre; style of a text" },
          { zh: '语域', en: "register" },
          { zh: '措辞', en: "wording; choice of words" },
          { zh: '修辞', en: "rhetoric; figures of speech" },
          { zh: '排比', en: "parallelism of clauses" },
          { zh: '对仗', en: "antithetical parallel construction" },
          { zh: '双关', en: "pun; double meaning" },
          { zh: '反诘', en: "rhetorical question" },
          { zh: '借代', en: "metonymy" },
          { zh: '行文', en: "the way a piece is written" },
          { zh: '笔调', en: "tone of writing" },
          { zh: '言外之意', en: "what is meant but not said" },
        ],
      },
      {
        theme: '分寸与推敲 (judgement and fine tuning)',
        words: [
          { zh: '斟酌', en: "weigh a wording carefully" },
          { zh: '拿捏', en: "gauge; get the measure of" },
          { zh: '权衡', en: "weigh one thing against another" },
          { zh: '贴切', en: "apt; exactly fitting" },
          { zh: '传神', en: "vivid; catches the spirit" },
          { zh: '生硬', en: "stiff; unidiomatic" },
          { zh: '拗口', en: "awkward to say aloud" },
          { zh: '晦涩', en: "obscure; hard going" },
          { zh: '冗长', en: "long-winded" },
          { zh: '洗练', en: "polished and spare" },
          { zh: '隽永', en: "of lasting savour" },
          { zh: '润色', en: "polish a text" },
        ],
      },
      {
        theme: '书面固定说法 (fixed written formulas)',
        words: [
          { zh: '一言以蔽之', en: "to put it in one word" },
          { zh: '不可同日而语', en: "not to be mentioned in the same breath" },
          { zh: '无独有偶', en: "and it is not an isolated case" },
          { zh: '由此可见', en: "from this it can be seen" },
          { zh: '众所周知', en: "as is well known" },
          { zh: '归根结底', en: "in the last analysis" },
          { zh: '时至今日', en: "to this day" },
          { zh: '顾名思义', en: "as the name suggests" },
          { zh: '换言之', en: "in other words" },
          { zh: '不足为奇', en: "hardly surprising" },
          { zh: '大同小异', en: "much the same, bar details" },
          { zh: '更有甚者', en: "worse still; what is more" },
        ],
      },
    ],
    passage: {
      title: '译事中的分寸',
      text:
        '讨论翻译标准时，人们最常引用的仍是信达雅三字。这一提法之所以历久不衰，盖因它简明；而它之所以屡遭质疑，也正因为它太简明。信与达之间尚可权衡，雅字一出，便牵涉到一个更棘手的问题：以谁的雅为准？\n\n' +
        '在实践中，真正考验译者的往往不是生词，而是语域。法律文本里的应当，与散文里的该，在词典上或许共用一个义项，在文章中却不可互换：前者带有强制的意味，后者只是随口的推断。同理，学术论文中的笔者认为若原样搬进新闻评论，读者会觉得作者在端着；反之，把网络流行语放进判决书，则近乎失职。词语本身无所谓高下，错的是把它们放在了不属于自己的场合。\n\n' +
        '因此，衡量一个译本是否成熟，与其看它有无硬伤，毋宁看它能否在通篇之中保持语气的一致。硬伤易改，语气一旦走样，往往改无可改。有经验的译者常说，翻译到最后拼的不是外语，而是母语：你能不能在汉语里，为一个陌生的句子找到一个既准确又自然的位置。',
      en:
        "In any discussion of translation standards, the three words faithfulness, fluency and elegance are still the formula most often quoted. It has lasted because it is simple, and it is attacked for exactly the same reason. Faithfulness and fluency can at least be traded off against each other; the moment elegance enters, a harder question follows: elegant by whose standard? In practice what tests a translator is not unfamiliar vocabulary but register. The 应当 of a legal text and the 该 of an essay may share a dictionary sense, yet they cannot be swapped in a document: the first is compulsion, the second an offhand inference. In the same way, the academic 笔者认为 dropped unchanged into a news column makes the writer sound as though he is putting on airs, while internet slang in a court judgment is close to professional failure. No word is inherently high or low; the error lies in putting it where it does not belong. Whether a translation is mature is therefore better judged by whether it holds one tone across the whole text than by whether it contains outright mistakes. Mistakes are easy to fix; once the tone has slipped, there is often nothing to be done. Experienced translators say that in the end translation is a contest not in the foreign language but in your own: whether you can find, in Chinese, a place for a strange sentence that is both accurate and natural.",
    },
    pitfalls: [
      {
        title: "Treating near-synonyms as free variants",
        detail:
          "制定 goes with 法律, 政策 and 战略, while 制订 goes with 计划 and 方案 and implies something still being drafted. 权利 is an entitlement, 权力 is authority. 界线 divides places, 界限 divides concepts. 起用 is for people, 启用 for facilities and systems. Every Chinese editor catches these, and none of them is a matter of taste.",
      },
      {
        title: "Register leaking across sentence boundaries",
        detail:
          "A translation can be accurate word by word and still fail, because 应当 came out as should in one clause and has to in the next, or because 笔者认为 has landed in a news report. Read the finished text once for tone alone, with the source out of sight, and mark every sentence that sounds as if a different person wrote it.",
      },
      {
        title: "Assuming mainland usage is the only usage",
        detail:
          "软件 and 软体, 信息 and 资讯, 出租车 and 计程车, 质量 and 品质, 视频 and 影片 divide along regional lines, and 窝心 is warm praise in Taiwan and a complaint in the mainland. Decide which variety a text is written for before you choose, and keep that choice consistent to the last line.",
      },
      {
        title: "Taking a rhetorical question at face value",
        detail:
          "岂, 难道, 何以 and 何尝 introduce questions that assert the opposite of what they appear to ask. A summary that reports 岂能一概而论 as a genuine query about whether one may generalise has inverted the author's position. Ask what answer the sentence forbids, and translate that answer.",
      },
    ],
    tips: [
      "Build near-synonym files rather than word lists: two words on a page, with the collocations that take only one of them.",
      "Translate a paragraph out of Chinese, leave it a day, translate it back, then compare your Chinese with the original wording rather than with your memory of it.",
      "Read across registers on the same event on purpose: a judgment, a news report, an official statement, a comment thread. Note precisely what changes and what does not.",
      "Check your own writing for register leaks by reading it as though a specialist in that field had written it. Whatever jars is the leak.",
      "Keep a file of sentences you understood but could never have produced, and rewrite one a day from its English gloss until your version matches.",
    ],
    exam: {
      format:
        "The same HSK 7-9 paper as levels 7 and 8: listening, reading, writing, written translation and speaking, in one sitting of about three hours. Level 9 is the top score band on that paper, awarded to candidates who hold up across all five sections rather than carrying a weak section on the strength of reading.",
      tips:
        "Level 9 is decided in the sections where a small error is visible, which means translation and speaking. Leave two minutes at the end to reread your translation for register alone. In the spoken monologue, state your position in the first sentence and spend the rest of the time supporting it; marks lost at this level are usually a matter of tone rather than of grammar.",
    },
  },
];
