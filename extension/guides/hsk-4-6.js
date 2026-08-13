// HSK 4-6: the Intermediate band of HSK 3.0 (国际中文教育中文水平等级标准, 2021).
//
// Levels 4-6 are where the language a learner reads stops matching the language
// they speak. The grammar sections therefore follow the standard's own teaching
// order: HSK 4 builds paired clause connectives on top of the beginner
// sentence, HSK 5 adds the formal alternatives to them, and HSK 6 is almost
// entirely a register syllabus.
//
// No pinyin is stored here. Readings come from CC-CEDICT at render time, and
// every vocab headword below is checked against the bundled dictionary by
// tests/hsk.test.mjs.

export const LEVELS_4_6 = [
  {
    level: 4,
    band: 'Intermediate',
    name: 'HSK 4',
    tagline: "Where sentences start linking up: conditions, concessions and consequences.",
    stats: {
      newWords: 1000,
      totalWords: 3245,
      newChars: 300,
      totalChars: 1200,
      grammarPoints: 76,
      studyHours: 'about 200-300 hours on top of HSK 3',
    },
    overview:
      "HSK 4 is the level where Chinese stops being a string of short sentences. Most of the thousand new words are two-character abstract nouns and verbs of the 责任, 竞争, 判断 type, and the grammar is dominated by paired connectives that hold two clauses together. Expect to spend more time on clause linking and on the 把 sentence than on vocabulary, because these are the structures that make longer speech possible at all.",
    canDo: [
      "Follow the main points of a work meeting or a classroom discussion held at normal speed.",
      "Explain the reasoning behind a decision, weighing two options against each other.",
      "Write a short email applying for a job, apologising for a delay or making a complaint.",
      "Read a news item on a familiar topic and retell it without looking anything up.",
      "Argue a simple position using 既然, 无论 and 即使 instead of stringing 然后 together.",
    ],
    grammar: [
      {
        point: 'Drawing a conclusion from an accepted fact: 既然...就',
        formula: '既然 + 已知情况，就 + 结论',
        explain:
          "既然 introduces a fact both speakers already accept, and the second clause draws the obvious conclusion from it. Unlike 因为 it never presents new information, which is why the result clause almost always carries 就, 那 or 也.",
        examples: [
          { zh: '既然你已经决定了，我就不再劝你了。', en: "Since you have already made up your mind, I won't try to talk you out of it." },
          { zh: '既然大家都同意这个方案，我们就明天开始吧。', en: 'Since everyone agrees with the plan, let us start tomorrow.' },
          { zh: '既然身体不舒服，你就别去加班了。', en: "Since you're not feeling well, don't go in to work overtime." },
        ],
      },
      {
        point: 'Objective cause and effect: 由于...因此',
        formula: '由于 + 原因，因此 + 结果',
        explain:
          "由于 is the written counterpart of 因为 and states an objective cause; the result clause takes 因此 or 所以. The asymmetry to remember is that 由于 can open a sentence on its own, while 因此 can only ever introduce a consequence, never a reason.",
        examples: [
          { zh: '由于天气原因，今天的航班都推迟了。', en: 'Because of the weather, all of today’s flights have been delayed.' },
          { zh: '由于缺少工作经验，他在面试中非常紧张，因此没有通过。', en: 'Because he lacked work experience he was very nervous in the interview, and so he did not pass.' },
        ],
      },
      {
        point: 'No matter what: 无论 / 不管...都',
        formula: '无论/不管 + 疑问形式，都/也 + 结果',
        explain:
          "The first clause has to contain an open element: a question word, an A 不 A form, or 还是. The second clause then states an outcome that does not vary, and it must carry 都 or 也. 无论 is the written form and 不管 the spoken one.",
        examples: [
          { zh: '无论遇到什么困难，他都不会放弃。', en: 'No matter what difficulties he runs into, he will not give up.' },
          { zh: '不管你同不同意，会议都得按时开始。', en: 'Whether you agree or not, the meeting has to start on time.' },
          { zh: '不管是坐飞机还是坐火车，时间都差不多。', en: 'Whether you fly or take the train, it takes about the same time.' },
        ],
      },
      {
        point: 'Conceding a hypothesis: 即使...也',
        formula: '即使 + 假设情况，也 + 结论',
        explain:
          "即使 concedes a situation that is hypothetical or even unlikely, and 也 says the outcome holds anyway. Compare 虽然, which concedes something that is actually the case. Choosing between the two is the single most common concession error at this level.",
        examples: [
          { zh: '即使明天下大雨，我们也要按时出发。', en: 'Even if it pours tomorrow, we are still setting off on time.' },
          { zh: '即使他不同意，这个决定也不会改变。', en: 'Even if he disagrees, the decision will not change.' },
          { zh: '即使工资低一点，我也想去大公司积累经验。', en: 'Even on a lower salary, I want to join a big company to build up experience.' },
        ],
      },
      {
        point: 'Singling out an extreme case: 连...都/也',
        formula: '连 + 强调成分 + 都/也 + 谓语',
        explain:
          "连 fronts the element you are singling out, and 都 or 也 must follow before the verb. The implied argument is a scale: if even this much is true, everything less extreme is true too. Dropping 都 makes the sentence ungrammatical, not merely flatter.",
        examples: [
          { zh: '他忙得连午饭都没时间吃。', en: 'He is so busy he does not even have time for lunch.' },
          { zh: '这个问题很简单，连孩子也懂。', en: 'The question is easy; even a child understands it.' },
          { zh: '我连一句话都没来得及说，他就走了。', en: 'He left before I could get even one word out.' },
        ],
      },
      {
        point: 'Adding a stronger point: 不仅...还 / 而且',
        formula: '不仅 + A，还/而且 + B',
        explain:
          "不仅 marks the first item as not the whole story, and the second clause adds something stronger. Word order depends on the subjects: when both clauses share one subject, 不仅 follows it; when the subjects differ, 不仅 goes in front of the first subject.",
        examples: [
          { zh: '他不仅会说英语，还会说日语和法语。', en: 'He speaks not only English but Japanese and French as well.' },
          { zh: '这份工作不仅工资高，而且离家很近。', en: 'The job pays well and, on top of that, is close to home.' },
          { zh: '不仅学生反对这个安排，老师也觉得不合适。', en: 'Not only did the students object to the arrangement, the teachers thought it unsuitable too.' },
        ],
      },
      {
        point: 'Sufficient versus necessary conditions: 只要...就 and 只有...才',
        formula: '只要 + 条件，就 + 结果 / 只有 + 条件，才 + 结果',
        explain:
          "只要 gives a sufficient condition, one of several routes to the result, and pairs with 就. 只有 gives the one necessary condition and pairs with 才. Mixing the pairs, especially 只有 with 就, changes the logic of the sentence rather than just its style.",
        examples: [
          { zh: '只要你努力，就一定会有进步。', en: 'As long as you put the work in, you are bound to improve.' },
          { zh: '只有多练习，发音才会准确。', en: 'Only with a lot of practice will your pronunciation become accurate.' },
          { zh: '只有先解决这个问题，我们才能继续下一步。', en: 'Only once this problem is settled can we move on to the next step.' },
        ],
      },
      {
        point: 'Topic markers: 对 / 对于 / 关于',
        formula: '对/对于 + 对象 + 谓语 / 关于 + 话题 + 名词性成分',
        explain:
          "对 aims an attitude or action at a target and can sit after the subject. 对于 is its formal twin and prefers the front of the sentence. 关于 introduces the subject matter a whole statement is about and usually leans on a noun such as 报告 or 规定, so it cannot replace 对 in 对我很好.",
        examples: [
          { zh: '这本书对我帮助很大。', en: 'This book has helped me a great deal.' },
          { zh: '对于这个问题，大家的看法并不一样。', en: 'On this question, opinions differ.' },
          { zh: '关于明天的活动，老师会另外通知大家。', en: 'As for tomorrow’s activity, the teacher will let everyone know separately.' },
        ],
      },
      {
        point: 'Causatives: 使 / 让 / 令',
        formula: '主语 + 使/让/令 + 对象 + 形容词/动词',
        explain:
          "All three introduce a caused state, but they differ in register and in what can cause the state. 让 is neutral and spoken. 使 is written and normally takes an abstract subject such as an event or a fact. 令 is the most formal and nearly always precedes an emotion word such as 感动 or 失望.",
        examples: [
          { zh: '这次经历使我明白了很多道理。', en: 'The experience made a great deal clear to me.' },
          { zh: '老板让我明天去出差。', en: 'My boss is sending me on a business trip tomorrow.' },
          { zh: '他的回答令人失望。', en: 'His answer was disappointing.' },
        ],
      },
      {
        point: 'Complex 把 sentences with 给, 成 and 在',
        formula: '主语 + 把 + 宾语 + 动词 + 给/成/在 + 补语',
        explain:
          "Once the verb has to say where the object ended up, who received it, or what it turned into, Chinese requires 把. Three conditions come with it: the object is definite, the verb cannot stand bare, and the element after the verb is obligatory.",
        examples: [
          { zh: '请把这份材料交给张经理。', en: 'Please hand these documents to Manager Zhang.' },
          { zh: '他把人民币换成美元了。', en: 'He changed the renminbi into dollars.' },
          { zh: '别把手机放在桌子上。', en: "Don't leave your phone on the table." },
        ],
      },
    ],
    vocab: [
      {
        theme: 'Work and career',
        words: [
          { zh: '招聘', en: 'to recruit; to advertise a post' },
          { zh: '应聘', en: 'to apply for an advertised job' },
          { zh: '职业', en: 'occupation; profession' },
          { zh: '工资', en: 'wages; salary' },
          { zh: '加班', en: 'to work overtime' },
          { zh: '收入', en: 'income; earnings' },
          { zh: '经验', en: 'experience gained by doing' },
          { zh: '能力', en: 'ability; capability' },
          { zh: '任务', en: 'assignment; task' },
          { zh: '责任', en: 'responsibility; liability' },
        ],
      },
      {
        theme: 'Opinions and discussion',
        words: [
          { zh: '看法', en: 'view; the way one sees something' },
          { zh: '意见', en: 'opinion; objection' },
          { zh: '建议', en: 'to suggest; a suggestion' },
          { zh: '讨论', en: 'to discuss' },
          { zh: '商量', en: 'to talk over; to consult' },
          { zh: '反对', en: 'to oppose' },
          { zh: '支持', en: 'to support; to back' },
          { zh: '解释', en: 'to explain; an explanation' },
          { zh: '判断', en: 'to judge; a judgement' },
          { zh: '怀疑', en: 'to doubt; to suspect' },
        ],
      },
      {
        theme: 'Feelings and personality',
        words: [
          { zh: '性格', en: 'personality; temperament' },
          { zh: '脾气', en: 'temper' },
          { zh: '幽默', en: 'humorous; humour' },
          { zh: '活泼', en: 'lively; outgoing' },
          { zh: '冷静', en: 'calm; level-headed' },
          { zh: '耐心', en: 'patience; patient' },
          { zh: '骄傲', en: 'proud; arrogant' },
          { zh: '后悔', en: 'to regret' },
          { zh: '感动', en: 'to be moved; to move someone' },
          { zh: '失望', en: 'disappointed' },
        ],
      },
      {
        theme: 'Society and the economy',
        words: [
          { zh: '社会', en: 'society' },
          { zh: '经济', en: 'economy; economic' },
          { zh: '发展', en: 'to develop; development' },
          { zh: '法律', en: 'law' },
          { zh: '教育', en: 'education; to educate' },
          { zh: '科学', en: 'science; scientific' },
          { zh: '技术', en: 'technology; skill' },
          { zh: '污染', en: 'pollution; to pollute' },
          { zh: '国际', en: 'international' },
          { zh: '市场', en: 'market' },
        ],
      },
      {
        theme: 'Study and thinking',
        words: [
          { zh: '知识', en: 'knowledge' },
          { zh: '基础', en: 'foundation; basis' },
          { zh: '积累', en: 'to accumulate' },
          { zh: '理解', en: 'to understand; comprehension' },
          { zh: '总结', en: 'to sum up; a summary' },
          { zh: '考虑', en: 'to consider' },
          { zh: '研究', en: 'to research; research' },
          { zh: '阅读', en: 'to read; reading' },
          { zh: '专业', en: 'major; specialist field' },
          { zh: '毕业', en: 'to graduate' },
        ],
      },
      {
        theme: 'Connectives that carry a clause',
        words: [
          { zh: '既然', en: 'since; now that' },
          { zh: '无论', en: 'no matter what' },
          { zh: '即使', en: 'even if' },
          { zh: '不仅', en: 'not only' },
          { zh: '由于', en: 'owing to; because of' },
          { zh: '因此', en: 'therefore; for this reason' },
          { zh: '于是', en: 'thereupon; and so' },
          { zh: '然而', en: 'however; and yet' },
          { zh: '尽管', en: 'even though; despite' },
          { zh: '否则', en: 'otherwise; if not' },
        ],
      },
      {
        theme: 'Travel and getting about',
        words: [
          { zh: '航班', en: 'scheduled flight' },
          { zh: '签证', en: 'visa' },
          { zh: '大使馆', en: 'embassy' },
          { zh: '出差', en: 'to go on a business trip' },
          { zh: '导游', en: 'tour guide' },
          { zh: '风景', en: 'scenery' },
          { zh: '堵车', en: 'traffic jam' },
          { zh: '郊区', en: 'suburbs; outskirts' },
          { zh: '迷路', en: "to lose one's way" },
          { zh: '房东', en: 'landlord' },
        ],
      },
    ],
    passage: {
      title: '面试之后',
      text: '小林大学毕业以后，一直在找工作。上个月他去一家国际公司应聘。面试的时候，经理问他有什么优点，他想了想，回答说自己做事比较仔细，而且不怕加班。经理笑着说，这样的态度当然很好，不过公司更重视的是解决问题的能力。\n\n一个星期以后，公司通知他通过了面试。工资不算太高，可是他觉得，能够积累经验比什么都重要。既然选择了这个专业，就应该从最基础的工作做起。\n\n现在他每天七点起床，坐地铁去郊区的办公室，路上常常堵车。同事们都说他很努力，他却说：“无论做什么工作，只要认真，总会有收获。”',
      en: "Xiao Lin has been job-hunting ever since he graduated. Last month he applied to an international company. At the interview the manager asked what his strengths were; he thought for a moment and said that he was fairly careful in his work and did not mind overtime. The manager smiled and said the attitude was fine, but what the company valued more was the ability to solve problems. A week later the company told him he had passed. The pay is not high, but he feels that building up experience matters more than anything else: having chosen this field, he should start from the most basic work. These days he gets up at seven, takes the subway out to an office in the suburbs and is often stuck in traffic on the way. His colleagues say he works hard. He says that whatever the job, as long as you take it seriously there is always something to be gained.",
    },
    pitfalls: [
      {
        title: '把 with verbs that dispose of nothing',
        detail:
          "把 needs a verb that does something to its object and leaves a result behind. 我把这本书喜欢 and 他把汉语会说 are impossible, because 喜欢 and 会说 change nothing. If you cannot name the result — moved where, changed into what, handed to whom — write a plain subject-verb-object sentence instead.",
      },
      {
        title: '才 and 就 pointing in the wrong direction',
        detail:
          "就 says an event happened earlier or more easily than expected; 才 says it happened later or took more effort. 他五点就来了 praises his earliness, while 他九点才来 complains about his lateness. 才 also blocks the perfective 了 on the verb: 他昨天才到 is right, 他昨天才到了 is not.",
      },
      {
        title: '虽然 used where 即使 is required',
        detail:
          "虽然 concedes a fact, 即使 concedes a hypothesis. 虽然明天下雨 is wrong because tomorrow's rain has not happened; the sentence needs 即使明天下雨,我们也去. In the other direction, 即使他昨天来了 misdescribes an event you know took place, and a listener will hear it as doubt about your own report.",
      },
      {
        title: 'Result complements left off resultative verbs',
        detail:
          "At HSK 4 the bare verb under-reports what happened. 我找工作 means you are looking; 我找到工作了 means you found one. The same split runs through 听 and 听懂, 看 and 看见, 学 and 学会. Omitting the complement is heard as an attempt that did not come off, not as a neutral statement.",
      },
    ],
    tips: [
      "Learn the paired connectives as pairs, out loud, and never write the first half without the second: 既然 wants 就, 无论 wants 都, 即使 wants 也, 只有 wants 才.",
      "Store the new abstract nouns with the verbs that go with them. 提出建议, 引起注意, 积累经验 and 承担责任 are collocations you memorise, not combinations you can derive.",
      "Read each passage twice, once for meaning and once watching the commas. HSK 4 sentences are long, and knowing where a clause ends is most of understanding them.",
      "Write one short paragraph a day that is required to contain a 把 sentence and one paired connective. The constraint forces the two structures you would otherwise route around.",
    ],
    exam: {
      format:
        'About 100 minutes of testing: roughly 45 listening questions, 40 reading questions, and a writing section of about 15 items in which you order scrambled words into sentences and write a sentence from a picture and a given word. Scored out of 300, with 180 to pass.',
      tips:
        'The writing section is where marks are cheapest to protect, because the scrambled-word items are graded on word order alone. Drill the time, place, manner, verb sequence and the position of 把 until it is automatic. In reading, clear the questions that quote a phrase from the text first and leave inference items for the end.',
    },
  },

  {
    level: 5,
    band: 'Intermediate',
    name: 'HSK 5',
    tagline: 'Written Chinese begins: formal connectives, 成语, and opinions you have to defend.',
    stats: {
      newWords: 1071,
      totalWords: 4316,
      newChars: 300,
      totalChars: 1500,
      grammarPoints: 71,
      studyHours: 'about 400-500 hours on top of HSK 4',
    },
    overview:
      "HSK 5 is the point at which the Chinese you read stops matching the Chinese you speak. Of the new words, a large share are abstract nouns, four-character idioms and connectives that hardly ever occur in conversation. The grammar shifts to match: instead of new sentence types you learn formal alternatives to the patterns you already control, so knowing which register a structure belongs to becomes as important as forming it correctly.",
    canDo: [
      'Read a newspaper feature or an opinion column and identify the writer’s position, not just the facts.',
      'Give a prepared talk of several minutes on a social topic with a clear structure and suitable connectives.',
      'Take part in a work discussion, disagree politely, and concede a point without giving up the argument.',
      'Follow a contemporary film or television drama with only occasional gaps.',
      'Write an argumentative essay that weighs two options and reaches a defended conclusion.',
    ],
    grammar: [
      {
        point: 'Taking one thing as another: 以...为',
        formula: '以 + A + 为 + B',
        explain:
          "A compressed written pattern meaning to take A as B, replacing 把 A 当作 B in formal prose. Both slots hold noun phrases rather than clauses, and nothing may come between 以 and its object. It also underlies fixed expressions such as 以...为主 and 以人为本.",
        examples: [
          { zh: '这所学校以培养学生的独立思考能力为目标。', en: 'This school takes the development of independent thinking as its goal.' },
          { zh: '南方的居民以米饭为主食。', en: 'People in the south take rice as their staple food.' },
          { zh: '这次会议以讨论明年的计划为主。', en: 'The meeting is mainly given over to discussing next year’s plan.' },
        ],
      },
      {
        point: 'Result first, reason second: 之所以...是因为',
        formula: '之所以 + 结果，是因为 + 原因',
        explain:
          "This inverts the normal order so the outcome can be stated first and the reason presented as the point of the sentence. The subject sits before 之所以, and the 是因为 clause carries the new information, which makes the pattern the natural written answer to a 为什么 question.",
        examples: [
          { zh: '他之所以放弃这个机会，是因为家里有更重要的事。', en: 'The reason he gave up the opportunity is that something more important came up at home.' },
          { zh: '这项政策之所以引起这么多讨论，是因为它影响的人太多了。', en: 'The reason this policy has provoked so much discussion is that it affects so many people.' },
        ],
      },
      {
        point: 'Weighing two options: 与其...不如 and 宁可...也不',
        formula: '与其 A，不如 B / 宁可 A，也不 B',
        explain:
          "Both patterns compare two courses of action, but they point in opposite directions. 与其 A 不如 B rejects A and recommends B, so the preferred option comes second. 宁可 A 也不 B accepts an unwelcome A in order to avoid a worse B, so the preferred option comes first.",
        examples: [
          { zh: '与其在这里等下去，不如换一条路走。', en: 'Rather than go on waiting here, we would do better to take another route.' },
          { zh: '与其抱怨环境，不如改变自己。', en: 'Rather than complain about your circumstances, change yourself.' },
          { zh: '他宁可加班到深夜，也不愿意把工作交给别人。', en: 'He would rather work until midnight than hand the job to someone else.' },
        ],
      },
      {
        point: 'Two sides of one situation: 一方面...另一方面',
        formula: '一方面 + A，另一方面 + B',
        explain:
          "Presents two aspects of a single situation as equally weighted, whether complementary or in tension. Unlike 不仅...还 it does not escalate: the second clause offers a different angle rather than a stronger version of the first. In writing the two halves are usually parallel in length and structure.",
        examples: [
          { zh: '这样做一方面能节约成本，另一方面也保护了环境。', en: 'Doing it this way saves money on one hand and protects the environment on the other.' },
          { zh: '他一方面想留在大城市发展，另一方面又舍不得离开父母。', en: 'Part of him wants to build a career in the city, and part of him cannot bear to leave his parents.' },
        ],
      },
      {
        point: 'Change tracking change: 随着...而',
        formula: '随着 + 变化的情况，主语 + 而 + 变化',
        explain:
          "随着 introduces one change, and the main clause states a second change that tracks it. The fuller written form places 而 directly before the verb of the main clause. Because 随着 takes a noun phrase, any verb inside it has to be nominalised with 的.",
        examples: [
          { zh: '随着经济的发展，人们的消费观念也在不断改变。', en: 'As the economy develops, attitudes to spending keep changing too.' },
          { zh: '随着年龄的增长，他的想法逐渐成熟起来。', en: 'As he grew older his thinking gradually matured.' },
          { zh: '城市的房价随着人口的增加而不断提高。', en: 'City house prices rise steadily as the population grows.' },
        ],
      },
      {
        point: 'Adding the stronger case: 何况 and 更何况',
        formula: '……都……，何况 + 更极端的情况 + 呢',
        explain:
          "何况 strengthens an argument already made: if the first situation holds, the second must hold all the more. It normally follows a clause containing 都 or a negative, and the 何况 clause often closes with 呢. 更何况 is simply the intensified form.",
        examples: [
          { zh: '这么难的题，大人都做不出来，何况孩子呢？', en: 'Adults cannot solve a problem this hard, so how could a child?' },
          { zh: '平时他都很少说话，更何况在这么多人面前。', en: 'He says little at the best of times, let alone in front of a crowd like this.' },
        ],
      },
      {
        point: 'Hedging: 未必, 难免, 万一',
        formula: '未必 + 判断 / 难免 + 不好的结果 / 万一 + 假设，就 + 应对',
        explain:
          "Three hedges that learners tend to flatten into 不一定, 常常 and 如果. 未必 denies an assumption the listener is likely to hold. 难免 says an unwelcome outcome is hard to avoid. 万一 raises a low-probability but serious possibility, and its main clause usually names a precaution.",
        examples: [
          { zh: '价格高的东西未必质量就好。', en: 'Expensive things are not necessarily well made.' },
          { zh: '刚开始工作，难免会出一些小错误。', en: 'When you first start a job, small mistakes are hard to avoid.' },
          { zh: '万一路上堵车，我们就赶不上飞机了。', en: 'If we happen to hit traffic, we will miss the plane.' },
        ],
      },
      {
        point: 'A settled conclusion: 不管...反正',
        formula: '不管 + 变化的条件，反正 + 不变的结论',
        explain:
          "反正 restates a conclusion as already settled whatever precedes it, and it frequently answers a 不管 clause. It adds a note of finality or mild impatience that plain 都 does not carry, which is why it belongs to speech rather than to formal writing.",
        examples: [
          { zh: '不管你怎么说，反正我不同意。', en: 'Say what you like, I am not agreeing.' },
          { zh: '不管明天下不下雨，反正我们都得去。', en: 'Rain or not, we have to go tomorrow.' },
        ],
      },
      {
        point: 'Passives: 被, 由, and 为...所',
        formula: '受事 + 被/由/为 + 施事 + 所 + 动词',
        explain:
          "被 marks an ordinary passive and usually implies an unwelcome result. 由 assigns responsibility and is entirely neutral, as in 这件事由我负责. 为...所 is a literary passive that takes a bare one-syllable verb and appears mainly in written commentary, as in 为人所知.",
        examples: [
          { zh: '这个建议已经被公司拒绝了。', en: 'The proposal has already been turned down by the company.' },
          { zh: '会议的具体安排由王经理负责。', en: 'Manager Wang is responsible for the detailed arrangements for the meeting.' },
          { zh: '他多年的努力终于为大家所理解。', en: 'His years of effort were at last understood by everyone.' },
        ],
      },
      {
        point: 'Aspectual complements: 起来, 下去, 下来',
        formula: '动词/形容词 + 起来 / 下去 / 下来',
        explain:
          "Beyond their literal directions these complements mark phases. 起来 marks a state beginning, and also the sense of when you try it, as in 说起来容易. 下去 marks continuation of something already under way. 下来 marks a process settling into a stable result, often loud to quiet or fast to slow.",
        examples: [
          { zh: '听到这个消息，大家都高兴起来了。', en: 'Everyone cheered up when they heard the news.' },
          { zh: '这样的日子，我实在坚持不下去了。', en: 'I really cannot keep going like this.' },
          { zh: '天慢慢黑下来，街上安静了许多。', en: 'The sky slowly darkened and the street grew much quieter.' },
        ],
      },
    ],
    vocab: [
      {
        theme: 'Abstract nouns for argument',
        words: [
          { zh: '观念', en: 'concept; way of thinking' },
          { zh: '概念', en: 'concept; notion' },
          { zh: '现象', en: 'phenomenon' },
          { zh: '因素', en: 'factor; element' },
          { zh: '趋势', en: 'trend; tendency' },
          { zh: '本质', en: 'essence; intrinsic nature' },
          { zh: '前提', en: 'premise; precondition' },
          { zh: '后果', en: 'consequence, normally a bad one' },
          { zh: '原则', en: 'principle' },
          { zh: '价值', en: 'value; worth' },
        ],
      },
      {
        theme: 'Four-character idioms',
        words: [
          { zh: '实事求是', en: 'to be realistic and go by the facts' },
          { zh: '半途而废', en: 'to give up halfway' },
          { zh: '理所当然', en: 'only natural; a matter of course' },
          { zh: '一举两得', en: 'to kill two birds with one stone' },
          { zh: '迫不及待', en: 'too impatient to wait' },
          { zh: '全力以赴', en: 'to go all out' },
          { zh: '三心二意', en: 'half-hearted; unable to commit' },
          { zh: '名副其实', en: 'to live up to the name' },
          { zh: '精打细算', en: 'to budget carefully' },
          { zh: '一模一样', en: 'exactly alike' },
        ],
      },
      {
        theme: 'Workplace and business',
        words: [
          { zh: '岗位', en: 'post; job position' },
          { zh: '业务', en: 'professional work; line of business' },
          { zh: '效率', en: 'efficiency' },
          { zh: '合同', en: 'contract' },
          { zh: '谈判', en: 'to negotiate; negotiations' },
          { zh: '培训', en: 'to train; training' },
          { zh: '辞职', en: 'to resign' },
          { zh: '项目', en: 'project; item' },
          { zh: '待遇', en: 'pay and conditions; treatment' },
          { zh: '业绩', en: 'performance; results achieved' },
        ],
      },
      {
        theme: 'Social issues',
        words: [
          { zh: '人口', en: 'population' },
          { zh: '就业', en: 'to find employment' },
          { zh: '贫困', en: 'poverty; impoverished' },
          { zh: '资源', en: 'resources' },
          { zh: '福利', en: 'welfare; benefits' },
          { zh: '犯罪', en: 'to commit a crime' },
          { zh: '医疗', en: 'medical care' },
          { zh: '差距', en: 'gap; disparity' },
          { zh: '环保', en: 'environmental protection' },
          { zh: '政策', en: 'policy' },
        ],
      },
      {
        theme: 'Media and reporting',
        words: [
          { zh: '媒体', en: 'the media' },
          { zh: '报道', en: 'to report; a news report' },
          { zh: '采访', en: 'to interview; to cover a story' },
          { zh: '传播', en: 'to spread; to disseminate' },
          { zh: '评论', en: 'to comment; commentary' },
          { zh: '频道', en: 'channel' },
          { zh: '栏目', en: 'column; regular programme slot' },
          { zh: '标题', en: 'headline; title' },
          { zh: '直播', en: 'live broadcast' },
          { zh: '观点', en: 'viewpoint; standpoint' },
        ],
      },
      {
        theme: 'Near-synonyms to keep apart',
        words: [
          { zh: '保持', en: 'to keep something as it is' },
          { zh: '维持', en: 'to maintain something under strain' },
          { zh: '改善', en: 'to improve conditions' },
          { zh: '改进', en: 'to improve a method' },
          { zh: '承担', en: 'to take on a duty or cost' },
          { zh: '承受', en: 'to bear pressure or loss' },
          { zh: '具备', en: 'to possess a required quality' },
          { zh: '具有', en: 'to have an attribute' },
          { zh: '珍惜', en: 'to treasure; to value' },
          { zh: '爱惜', en: 'to use sparingly; to look after' },
        ],
      },
      {
        theme: 'Connectives and hedges',
        words: [
          { zh: '总之', en: 'in short; in a word' },
          { zh: '除非', en: 'unless' },
          { zh: '一旦', en: 'once; the moment that' },
          { zh: '何况', en: 'let alone; much less' },
          { zh: '反而', en: 'on the contrary' },
          { zh: '宁可', en: 'would rather' },
          { zh: '与其', en: 'rather than' },
          { zh: '未必', en: 'not necessarily' },
          { zh: '难免', en: 'hard to avoid' },
          { zh: '万一', en: 'in case; if by any chance' },
        ],
      },
    ],
    passage: {
      title: '加班未必等于效率',
      text: '近几年，加班几乎成了不少行业的普遍现象。一方面，企业希望在激烈的竞争中提高业绩；另一方面，员工担心自己一旦按时下班，就会被认为不够努力。于是，办公室的灯常常亮到深夜，可真正的效率未必因此提高。\n\n有研究表明，人的注意力是有限的。长时间工作之后，出错难免增多，后果往往要花更多的时间去处理。与其让员工在疲劳中勉强坚持，不如给他们充分的休息，让他们第二天以更好的状态投入工作。\n\n随着观念的改变，已经有一些公司开始尝试更灵活的管理方式。它们把评价的重点从“在岗位上待了多久”改成“完成了多少工作”。这样的做法未必适合所有行业，但至少提醒我们：判断一个员工的价值，时间从来不是唯一的标准。',
      en: "In recent years overtime has become the norm in a good many industries. On one side, firms want better results in fierce competition; on the other, staff worry that leaving on time even once will be read as a lack of commitment. So the office lights burn late into the night, and yet real efficiency does not necessarily rise. Research shows that attention is finite. After long hours mistakes are hard to avoid, and the damage usually costs more time to put right than was saved. Rather than have staff struggle on while exhausted, it is better to give them proper rest so they can start the next day in better shape. As attitudes change, some companies have begun trying more flexible management, shifting the focus of appraisal from how long someone sat at a desk to how much work was finished. Not every industry can copy this, but it is a reminder that time was never the only measure of an employee's worth.",
    },
    pitfalls: [
      {
        title: '成语 glossed character by character',
        detail:
          "A four-character idiom carries a fixed function as well as a meaning. 半途而废 is a criticism and needs someone who gave up; 一举两得 evaluates a plan rather than a person; 理所当然 comments on a judgement, not an action. Translating the characters and dropping the phrase into any slot yields sentences a reader can parse but would never write.",
      },
      {
        title: '被 where Chinese prefers an active or notional passive',
        detail:
          "English uses the passive far more than Chinese does. 这个问题已经解决了 and 饭做好了 are the natural forms; 这个问题已经被解决了 reads as translation. Keep 被 for cases where the agent matters or the outcome is unwelcome, and reach for 由 when you are assigning a task rather than reporting a misfortune.",
      },
      {
        title: 'Spoken hedges left in a written register',
        detail:
          "反正, 挺, 差不多 and 好像 belong to conversation. In an HSK 5 essay they read as casual and graders mark them down. The written equivalents are 无论如何, 相当, 大致 and 似乎. Build the swap into a revision pass rather than fighting it in the first draft, where fluency matters more.",
      },
      {
        title: '与其 and 宁可 with the halves reversed',
        detail:
          "The option you recommend follows 不如 but precedes 也不. 与其买新的,不如修一修 recommends repairing, and 宁可修一修,也不买新的 recommends repairing too. Swap the halves of either pattern and you argue the opposite of what you meant, which is the most frequent error in comparison essays.",
      },
    ],
    tips: [
      'Read the same article twice: once for content, once marking only the connectives. Progress at this level is measured in connectives, not in nouns.',
      'Make near-synonym cards in pairs rather than singly: 保持 and 维持, 改善 and 改进, 承担 and 承受. Put the collocations on the back, because the difference is almost always which nouns each one accepts.',
      'Reduplicate verbs when you want to sound tentative: 我们商量商量, 你看看, 让我想一想. Speaking tasks reward this softening, and its absence makes ordinary requests sound like orders.',
      'Keep two vocabulary lists, one for words you only need to recognise in print and one for words you actually use. At HSK 5 the first list should be roughly twice the size of the second.',
    ],
    exam: {
      format:
        'Around 125 minutes: about 45 listening questions, 45 reading questions, and a 40-minute writing section with ten scrambled-sentence items and two compositions, one built from given words and one from a picture. Scored out of 300, with 180 to pass.',
      tips:
        'The two compositions repay preparation more than anything else on the paper. Learn one flexible essay skeleton — state a position, give two supporting reasons with 一方面 and 另一方面, concede a point with 当然, restate — and practise filling it on different topics until the frame costs you no thinking time.',
    },
  },

  {
    level: 6,
    band: 'Intermediate',
    name: 'HSK 6',
    tagline: 'Written register mastery: literary connectives, 四字格 rhythm, and implied meaning.',
    stats: {
      newWords: 1140,
      totalWords: 5456,
      newChars: 300,
      totalChars: 1800,
      grammarPoints: 67,
      studyHours: 'about 500-600 hours on top of HSK 5',
    },
    overview:
      "HSK 6 is far less about new sentence patterns than about register. The new words are dominated by literary connectives, four-character idioms and abstract nouns that a native reader meets daily but rarely says aloud. The grammar is largely a set of formal substitutions — 因而 for 所以, 无不 for 都, 所 plus a verb for a relative clause — together with the rhythmic habits, above all four-character parallelism, that make written Chinese sound like writing rather than transcribed speech.",
    canDo: [
      'Read editorials, academic abstracts and official notices without losing the thread of the argument.',
      'Judge a writer’s attitude from register alone, including irony conveyed by understatement.',
      'Summarise a long article in a handful of sentences that preserve its logical structure.',
      'Write formal correspondence, a report or a review in a register suited to its reader.',
      'Follow an unscripted panel discussion or a lecture on an unfamiliar academic subject.',
    ],
    grammar: [
      {
        point: 'Written result connectives: 从而, 进而, 因而',
        formula: '前句，从而/进而/因而 + 后句',
        explain:
          "Three written connectives that are not interchangeable. 从而 marks a result the preceding action made possible. 进而 marks a further step taken once the first one succeeds. 因而 states a plain consequence and is the written 所以. All three attach to a predicate rather than to a new subject, so the second clause usually has no subject of its own.",
        examples: [
          { zh: '新技术降低了生产成本，从而使产品价格明显下降。', en: 'The new technology cut production costs, thereby bringing prices down sharply.' },
          { zh: '我们先要弄清问题的原因，进而找出解决的办法。', en: 'We must first establish the cause of the problem and then go on to find a solution.' },
          { zh: '他长期缺乏锻炼，因而身体越来越差。', en: 'He has gone without exercise for years, and his health has suffered accordingly.' },
        ],
      },
      {
        point: 'Unwelcome consequences: 以致 and 致使',
        formula: '原因 + 以致（于） + 不良结果 / 原因 + 致使 + 对象 + 谓语',
        explain:
          "Both introduce a consequence and both are restricted to bad ones. 以致 takes a clause describing what went wrong and often appears as 以致于. 致使 is a causative verb and must be followed by an object plus a predicate, as in 致使多人受伤. Using either for a welcome outcome is a register error, not merely a stylistic slip.",
        examples: [
          { zh: '他事先准备不足，以致在会上无法回答对方的提问。', en: 'He had not prepared enough, with the result that he could not answer the questions put to him at the meeting.' },
          { zh: '管理上的疏忽致使这批产品出现了严重的质量问题。', en: 'Lax management resulted in serious quality problems in this batch of goods.' },
        ],
      },
      {
        point: 'Reversing and escalating: 反之 and 乃至',
        formula: 'A ……；反之，B …… / A，乃至 B',
        explain:
          "反之 turns to the opposite case and stands alone before a comma, meaning if the reverse holds. 乃至 escalates a list to its most extreme member and is stronger than 甚至 in written prose. Both operate at sentence level, so neither can be squeezed between a verb and its object.",
        examples: [
          { zh: '制度合理，人才自然愿意留下；反之，再高的工资也留不住人。', en: 'Where the system is sound, talented people stay of their own accord; where it is not, no salary will hold them.' },
          { zh: '这项发现影响了整个行业，乃至改变了人们的生活方式。', en: 'The discovery reshaped the whole industry and even changed the way people live.' },
        ],
      },
      {
        point: 'Arguing from the stronger case: 尚且...何况',
        formula: 'A 尚且 + 谓语，何况 + B + 呢',
        explain:
          "A formal argument from the stronger case: if even A holds, then B certainly does. 尚且 sits after the first subject and the 何况 clause commonly closes with 呢. The two subjects have to be genuinely comparable on the same scale, or the inference does not go through.",
        examples: [
          { zh: '专家尚且不敢轻易下结论，何况我们这些外行呢？', en: 'Even the experts hesitate to draw a conclusion, so what about laymen like us?' },
          { zh: '大人尚且觉得吃力，何况一个十岁的孩子呢？', en: 'Even adults find it hard going, let alone a ten-year-old.' },
        ],
      },
      {
        point: 'Parallel developments: 与此同时',
        formula: '前句。与此同时，后句。',
        explain:
          "Links two developments unfolding together, at the level of the paragraph rather than the clause. It is the written counterpart of 同时 and normally opens a new sentence after a full stop. Unlike 一边...一边 it does not require a shared subject, which is exactly why reports rely on it.",
        examples: [
          { zh: '城市人口不断增加。与此同时，交通和住房的压力也在加大。', en: 'The urban population keeps growing. At the same time, pressure on transport and housing is mounting.' },
          { zh: '网络购物迅速发展，与此同时，传统商店的经营越来越困难。', en: 'Online shopping has grown fast; meanwhile, traditional shops find trading ever harder.' },
        ],
      },
      {
        point: 'Framing a claim: 就...而言 and 在...看来',
        formula: '就 + 范围 + 而言，…… / 在 + 某人 + 看来，……',
        explain:
          "Two ways of framing a claim before you make it. 就...而言 limits the claim to one dimension so the reader knows you are not overreaching. 在...看来 attributes the view to someone, often to hold it at arm's length. Both are set frames: swapping 而言 for 来说 drops the register a full step.",
        examples: [
          { zh: '就目前的情况而言，这个计划还缺乏可行性。', en: 'As things stand at present, the plan is not yet workable.' },
          { zh: '在许多学者看来，这一现象与人口结构的变化密切相关。', en: 'In the view of many scholars, this phenomenon is closely tied to changes in the population structure.' },
        ],
      },
      {
        point: 'Emphatic universals: 无不 and 莫不',
        formula: '主语 + 无不/莫不 + 谓语',
        explain:
          "A double negative meaning there is not one that does not, that is, every single one. It is emphatic where 都 is neutral, and it belongs to written commentary. The predicate must be a single verb phrase, and no 都 may follow, since 无不 already carries the universal force.",
        examples: [
          { zh: '听过他演讲的人无不深受感动。', en: 'Everyone who has heard him speak has been deeply moved.' },
          { zh: '凡是了解内情的人，莫不为此感到遗憾。', en: 'There is no one familiar with the facts who does not regret it.' },
        ],
      },
      {
        point: 'Understatement: 不无 and 未尝不',
        formula: '不无 + 双音节名词 / 未尝不 + 动词',
        explain:
          "Guarded agreement expressed by double negation. 不无道理 means there is something in it, well short of endorsement. 未尝不 concedes that a possibility cannot be ruled out. Both signal caution, so reading either as enthusiastic agreement inverts the writer's stance.",
        examples: [
          { zh: '他的批评虽然尖锐，却不无道理。', en: 'His criticism is sharp, but there is something in it.' },
          { zh: '换个角度看，这未尝不是一件好事。', en: 'Looked at another way, this may well be no bad thing.' },
        ],
      },
      {
        point: 'Formal nominalisation: 所 + verb, and 之',
        formula: '（主语）+ 所 + 动词 + 的 + 名词 / 名词 + 之 + 名词',
        explain:
          "所 before a verb turns the clause into a formal modifier and marks the following noun as that verb's object, as in 我所了解的情况. 之 is the literary 的 and survives mainly in fixed frames such as 之一, 之间, 总之 and 原因之一. Neither adds meaning; both raise the register.",
        examples: [
          { zh: '报告中所提到的问题，大多与管理制度有关。', en: 'Most of the problems mentioned in the report concern the management system.' },
          { zh: '这是我们目前面临的最大挑战之一。', en: 'This is one of the greatest challenges we currently face.' },
          { zh: '众所周知，教育乃社会发展之本。', en: 'As everyone knows, education is the foundation of social development.' },
        ],
      },
      {
        point: 'Four-character parallel structures',
        formula: '四字格 + 、 + 四字格（如：因地制宜、量力而行）',
        explain:
          "Written Chinese prefers even-numbered rhythmic chunks, and pairs of four-character units are the commonest. The same instinct explains why writers pick 进行讨论 over 讨论 and 加以改进 over 改进: the longer verb balances the phrase. Reading aloud is the quickest way to hear whether a sentence has the rhythm.",
        examples: [
          { zh: '各地情况不同，应当因地制宜，量力而行。', en: 'Conditions differ from place to place, so measures should suit local circumstances and stay within available means.' },
          { zh: '双方求同存异，取长补短，合作才可能长期进行。', en: 'Only by seeking common ground while respecting differences, and by learning from each other, can the two sides cooperate over the long term.' },
        ],
      },
    ],
    vocab: [
      {
        theme: 'Connectives of formal prose',
        words: [
          { zh: '从而', en: 'thus; thereby' },
          { zh: '进而', en: 'and then, going a step further' },
          { zh: '因而', en: 'therefore; as a result' },
          { zh: '反之', en: 'conversely; the other way round' },
          { zh: '乃至', en: 'and even; going as far as' },
          { zh: '以致', en: 'with the result that, usually bad' },
          { zh: '致使', en: 'to cause; to bring about' },
          { zh: '鉴于', en: 'in view of' },
          { zh: '况且', en: 'moreover; besides' },
          { zh: '继而', en: 'then; subsequently' },
        ],
      },
      {
        theme: 'Advanced idioms',
        words: [
          { zh: '层出不穷', en: 'to keep emerging one after another' },
          { zh: '潜移默化', en: 'to influence imperceptibly over time' },
          { zh: '循序渐进', en: 'to proceed step by step in order' },
          { zh: '息息相关', en: 'closely bound up with each other' },
          { zh: '微不足道', en: 'negligible; too slight to mention' },
          { zh: '恰到好处', en: 'pitched exactly right' },
          { zh: '众所周知', en: 'as everyone knows' },
          { zh: '无动于衷', en: 'unmoved; entirely indifferent' },
          { zh: '一如既往', en: 'just as always; unchanged' },
          { zh: '归根到底', en: 'in the final analysis' },
        ],
      },
      {
        theme: 'Academic and analytical nouns',
        words: [
          { zh: '范畴', en: 'category; domain' },
          { zh: '机制', en: 'mechanism' },
          { zh: '层面', en: 'level; aspect' },
          { zh: '逻辑', en: 'logic' },
          { zh: '依据', en: 'basis; grounds' },
          { zh: '论证', en: 'to argue a case; argumentation' },
          { zh: '假设', en: 'to suppose; a hypothesis' },
          { zh: '体系', en: 'system; framework' },
          { zh: '命题', en: 'proposition; to set a topic' },
          { zh: '范围', en: 'scope; range' },
        ],
      },
      {
        theme: 'Institutions and governance',
        words: [
          { zh: '制度', en: 'system; institution' },
          { zh: '体制', en: 'structure of an organisation or state' },
          { zh: '舆论', en: 'public opinion' },
          { zh: '监督', en: 'to supervise; oversight' },
          { zh: '法规', en: 'laws and regulations' },
          { zh: '决策', en: 'policy decision; to decide policy' },
          { zh: '改革', en: 'to reform; reform' },
          { zh: '治理', en: 'to govern; to bring under control' },
          { zh: '财政', en: 'public finance' },
          { zh: '秩序', en: 'order; proper sequence' },
        ],
      },
      {
        theme: 'Adverbs of stance and degree',
        words: [
          { zh: '显著', en: 'marked; notable' },
          { zh: '空前', en: 'unprecedented' },
          { zh: '颇', en: 'quite; rather' },
          { zh: '未免', en: 'rather too; a bit excessively' },
          { zh: '不免', en: 'inevitably' },
          { zh: '姑且', en: 'for the time being; provisionally' },
          { zh: '索性', en: 'might as well; simply go ahead and' },
          { zh: '大抵', en: 'broadly speaking' },
          { zh: '一律', en: 'without exception; uniformly' },
          { zh: '务必', en: 'must; be sure to' },
        ],
      },
      {
        theme: 'Formal near-synonyms',
        words: [
          { zh: '阐述', en: 'to expound in detail' },
          { zh: '论述', en: 'to discuss and analyse' },
          { zh: '陈述', en: 'to state; to set out' },
          { zh: '表述', en: 'to formulate in words' },
          { zh: '遏制', en: 'to contain; to hold in check' },
          { zh: '抑制', en: 'to restrain; to inhibit' },
          { zh: '压制', en: 'to suppress by force' },
          { zh: '弥补', en: 'to make up for a shortfall' },
          { zh: '填补', en: 'to fill a gap' },
          { zh: '补充', en: 'to supplement; to add' },
        ],
      },
    ],
    passage: {
      title: '碎片化阅读之忧',
      text: '互联网使信息的获取变得前所未有的方便，人们随时都能在屏幕上读到最新的消息。然而，方便未必等同于收获。大量内容被切成几百字的片段，读者所接触的往往只是结论，而非得出结论的过程。久而久之，注意力不断被打断，深入思考的能力因而受到削弱。\n\n就阅读效果而言，系统的书籍与零散的信息本不应相互对立。碎片化阅读能够拓宽视野，进而激发兴趣；问题在于，它一旦取代了需要耐心的长篇阅读，知识便难以形成体系。反之，若两者各得其所，收获未尝不能加倍。\n\n在笔者看来，理性的态度并非拒绝屏幕，而是为深度阅读留出固定的时间。每天哪怕只有半小时，不受打扰，不为消息所动，长期坚持下去，其效果亦不容忽视。',
      en: "The internet has made information easier to reach than ever, and the latest news is always a screen away. Convenience, however, is not the same as gain. Content arrives cut into fragments of a few hundred characters, so what readers meet is usually the conclusion rather than the reasoning that produced it. Over time attention is broken again and again, and the capacity for sustained thought is weakened accordingly. In terms of reading outcomes, systematic books and scattered information need not stand opposed: fragmentary reading can widen one's view and spark interest. The trouble starts when it displaces the patient reading of longer texts, leaving knowledge with no structure. Given their proper places, the two together may well be worth more than either alone. In this writer's view, the reasonable response is not to refuse the screen but to set aside a fixed time for deep reading. Even half an hour a day, undisturbed and unmoved by notifications, kept up over the long run, has an effect that should not be dismissed.",
    },
    pitfalls: [
      {
        title: 'Print connectives carried into speech',
        detail:
          "从而, 因而, 反之 and 乃至 are written words. In conversation they make you sound as though you are reciting an essay; the spoken equivalents are 这样一来, 所以, 要是反过来 and 甚至. Register errors are more conspicuous at this level than grammar errors, because your grammar is now good enough that listeners assume the choice was deliberate.",
      },
      {
        title: 'Reading 不无 and 未尝不 as agreement',
        detail:
          "Understatement by double negation is the standard way Chinese commentary hedges. 不无遗憾 expresses regret, 未尝不可 is reluctant permission, and 不能不说 introduces a criticism the writer would rather not make. Take these at face value and you can invert the tone of an entire editorial while translating every word correctly.",
      },
      {
        title: '所 and 之 used as decoration',
        detail:
          "所 only works before a transitive verb whose object is the noun being modified, so 所去的地方 is wrong while 所选择的道路 is fine. 之 survives in fixed frames, not as a general replacement for 的: 我之书 is not a formal version of 我的书. Adding either where the frame does not license it reads as imitation of classical style rather than command of it.",
      },
      {
        title: '成语 chosen from an English gloss',
        detail:
          "Many idioms carry a fixed evaluation and a fixed kind of subject. 无微不至 praises care given to a person, 层出不穷 usually describes problems rather than achievements, and 一如既往 needs an ongoing relationship to be constant about. A gloss such as emerging endlessly tells you none of this, so record each idiom with the noun it modified where you met it.",
      },
    ],
    tips: [
      'Read aloud every day. Four-character rhythm is a physical habit, and the ear catches unbalanced phrasing long before the eye does.',
      'For every new connective, write the spoken equivalent beside it. A two-column list of print forms and speech forms is the most useful page in an HSK 6 notebook.',
      'Practise topic-comment fronting on purpose: 这件事我们已经处理好了 and 那本书我看过 put known information first, which is how Chinese paragraphs hold together. Translating English subject-first order clause by clause gives grammatical but disjointed prose.',
      'Summarise every article you read in three Chinese sentences. Summarising forces this level’s abstract nouns into production, which passive reading never does.',
      'Collect idioms by the situation they judge rather than alphabetically, so that when you need to criticise a half-finished project the right phrase is already grouped with its neighbours.',
    ],
    exam: {
      format:
        'Around 140 minutes: about 50 listening questions, 50 reading questions, and a single 45-minute writing task in which you read a narrative of roughly a thousand characters for ten minutes and then retell it from memory in about four hundred. Scored out of 300, with 180 to pass.',
      tips:
        'The writing task rewards structure over vocabulary. During the ten reading minutes fix the names, the sequence of events and the ending; you are graded on whether the retelling is coherent and complete, not on whether you reproduced the original wording. In listening, the long interviews at the end reward notes on the speaker’s stance rather than on facts.',
    },
  },
];
