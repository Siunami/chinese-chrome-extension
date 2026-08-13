// HSK 1-3: the Beginner band of HSK 3.0 (国际中文教育中文水平等级标准, 2021).
//
// Hand-authored study material. No pinyin is stored here on purpose: readings
// come from CC-CEDICT at display time, so the guide can never disagree with
// the hover popup. Every vocabulary headword below is a real CC-CEDICT entry.

export const LEVELS_1_3 = [
  {
    level: 1,
    band: 'Beginner',
    name: 'HSK 1',
    tagline: 'Your first 500 words: introduce yourself and ask simple everyday questions.',
    stats: {
      newWords: 500,
      totalWords: 500,
      newChars: 300,
      totalChars: 300,
      grammarPoints: 48,
      studyHours: 'about 150 hours from zero',
    },
    overview:
      'HSK 1 is the foundation the whole standard is built on: 500 words, 300 characters and the handful of sentence patterns that everything later reuses. Chinese verbs never change form, so almost all of the grammar at this level is word order plus a few particles. If you can reliably produce a sentence with a subject, a time word, a place phrase and a verb in that order, you have most of HSK 1.',
    canDo: [
      'Introduce yourself: your name, age, nationality, family and what you study or do.',
      'Say what you have and where things and people are, using 有 and 在.',
      'Ask and answer simple questions about people, places, dates, prices and quantities.',
      'Order food and drink, buy everyday items and handle numbers and money in a shop.',
      'Read short sentences made of familiar characters and fill in a form with your personal details.',
    ],
    grammar: [
      {
        point: 'Identity sentences with 是',
        formula: '主语 + 是 + 名词',
        explain:
          '是 links two nouns and says they are the same thing. It is negated with 不, never with 没, and it does not appear before an adjective.',
        examples: [
          { zh: '我是学生。', en: 'I am a student.' },
          { zh: '他不是老师，他是医生。', en: 'He is not a teacher, he is a doctor.' },
          { zh: '这是我的手机。', en: 'This is my phone.' },
        ],
      },
      {
        point: 'Adjective predicates with 很',
        formula: '主语 + 很 + 形容词',
        explain:
          'An adjective is already a complete predicate in Chinese, so no verb is needed. Unstressed 很 fills the slot and is barely translated; without it a bare adjective sounds like a comparison with something else.',
        examples: [
          { zh: '今天很热。', en: 'It is hot today.' },
          { zh: '他们的学校很大。', en: 'Their school is big.' },
          { zh: '我今天不忙。', en: 'I am not busy today.' },
        ],
      },
      {
        point: '有 for possession and existence',
        formula: '主语 + 有 + 宾语',
        explain:
          '有 covers both "have" and "there is". Whatever exists comes after 有 and the place where it exists comes before it. The negative is always 没有, never 不有.',
        examples: [
          { zh: '我有两个中国朋友。', en: 'I have two Chinese friends.' },
          { zh: '桌子上有一本书。', en: 'There is a book on the table.' },
          { zh: '我们家没有汽车。', en: 'Our family does not have a car.' },
        ],
      },
      {
        point: '在 for saying where something is',
        formula: '主语 + 在 + 处所',
        explain:
          '在 states the location of something already known: the thing you are talking about is the subject, and the place follows 在. Compare 有, which introduces something new at a place.',
        examples: [
          { zh: '我妈妈在医院。', en: 'My mother is at the hospital.' },
          { zh: '你的书在桌子上。', en: 'Your book is on the table.' },
          { zh: '老师今天不在学校。', en: 'The teacher is not at school today.' },
        ],
      },
      {
        point: 'Yes-no questions with 吗, follow-ups with 呢',
        formula: '陈述句 + 吗？',
        explain:
          'Add 吗 to the end of a statement and nothing else moves: the word order of a question is the word order of a statement. 呢 bounces the same question back to someone else, or asks where a known thing has got to.',
        examples: [
          { zh: '你是中国人吗？', en: 'Are you Chinese?' },
          { zh: '我很好，你呢？', en: 'I am fine, and you?' },
          { zh: '我的手机呢？', en: 'Where is my phone?' },
        ],
      },
      {
        point: 'Question words stay where the answer goes',
        formula: '主语 + 动词 + 什么？',
        explain:
          'Chinese does not move question words to the front of the sentence. Put 什么, 谁, 哪儿, 几 or 多少 in exactly the slot the answer would occupy, and do not add 吗 as well.',
        examples: [
          { zh: '你叫什么名字？', en: 'What is your name?' },
          { zh: '他是谁？', en: 'Who is he?' },
          { zh: '你家有几口人？', en: 'How many people are there in your family?' },
        ],
      },
      {
        point: '的 for possession and modification',
        formula: '名词 + 的 + 名词',
        explain:
          '的 attaches any modifier to the noun that follows it, whether the modifier is a possessor or a description. It is normally dropped with close relationships such as family members and your own school or country.',
        examples: [
          { zh: '这是老师的书。', en: 'This book belongs to the teacher.' },
          { zh: '我的朋友都很好。', en: 'My friends are all very nice.' },
          { zh: '她是我妈妈。', en: 'She is my mother.' },
        ],
      },
      {
        point: 'Measure words between number and noun',
        formula: '数词 + 量词 + 名词',
        explain:
          'A number can never sit straight next to a noun. Every countable noun takes a measure word: 个 is the default, 本 counts books, 口 counts family members.',
        examples: [
          { zh: '我要三个苹果。', en: 'I want three apples.' },
          { zh: '我家有五口人。', en: 'There are five people in my family.' },
          { zh: '桌子上有两本书。', en: 'There are two books on the table.' },
        ],
      },
      {
        point: 'Word order: time and place before the verb',
        formula: '主语 + 时间 + 处所 + 动词 + 宾语',
        explain:
          'Chinese sets the scene before it reports the action. Time comes before place and both come before the verb, which is the reverse of the usual English order.',
        examples: [
          { zh: '我明天在家看书。', en: 'I am going to read at home tomorrow.' },
          { zh: '他每天七点吃饭。', en: 'He eats at seven every day.' },
          { zh: '我们星期六去商店。', en: 'We are going to the shop on Saturday.' },
        ],
      },
      {
        point: 'Negation with 不 and 没',
        formula: '主语 + 不 ／ 没 + 动词',
        explain:
          '不 negates the present, the habitual and the future, and it is the only choice with adjectives. 没 says that an event did not happen or has not happened yet, and it is the only way to negate 有.',
        examples: [
          { zh: '我不喝茶。', en: 'I do not drink tea.' },
          { zh: '他今天没来。', en: 'He did not come today.' },
          { zh: '我没有钱。', en: 'I have no money.' },
        ],
      },
    ],
    vocab: [
      {
        theme: 'People and family',
        words: [
          { zh: '我', en: 'I, me' },
          { zh: '你', en: 'you' },
          { zh: '他', en: 'he, him' },
          { zh: '她', en: 'she, her' },
          { zh: '爸爸', en: 'father, dad' },
          { zh: '妈妈', en: 'mother, mum' },
          { zh: '儿子', en: 'son' },
          { zh: '女儿', en: 'daughter' },
          { zh: '老师', en: 'teacher' },
          { zh: '学生', en: 'student' },
          { zh: '朋友', en: 'friend' },
          { zh: '医生', en: 'doctor' },
        ],
      },
      {
        theme: 'Numbers, time and age',
        words: [
          { zh: '一', en: 'one' },
          { zh: '二', en: 'two, used for counting and in dates' },
          { zh: '两', en: 'two of something, used before a measure word' },
          { zh: '三', en: 'three' },
          { zh: '十', en: 'ten' },
          { zh: '今天', en: 'today' },
          { zh: '明天', en: 'tomorrow' },
          { zh: '昨天', en: 'yesterday' },
          { zh: '星期', en: 'week' },
          { zh: '现在', en: 'now' },
          { zh: '时候', en: 'time, moment' },
          { zh: '岁', en: 'years of age' },
        ],
      },
      {
        theme: 'Food and drink',
        words: [
          { zh: '吃', en: 'to eat' },
          { zh: '喝', en: 'to drink' },
          { zh: '米饭', en: 'cooked rice' },
          { zh: '菜', en: 'dish, vegetable' },
          { zh: '水', en: 'water' },
          { zh: '茶', en: 'tea' },
          { zh: '苹果', en: 'apple' },
          { zh: '面条', en: 'noodles' },
          { zh: '鸡蛋', en: 'egg' },
          { zh: '牛奶', en: 'milk' },
          { zh: '水果', en: 'fruit' },
          { zh: '饭馆', en: 'restaurant' },
        ],
      },
      {
        theme: 'Everyday verbs',
        words: [
          { zh: '是', en: 'to be, for linking two nouns' },
          { zh: '有', en: 'to have, there is' },
          { zh: '去', en: 'to go' },
          { zh: '来', en: 'to come' },
          { zh: '看', en: 'to look at, to watch, to read' },
          { zh: '听', en: 'to listen' },
          { zh: '说', en: 'to speak, to say' },
          { zh: '读', en: 'to read aloud, to study' },
          { zh: '写', en: 'to write' },
          { zh: '买', en: 'to buy' },
          { zh: '住', en: 'to live, to stay' },
          { zh: '学习', en: 'to study, to learn' },
        ],
      },
      {
        theme: 'Places and things around you',
        words: [
          { zh: '家', en: 'home, family' },
          { zh: '学校', en: 'school' },
          { zh: '商店', en: 'shop' },
          { zh: '医院', en: 'hospital' },
          { zh: '桌子', en: 'table, desk' },
          { zh: '椅子', en: 'chair' },
          { zh: '书', en: 'book' },
          { zh: '电脑', en: 'computer' },
          { zh: '手机', en: 'mobile phone' },
          { zh: '衣服', en: 'clothes' },
          { zh: '汽车', en: 'car' },
          { zh: '中国', en: 'China' },
        ],
      },
      {
        theme: 'Describing words and question words',
        words: [
          { zh: '好', en: 'good, well' },
          { zh: '大', en: 'big' },
          { zh: '小', en: 'small' },
          { zh: '多', en: 'many, much' },
          { zh: '少', en: 'few, little' },
          { zh: '冷', en: 'cold' },
          { zh: '热', en: 'hot' },
          { zh: '什么', en: 'what' },
          { zh: '谁', en: 'who' },
          { zh: '哪儿', en: 'where' },
          { zh: '几', en: 'how many, for small numbers' },
          { zh: '多少', en: 'how many, how much' },
        ],
      },
    ],
    passage: {
      title: '我的家',
      text:
        '我叫李月，今年十八岁，是中国人。我家有四口人：爸爸、妈妈、哥哥和我。爸爸是医生，他在医院工作。妈妈是老师，她的学生很多。\n\n' +
        '现在我在北京学习汉语。我们的老师姓王，她很好，也很漂亮。我有两个中国朋友，他们都喜欢吃米饭和面条。\n\n' +
        '今天是星期六，天气很热。下午我和朋友去商店买水果，晚上我们在家看电视。你呢？你星期六做什么？',
      en:
        'My name is Li Yue. I am eighteen this year and I am Chinese. There are four people in my family: my father, my mother, my older brother and me. My father is a doctor and works at a hospital. My mother is a teacher and has a lot of students. Right now I am studying Chinese in Beijing. Our teacher is called Wang. She is very nice and very pretty. I have two Chinese friends, and they both like eating rice and noodles. Today is Saturday and the weather is hot. In the afternoon my friend and I are going to the shop to buy fruit, and in the evening we will watch television at home. How about you? What do you do on Saturdays?',
    },
    pitfalls: [
      {
        title: 'Putting 是 in front of an adjective',
        detail:
          'English "I am busy" pushes learners toward 我是忙, which is wrong. A Chinese adjective is already the predicate, so say 我很忙. Keep 是 for joining two nouns, as in 我是学生.',
      },
      {
        title: 'Dropping the measure word',
        detail:
          '三书 and 两朋友 do not exist. A number always needs a measure word before the noun: 三本书, 两个朋友. When you do not know the right one, 个 is the safe default and fits most nouns.',
      },
      {
        title: 'Choosing between 二 and 两',
        detail:
          '二 is for counting, for digits and for dates such as 十二 and 二月. 两 is the form used before a measure word, so it is 两个人 and 两本书, never 二个人.',
      },
      {
        title: 'Leaving the time word until the end',
        detail:
          'Chinese states when and where before it states what happened: 我明天去学校, not 我去学校明天. Time comes first, place second, verb last, and that frame never changes.',
      },
    ],
    tips: [
      'Learn every noun together with its measure word from the first day. Adding them later is much harder than storing 一本书 as a single chunk.',
      'Drill tones on whole words rather than single syllables, and record yourself: 买 and 卖 are separated only by tone.',
      'Write the 300 characters by hand in the correct stroke order even though the exam is not handwritten. It is what stops 我 and 找 from blurring together.',
      'Say the frame 时间 + 地点 + 动词 out loud with your own daily schedule until leading with the time word feels natural.',
    ],
    exam: {
      format:
        'HSK 1 is a short paper of roughly 40 minutes with two sections, listening and reading, both entirely multiple choice. There is no writing section and no speaking component in the written test.',
      tips:
        'Each listening item is played twice and slowly, so use the pause beforehand to study the picture or the options. In reading, the wrong answers are usually characters that look one stroke away from the right one, which is exactly why handwriting practice pays off.',
    },
  },

  {
    level: 2,
    band: 'Beginner',
    name: 'HSK 2',
    tagline: 'Talk about what you did, what you want, and how one thing compares with another.',
    stats: {
      newWords: 772,
      totalWords: 1272,
      newChars: 300,
      totalChars: 600,
      grammarPoints: 81,
      studyHours: 'about 150 hours beyond HSK 1, roughly 300 in total',
    },
    overview:
      'HSK 2 roughly doubles your vocabulary and adds the particles that let a sentence sit in time: 了 for completion and change, 过 for experience, 在 for actions in progress. Alongside them come the modal verbs, the first comparison patterns, and the paired connectors 因为…所以 and 虽然…但是. This is the level where isolated sentences start joining into short paragraphs.',
    canDo: [
      'Describe your daily routine and say what you did yesterday or last weekend.',
      'Say what you want, plan, can and are allowed to do, using 想, 要, 会, 能 and 可以.',
      'Compare two things by price, size, speed or quality with 比 and 跟…一样.',
      'Handle a simple journey: buy a ticket, ask about times, and describe how you travelled.',
      'Give a reason for something and hold a short conversation about weather, shopping or study.',
      'Read a short paragraph or a simple note and get the main point without a dictionary.',
    ],
    grammar: [
      {
        point: 'The two jobs of 了: completed action and new situation',
        formula: '主语 + 动词 + 了 + 宾语 ／ 句子 + 了',
        explain:
          '了 directly after the verb marks an action as completed, usually with a quantified object. 了 at the end of the sentence reports a change: something is true now that was not true before. Neither one is a past tense, and both turn up in sentences about the future.',
        examples: [
          { zh: '我买了两本书。', en: 'I bought two books.' },
          { zh: '下雨了。', en: 'It has started raining.' },
          { zh: '他今年二十岁了。', en: 'He has turned twenty this year.' },
        ],
      },
      {
        point: '过 for past experience',
        formula: '主语 + 动词 + 过 + 宾语',
        explain:
          '过 says that something has happened at least once in your life, without saying when. The negative is 没…过, and unlike 了 the 过 stays in place when the sentence is negated.',
        examples: [
          { zh: '我去过中国两次。', en: 'I have been to China twice.' },
          { zh: '你吃过中国菜吗？', en: 'Have you ever eaten Chinese food?' },
          { zh: '我没坐过飞机。', en: 'I have never been on a plane.' },
        ],
      },
      {
        point: 'Actions in progress with 在 and 正在',
        formula: '主语 + 正在 + 动词 + 宾语 + 呢',
        explain:
          'Put 在 or 正在 in front of the verb, and optionally 呢 at the end, to say that an action is going on at this moment. The negative is 没在 or simply 没有.',
        examples: [
          { zh: '他正在打电话呢。', en: 'He is on the phone right now.' },
          { zh: '我在做饭，你等一下。', en: 'I am cooking, wait a moment.' },
          { zh: '孩子们在外边玩儿。', en: 'The children are playing outside.' },
        ],
      },
      {
        point: 'Modal verbs 想, 要, 会, 能, 可以',
        formula: '主语 + 想 ／ 要 ／ 会 ／ 能 ／ 可以 + 动词',
        explain:
          '想 is "would like to", 要 is a firmer "want to" or "am going to", 会 is a learned skill or a prediction, 能 is physical possibility, and 可以 is permission. All of them sit in front of the main verb and are negated with 不.',
        examples: [
          { zh: '我想去中国旅游。', en: 'I would like to travel to China.' },
          { zh: '她会说汉语。', en: 'She can speak Chinese.' },
          { zh: '今天我不能去，我很忙。', en: 'I cannot go today, I am busy.' },
        ],
      },
      {
        point: 'Comparison with 比 and 跟…一样',
        formula: 'A + 比 + B + 形容词',
        explain:
          'In a 比 sentence the adjective never takes 很; degree expressions such as 一点儿, 多了 or 得多 follow it instead. 跟…一样 states that two things are the same, and 没有 says that A falls short of B.',
        examples: [
          { zh: '今天比昨天热。', en: 'Today is hotter than yesterday.' },
          { zh: '我的手机跟你的一样。', en: 'My phone is the same as yours.' },
          { zh: '这件衣服比那件便宜一点儿。', en: 'This piece of clothing is a bit cheaper than that one.' },
        ],
      },
      {
        point: '就 and 才 for sooner and later than expected',
        formula: '主语 + 时间 + 就 ／ 才 + 动词',
        explain:
          '就 says the action came earlier, faster or more easily than the listener would expect; 才 says it came later or cost more effort. Both stand directly in front of the verb, after the time word.',
        examples: [
          { zh: '他六点就来了。', en: 'He arrived as early as six.' },
          { zh: '我昨天十一点才睡觉。', en: 'I did not get to bed until eleven last night.' },
          { zh: '你怎么现在才来？', en: 'Why are you only arriving now?' },
        ],
      },
      {
        point: '一点儿 and 有点儿',
        formula: '形容词 + 一点儿 ／ 有点儿 + 形容词',
        explain:
          '有点儿 comes before the adjective and always carries a mild complaint: something is a little more than you would like. 一点儿 comes after the adjective and asks for a small adjustment or draws a small comparison.',
        examples: [
          { zh: '这件衣服有点儿贵。', en: 'This piece of clothing is a bit expensive.' },
          { zh: '请你说慢一点儿。', en: 'Please speak a little more slowly.' },
          { zh: '今天有点儿冷。', en: 'It is a bit cold today.' },
        ],
      },
      {
        point: '得 with a degree complement',
        formula: '动词 + 得 + 形容词',
        explain:
          'To say how well, how fast or how often an action is performed, attach 得 to the verb and put the description after it. If the verb has an object, the verb is repeated: 他说汉语说得很好.',
        examples: [
          { zh: '他跑得很快。', en: 'He runs fast.' },
          { zh: '你汉语说得真好。', en: 'You speak Chinese really well.' },
          { zh: '我昨天睡得不好。', en: 'I did not sleep well last night.' },
        ],
      },
      {
        point: 'Directional complements 来 and 去',
        formula: '动词 + 来 ／ 去',
        explain:
          '来 means the movement comes toward the speaker and 去 means it moves away. A place word goes between the verb and 来 or 去, and 了 follows the whole group.',
        examples: [
          { zh: '老师进来了。', en: 'The teacher came in.' },
          { zh: '他回家去了。', en: 'He has gone back home.' },
          { zh: '你快下来！', en: 'Come down quickly!' },
        ],
      },
      {
        point: 'Linking clauses: 因为…所以 and 虽然…但是',
        formula: '因为 + 原因，所以 + 结果',
        explain:
          'Chinese keeps both halves of these pairs where English keeps only one. The reason or the concession comes first, and the point you actually want to make comes second, after 所以 or 但是.',
        examples: [
          { zh: '因为下雨，所以我没去。', en: 'I did not go because it was raining.' },
          { zh: '虽然这本书很难，但是很有意思。', en: 'Although this book is hard, it is interesting.' },
          { zh: '因为他病了，所以今天没来上课。', en: 'He did not come to class today because he is ill.' },
        ],
      },
    ],
    vocab: [
      {
        theme: 'Daily routine and time',
        words: [
          { zh: '起床', en: 'to get up' },
          { zh: '睡觉', en: 'to sleep, to go to bed' },
          { zh: '上班', en: 'to go to work, to start work' },
          { zh: '下班', en: 'to finish work' },
          { zh: '休息', en: 'to rest, to take a break' },
          { zh: '小时', en: 'hour' },
          { zh: '分钟', en: 'minute' },
          { zh: '刚才', en: 'just now, a moment ago' },
          { zh: '以前', en: 'before, previously' },
          { zh: '以后', en: 'after, from now on' },
          { zh: '周末', en: 'weekend' },
        ],
      },
      {
        theme: 'Shopping, money and colours',
        words: [
          { zh: '超市', en: 'supermarket' },
          { zh: '卖', en: 'to sell' },
          { zh: '钱', en: 'money' },
          { zh: '便宜', en: 'cheap' },
          { zh: '贵', en: 'expensive' },
          { zh: '块', en: 'yuan, the spoken unit of money' },
          { zh: '件', en: 'measure word for clothes and matters' },
          { zh: '双', en: 'measure word for pairs' },
          { zh: '颜色', en: 'colour' },
          { zh: '白色', en: 'white' },
          { zh: '黑色', en: 'black' },
          { zh: '服务员', en: 'waiter, shop assistant' },
        ],
      },
      {
        theme: 'Travel and transport',
        words: [
          { zh: '火车', en: 'train' },
          { zh: '飞机', en: 'plane' },
          { zh: '公共汽车', en: 'bus' },
          { zh: '自行车', en: 'bicycle' },
          { zh: '出租车', en: 'taxi' },
          { zh: '机场', en: 'airport' },
          { zh: '车站', en: 'station, bus stop' },
          { zh: '票', en: 'ticket' },
          { zh: '旅游', en: 'to travel, tourism' },
          { zh: '路', en: 'road, route' },
          { zh: '快', en: 'fast, soon' },
          { zh: '慢', en: 'slow' },
        ],
      },
      {
        theme: 'Weather and seasons',
        words: [
          { zh: '天气', en: 'weather' },
          { zh: '晴', en: 'clear, sunny' },
          { zh: '阴', en: 'overcast, cloudy' },
          { zh: '下雨', en: 'to rain' },
          { zh: '下雪', en: 'to snow' },
          { zh: '春天', en: 'spring' },
          { zh: '夏天', en: 'summer' },
          { zh: '秋天', en: 'autumn' },
          { zh: '冬天', en: 'winter' },
          { zh: '度', en: 'degree, for temperature' },
          { zh: '风', en: 'wind' },
          { zh: '云', en: 'cloud' },
        ],
      },
      {
        theme: 'Feelings and descriptions',
        words: [
          { zh: '高兴', en: 'happy, pleased' },
          { zh: '快乐', en: 'joyful, merry' },
          { zh: '累', en: 'tired' },
          { zh: '忙', en: 'busy' },
          { zh: '新', en: 'new' },
          { zh: '旧', en: 'old, used' },
          { zh: '长', en: 'long' },
          { zh: '短', en: 'short' },
          { zh: '漂亮', en: 'pretty, good-looking' },
          { zh: '可爱', en: 'cute, lovable' },
          { zh: '好吃', en: 'tasty' },
          { zh: '有名', en: 'famous, well known' },
        ],
      },
      {
        theme: 'Work and study',
        words: [
          { zh: '工作', en: 'to work, job' },
          { zh: '公司', en: 'company' },
          { zh: '考试', en: 'exam, to sit an exam' },
          { zh: '教室', en: 'classroom' },
          { zh: '问题', en: 'question, problem' },
          { zh: '回答', en: 'to answer' },
          { zh: '准备', en: 'to prepare, to plan to' },
          { zh: '复习', en: 'to revise, to review' },
          { zh: '生词', en: 'new word, vocabulary item' },
          { zh: '汉语', en: 'Chinese language' },
          { zh: '上课', en: 'to attend class, to teach a class' },
          { zh: '觉得', en: 'to feel, to think' },
        ],
      },
    ],
    passage: {
      title: '第一次坐火车',
      text:
        '上个星期六，我和朋友一起去了上海。我们没有坐飞机，因为火车票比飞机票便宜得多。那天早上七点，我们就到了车站。\n\n' +
        '火车上人很多，有的人在看手机，有的人在睡觉。我以前没坐过中国的火车，所以觉得很有意思。窗外的天气很好，风也不大。\n\n' +
        '四个小时以后，我们到了上海。虽然有点儿累，但是我很高兴。下次我还想坐火车去别的地方。',
      en:
        'Last Saturday a friend and I went to Shanghai together. We did not fly, because a train ticket is much cheaper than a plane ticket. At seven that morning we were already at the station. There were a lot of people on the train. Some were looking at their phones and some were sleeping. I had never taken a train in China before, so I found it very interesting. The weather outside the window was good and there was not much wind. Four hours later we arrived in Shanghai. Although I was a little tired, I was very happy. Next time I would like to take the train somewhere else as well.',
    },
    pitfalls: [
      {
        title: 'Treating 了 as a past tense marker',
        detail:
          'Habitual and descriptive sentences about the past take no 了 at all: 我小时候常常去那儿, 昨天很冷. Reserve 了 for one completed event or one change of state, and remember it also appears in sentences about the future.',
      },
      {
        title: 'Negating a completed action with 不',
        detail:
          'The negative of 我去了 is 我没去, not 我不去. 没 also pushes 了 out of the sentence, so it is 我没吃饭 and never 我没吃了饭. Keep 不 for habits, preferences and the future.',
      },
      {
        title: 'Using 有点儿 where 一点儿 belongs',
        detail:
          '有点儿 goes before the adjective and sounds like a complaint, so 这个菜有点儿咸 works but a polite request does not. Requests use 一点儿 after the adjective: 便宜一点儿, 说慢一点儿.',
      },
      {
        title: 'Dropping half of a connector pair',
        detail:
          'English uses only one connector, Chinese keeps both. 因为 pairs with 所以, and 虽然 pairs with 但是 or 可是. Leaving one out makes the sentence sound unfinished to a native ear.',
      },
    ],
    tips: [
      'Sort every new verb into ones that take 了 naturally (buy, arrive, finish) and ones that rarely do (be, like, know). The distinction saves you more grief than any rule about tense.',
      'Learn 比 sentences as whole templates including the degree words, so 一点儿, 多了 and 得多 arrive already attached.',
      'Read short dialogues aloud and mark where 吗, 呢, 吧 and 了 land. Particles carry the attitude of the sentence, and you only hear that by voicing it.',
      'Keep a running list of verb plus 得 phrases from your own life (起得早, 说得快, 吃得多) so degree complements come out without assembly.',
    ],
    exam: {
      format:
        'HSK 2 runs about 55 minutes and is still multiple choice throughout. The listening section grows to include short dialogues, and the reading section adds sentence matching and true or false judgements about a picture.',
      tips:
        'Most listening items turn on one small word: a negation, a number or a time. Train your ear on 不, 没, 都 and clock times rather than trying to follow every word. In reading, find the single shared keyword between the item and an option instead of translating the whole line.',
    },
  },

  {
    level: 3,
    band: 'Beginner',
    name: 'HSK 3',
    tagline: 'Results, conditions and linked clauses: where sentences start to join up.',
    stats: {
      newWords: 973,
      totalWords: 2245,
      newChars: 300,
      totalChars: 900,
      grammarPoints: 81,
      studyHours: 'about 200 hours beyond HSK 2, roughly 500 in total',
    },
    overview:
      'HSK 3 closes the Beginner band and is the level most learners find genuinely demanding, because it introduces the structures that have no English equivalent: complements of result and possibility, the 把 sentence, the 被 passive, and 是…的 for focusing on when or how something happened. Vocabulary reaches 2245 words, enough to describe your health, your job, your city and your travel plans in connected paragraphs rather than single sentences.',
    canDo: [
      'Describe what happened to something, not just what someone did, using 把 and 被.',
      'Say whether you managed to do something, and whether you are able to, with resultative and potential complements.',
      'Talk about health, work, city life and travel plans in short connected paragraphs.',
      'Pin down when, where or how a past event took place with 是…的.',
      'Set out conditions, contrasts and additions using 如果…就, 不但…而且 and 除了…以外.',
      'Read a short article or message of several hundred characters and summarise its point.',
    ],
    grammar: [
      {
        point: 'Resultative complements 完, 好, 到, 见, 懂',
        formula: '动词 + 结果补语（完／好／到／见／懂）',
        explain:
          'A second verb or adjective attached to the main verb states how the action turned out: 看完 is to finish reading, 听懂 is to hear and understand, 找到 is to find. The pair behaves as one word, so 了 and the object follow it, and the negative uses 没.',
        examples: [
          { zh: '我看完这本书了。', en: 'I have finished reading this book.' },
          { zh: '你听懂老师的话了吗？', en: 'Did you understand what the teacher said?' },
          { zh: '我没找到我的钥匙。', en: 'I did not find my keys.' },
        ],
      },
      {
        point: 'Potential complements with 得 and 不',
        formula: '动词 + 得 ／ 不 + 结果补语',
        explain:
          'Slipping 得 or 不 inside a resultative pair turns it into a question of possibility: 看得懂 is able to understand what you read, 看不懂 is unable to. The negative form is far more common in speech than the positive one.',
        examples: [
          { zh: '这个字太小，我看不见。', en: 'This character is too small, I cannot see it.' },
          { zh: '这本书你看得懂吗？', en: 'Can you understand this book?' },
          { zh: '箱子太重了，我一个人搬不动。', en: 'The box is too heavy, I cannot move it on my own.' },
        ],
      },
      {
        point: '把 sentences',
        formula: '主语 + 把 + 宾语 + 动词 + 其他成分',
        explain:
          '把 moves a definite object in front of the verb so the sentence can report what was done to it. The verb can never stand bare in a 把 sentence: it needs a complement, a 了, or a repetition. Negatives and modal verbs go before 把, not after it.',
        examples: [
          { zh: '请把窗户关上。', en: 'Please close the window.' },
          { zh: '我把作业做完了。', en: 'I have finished the homework.' },
          { zh: '他没把手机带来。', en: 'He did not bring his phone.' },
        ],
      },
      {
        point: '被 passives',
        formula: '受事 + 被 + 施事 + 动词 + 其他成分',
        explain:
          '被 marks the subject as the thing affected, and the doer after 被 can be left out when it is unknown or obvious. The verb still needs something after it, and the sentence often carries a hint that the outcome was unwelcome.',
        examples: [
          { zh: '我的自行车被人骑走了。', en: 'Someone rode off with my bicycle.' },
          { zh: '杯子被弟弟打破了。', en: 'The cup was broken by my younger brother.' },
          { zh: '他被经理叫到办公室去了。', en: 'He was called into the office by the manager.' },
        ],
      },
      {
        point: '着 for a continuing state',
        formula: '动词 + 着',
        explain:
          '着 describes a state that stays in place rather than an action unrolling: the door is standing open, the rain is falling steadily. It also joins two verbs, where the one marked with 着 gives the manner of the other.',
        examples: [
          { zh: '门开着，你进来吧。', en: 'The door is open, come on in.' },
          { zh: '外面下着雨。', en: 'It is raining outside.' },
          { zh: '他站着看报纸。', en: 'He is reading the newspaper standing up.' },
        ],
      },
      {
        point: '是…的 for focusing on time, place or manner',
        formula: '主语 + 是 + 时间／地点／方式 + 动词 + 的',
        explain:
          'When both speakers already know that something happened, 是…的 puts the spotlight on the circumstances: when, where or how. 是 may be dropped in a positive sentence, but 的 may not, and it goes at the very end.',
        examples: [
          { zh: '我是昨天到的。', en: 'It was yesterday that I arrived.' },
          { zh: '你是坐飞机来的吗？', en: 'Did you come by plane?' },
          { zh: '这件衣服是在网上买的。', en: 'This item of clothing was bought online.' },
        ],
      },
      {
        point: '又…又 and 一边…一边',
        formula: '又 + 形容词 + 又 + 形容词 ／ 一边 + 动词 + 一边 + 动词',
        explain:
          '又…又 stacks two qualities that hold at the same time, and both halves must point the same way. 一边…一边 links two actions the same person carries out simultaneously.',
        examples: [
          { zh: '这个房间又大又亮。', en: 'This room is both big and bright.' },
          { zh: '他们一边吃饭一边聊天。', en: 'They chat while they eat.' },
          { zh: '我一边听音乐一边打扫房间。', en: 'I clean the room while listening to music.' },
        ],
      },
      {
        point: '越来越 and 越…越',
        formula: '越来越 + 形容词 ／ 越 + 动词 + 越 + 形容词',
        explain:
          '越来越 says a quality keeps increasing as time passes, and the sentence usually ends in 了. 越 A 越 B ties two changes together: the more A happens, the more B follows.',
        examples: [
          { zh: '天气越来越冷了。', en: 'The weather is getting colder and colder.' },
          { zh: '他的汉语越说越好。', en: 'The more he speaks Chinese, the better it gets.' },
          { zh: '雨越下越大。', en: 'The rain is falling harder and harder.' },
        ],
      },
      {
        point: 'Adding information: 除了…以外 and 不但…而且',
        formula: '除了 + 名词 + 以外，还 ／ 都 …',
        explain:
          '除了…以外 followed by 还 or 也 adds something to a list; followed by 都 it excludes instead, so the 还 or 都 is what carries the meaning. 不但…而且 raises the stakes, with the stronger fact placed in the second clause.',
        examples: [
          { zh: '除了汉语以外，他还会说日语。', en: 'Besides Chinese, he can also speak Japanese.' },
          { zh: '除了小王以外，我们都去过那个地方。', en: 'Apart from Xiao Wang, we have all been to that place.' },
          { zh: '他不但会开车，而且开得很好。', en: 'Not only can he drive, he drives well.' },
        ],
      },
      {
        point: 'Conditions with 如果 or 要是 … 就',
        formula: '如果 ／ 要是 + 条件，（主语）就 + 结果',
        explain:
          '如果 and 要是 mean the same thing, with 要是 sounding more colloquial, and either may take 的话 at the end of the condition. The result clause almost always needs 就 in front of its verb.',
        examples: [
          { zh: '如果明天不下雨，我们就去爬山。', en: 'If it does not rain tomorrow, we will go hiking.' },
          { zh: '要是你有时间，就来我家玩儿。', en: 'If you have time, come over to my place.' },
          { zh: '如果你不舒服的话，就早点儿休息。', en: 'If you are not feeling well, get some rest early.' },
        ],
      },
    ],
    vocab: [
      {
        theme: 'Health and the body',
        words: [
          { zh: '身体', en: 'body, health' },
          { zh: '头', en: 'head' },
          { zh: '眼睛', en: 'eye' },
          { zh: '耳朵', en: 'ear' },
          { zh: '鼻子', en: 'nose' },
          { zh: '生病', en: 'to fall ill' },
          { zh: '感冒', en: 'to catch a cold' },
          { zh: '发烧', en: 'to run a fever' },
          { zh: '药', en: 'medicine' },
          { zh: '健康', en: 'healthy, health' },
          { zh: '锻炼', en: 'to exercise, to work out' },
          { zh: '疼', en: 'to hurt, painful' },
        ],
      },
      {
        theme: 'Feelings and character',
        words: [
          { zh: '担心', en: 'to worry' },
          { zh: '难过', en: 'sad, upset' },
          { zh: '害怕', en: 'to be afraid' },
          { zh: '生气', en: 'to get angry' },
          { zh: '满意', en: 'satisfied' },
          { zh: '认真', en: 'conscientious, serious about something' },
          { zh: '马虎', en: 'careless, sloppy' },
          { zh: '热情', en: 'warm, enthusiastic' },
          { zh: '安静', en: 'quiet' },
          { zh: '聪明', en: 'clever' },
          { zh: '努力', en: 'to make an effort, hard-working' },
          { zh: '着急', en: 'anxious, in a hurry' },
        ],
      },
      {
        theme: 'Getting around the city',
        words: [
          { zh: '街道', en: 'street' },
          { zh: '路口', en: 'intersection, crossroads' },
          { zh: '地铁', en: 'underground, subway' },
          { zh: '银行', en: 'bank' },
          { zh: '邮局', en: 'post office' },
          { zh: '附近', en: 'nearby, vicinity' },
          { zh: '旁边', en: 'beside, next to' },
          { zh: '中间', en: 'middle, between' },
          { zh: '左边', en: 'left side' },
          { zh: '右边', en: 'right side' },
          { zh: '地图', en: 'map' },
          { zh: '方向', en: 'direction' },
        ],
      },
      {
        theme: 'Work and school life',
        words: [
          { zh: '会议', en: 'meeting' },
          { zh: '经理', en: 'manager' },
          { zh: '同事', en: 'colleague' },
          { zh: '计划', en: 'plan, to plan' },
          { zh: '完成', en: 'to complete' },
          { zh: '迟到', en: 'to be late' },
          { zh: '请假', en: 'to ask for leave' },
          { zh: '成绩', en: 'result, grade' },
          { zh: '水平', en: 'level, standard' },
          { zh: '参加', en: 'to take part in' },
          { zh: '办公室', en: 'office' },
          { zh: '加班', en: 'to work overtime' },
        ],
      },
      {
        theme: 'Travel and nature',
        words: [
          { zh: '旅行', en: 'to travel, a trip' },
          { zh: '护照', en: 'passport' },
          { zh: '行李', en: 'luggage' },
          { zh: '宾馆', en: 'hotel' },
          { zh: '空气', en: 'air' },
          { zh: '环境', en: 'environment, surroundings' },
          { zh: '树', en: 'tree' },
          { zh: '花', en: 'flower' },
          { zh: '河', en: 'river' },
          { zh: '山', en: 'mountain, hill' },
          { zh: '太阳', en: 'sun' },
          { zh: '月亮', en: 'moon' },
        ],
      },
      {
        theme: 'Home and chores',
        words: [
          { zh: '厨房', en: 'kitchen' },
          { zh: '客厅', en: 'living room' },
          { zh: '卧室', en: 'bedroom' },
          { zh: '冰箱', en: 'fridge' },
          { zh: '空调', en: 'air conditioner' },
          { zh: '打扫', en: 'to clean, to sweep' },
          { zh: '洗澡', en: 'to take a bath or shower' },
          { zh: '刷牙', en: 'to brush your teeth' },
          { zh: '灯', en: 'lamp, light' },
          { zh: '沙发', en: 'sofa' },
          { zh: '窗户', en: 'window' },
          { zh: '钥匙', en: 'key' },
        ],
      },
    ],
    passage: {
      title: '搬家那天',
      text:
        '上个月我搬家了。新房子是我姐姐帮我找的，离地铁站很近，走路只要十分钟。\n\n' +
        '搬家那天早上下着小雨。我把书和衣服都放进了箱子里，可是箱子太重，我一个人搬不动。后来同事小张开车来帮我，我们一边搬东西一边聊天，两个小时就把所有的东西搬完了。\n\n' +
        '新房子除了厨房小一点儿以外，别的地方我都很满意。客厅的窗户很大，太阳照进来的时候，屋子里又亮又暖和。不但房租不贵，而且邻居也很热情。\n\n' +
        '晚上我把地打扫干净，又去超市买了一些水果。我的杯子被小张不小心打破了一个，他很不好意思，第二天又送了我一套新的。我说：“如果你有空儿，就常来我家玩儿。”\n\n' +
        '现在我越来越喜欢这个地方了。',
      en:
        'Last month I moved house. My older sister found the new place for me. It is close to the underground station, only ten minutes on foot. It was drizzling on the morning of the move. I put all my books and clothes into boxes, but one box was too heavy and I could not shift it on my own. Later my colleague Xiao Zhang drove over to help, and we chatted while we carried things, so in two hours we had moved everything. Apart from the kitchen being a little small, I am happy with the whole place. The living room window is large, and when the sun comes in the room is bright and warm. Not only is the rent low, the neighbours are friendly too. In the evening I swept the floor clean and went to the supermarket for some fruit. Xiao Zhang accidentally broke one of my cups, and he was so embarrassed that the next day he gave me a whole new set. I told him that if he has time he should come round often. I like this place more and more.',
    },
    pitfalls: [
      {
        title: 'Ending a 把 sentence on a bare verb',
        detail:
          'A 把 sentence reports what happened to the object, so the verb needs something after it: 把门关上, 把作业做完. 我把书看 is incomplete. The object also has to be specific, something both speakers can point to.',
      },
      {
        title: 'Reaching for 被 the way English reaches for the passive',
        detail:
          'Chinese usually prefers the active voice or a topic-comment sentence: 饭做好了 rather than 饭被做好了. Save 被 for when the doer matters or the result is unwelcome, which is why it suits broken cups and stolen bicycles.',
      },
      {
        title: 'Confusing 着 with 在',
        detail:
          '在 marks an action unfolding right now, while 着 marks a state that persists. 他在开门 is he is opening the door; 门开着 is the door stands open. A 着 sentence usually paints a scene rather than reporting news.',
      },
      {
        title: 'Adding 了 to a 是…的 sentence',
        detail:
          '是…的 already places the event in the past, so 我是昨天来的 is right and 我是昨天来了的 is not. The part you cannot drop is 的 at the end; 是 itself is optional in a positive sentence.',
      },
    ],
    tips: [
      'Rewrite five ordinary sentences a day as 把 sentences. The pattern only becomes automatic through production, never through reading about it.',
      'Group resultative complements by their second half rather than by verb: collect everything ending in 完, then everything with 到, then 懂, 好 and 见.',
      'When you read, underline every 的, 得 and 地 and say which one the slot requires. At this level the three start colliding in writing.',
      'Retell a passage you have just read from memory, forcing in at least three connectors from this level, such as 虽然…但是, 不但…而且 and 如果…就.',
    ],
    exam: {
      format:
        'HSK 3 runs about 90 minutes and adds a writing section to listening and reading. In writing you reorder a scrambled set of words into one correct sentence and supply a missing character in a sentence from a pinyin prompt. The listening and reading passages grow to paragraph length.',
      tips:
        'The word-ordering task rewards a memorised default order, so practise assembling subject, time, place, adverb, verb and complement from cards until it is mechanical. Handwrite the new characters as well as typing them, because the gap-fill task tests production, not recognition.',
    },
  },
];
