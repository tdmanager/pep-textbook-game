/**
 * 课本奇趣岛 - 人教版小学 1~6 年级全科题库索引与标准化引擎
 * 汇总 6 个年级 × 上下册 × 4 大学科 = 48 册教材、144 个同步单元、864 个核心知识点
 */
(function (root) {
  'use strict';

  const DataLow =
    typeof module !== 'undefined' && module.exports
      ? require('./data-g1-g3.js')
      : root.PEPDataLow;

  const DataHigh =
    typeof module !== 'undefined' && module.exports
      ? require('./data-g4-g6.js')
      : root.PEPDataHigh;

  /** 年级列表 */
  const GRADES = [
    { id: 1, name: '一年级', shortName: '一', badge: '萌芽学童', emoji: '🌱' },
    { id: 2, name: '二年级', shortName: '二', badge: '好奇探索家', emoji: '🌿' },
    { id: 3, name: '三年级', shortName: '三', badge: '乘风小骑士', emoji: '⛵' },
    { id: 4, name: '四年级', shortName: '四', badge: '博学小达人', emoji: '🔭' },
    { id: 5, name: '五年级', shortName: '五', badge: '智慧领航员', emoji: '🚀' },
    { id: 6, name: '六年级', shortName: '六', badge: '巅峰状元郎', emoji: '👑' }
  ];

  /** 学期列表 */
  const SEMESTERS = [
    { id: 1, name: '上册', shortName: '上' },
    { id: 2, name: '下册', shortName: '下' }
  ];

  /** 四大学科元数据 */
  const SUBJECTS = [
    {
      id: 'cn',
      name: '语文',
      fullName: '统编版语文',
      icon: '📖',
      color: '#FF6B4A',
      desc: '必背古诗词、文言名篇、生字拼音与国学日积月累'
    },
    {
      id: 'en',
      name: '英语',
      fullName: '人教版英语 (PEP/新起点)',
      icon: '🔤',
      color: '#3B82F6',
      desc: '单元同步四会单词、真人发音听辨与拼写闯关'
    },
    {
      id: 'ma',
      name: '数学',
      fullName: '人教版数学',
      icon: '🧮',
      color: '#10B981',
      desc: '单元口算巧算、核心几何公式、进率换算与思维广角'
    },
    {
      id: 'sc',
      name: '科学·道法',
      fullName: '小学科学 & 道德与法治',
      icon: '🔬',
      color: '#8B5CF6',
      desc: '科学实验原理、天文地理常识、安全自护与法治素养'
    }
  ];

  /** 荣誉成就勋章列表 */
  const BADGES = [
    {
      id: 'first_unit',
      name: '初探书海',
      icon: '🎒',
      desc: '首次通关任意 1 个课本同步单元',
      check: (stats) => stats.clearedUnits >= 1
    },
    {
      id: 'three_stars_5',
      name: '三星学霸',
      icon: '🌟',
      desc: '累计获得 5 个单元满星（⭐⭐⭐）评价',
      check: (stats) => stats.perfectUnits >= 5
    },
    {
      id: 'all_subjects',
      name: '全科小能手',
      icon: '🎨',
      desc: '语文、英语、数学、科学道法四科均至少通关 1 关',
      check: (stats) => stats.subjectsCleared >= 4
    },
    {
      id: 'book_master',
      name: '整册通关王',
      icon: '📘',
      desc: '点亮任意一整册课本的全部 3 个核心单元',
      check: (stats) => stats.booksCompleted >= 1
    },
    {
      id: 'review_hero',
      name: '记忆战胜者',
      icon: '🧠',
      desc: '通过艾宾浩斯错题本成功复习巩固 5 次知识点',
      check: (stats) => stats.totalReviewed >= 5
    },
    {
      id: 'lightning_15',
      name: '闪电大脑',
      icon: '⚡',
      desc: '在 60 秒限时挑战中单局答对 12 题以上',
      check: (stats) => stats.bestRushCorrect >= 12
    },
    {
      id: 'stars_100',
      name: '百星闪耀',
      icon: '🏆',
      desc: '累计收集达到 100 颗智慧星',
      check: (stats) => stats.totalStars >= 100
    },
    {
      id: 'grand_scholar',
      name: '博学小状元',
      icon: '👑',
      desc: '累计通关 24 个以上课本同步单元',
      check: (stats) => stats.clearedUnits >= 24
    }
  ];

  /**
   * 将紧凑元组标准化为功能完备的课本知识点对象 KnowledgeItem
   * @param {Array} tuple 原始元组
   * @param {string} unitId 所属单元 ID
   * @param {number} idx 单元内序号 (1..N)
   * @param {object} unitMeta 单元信息
   */
  function normalizeItem(tuple, unitId, idx, unitMeta) {
    const [type, col1, col2, col3, col4, distractors] = tuple;
    const id = `${unitId}_${idx}`;
    const base = {
      id,
      unitId,
      grade: unitMeta.grade,
      semester: unitMeta.semester,
      subject: unitMeta.subject,
      bookTag: unitMeta.bookTag,
      unitTitle: unitMeta.title,
      type
    };

    if (type === 'word') {
      // ['word', 英文单词, 中文释义, 音标, 课本例句助记, [3个英文干扰词]]
      const word = String(col1).trim();
      const zh = String(col2).trim();
      const phonetic = String(col3 || '').trim();
      const example = String(col4 || '').trim();
      return {
        ...base,
        front: word,
        back: zh,
        cardFront: word,
        cardBack: zh,
        prompt: `听音/看释义选单词：「${zh}」对应的课本英文是？`,
        answer: word,
        fillPrompt: `请根据中文「${zh}」${phonetic ? ` (${phonetic})` : ''} 拼出英文单词：`,
        fillTarget: word,
        phonetic,
        hint: example,
        speakEn: word,
        speakZh: '',
        distractors: Array.isArray(distractors) ? distractors.slice(0, 3) : []
      };
    }

    if (type === 'poem') {
      // ['poem', 上句, 下句, 完整问答提示, 课本助记与出处, [3个干扰项]]
      const upper = String(col1).trim();
      const lower = String(col2).trim();
      return {
        ...base,
        front: upper,
        back: lower,
        cardFront: upper,
        cardBack: lower,
        prompt: String(col3).trim(),
        answer: lower,
        fillPrompt: `${String(col3).trim()}\n上句：「${upper}」`,
        fillTarget: lower,
        phonetic: '',
        hint: String(col4 || '').trim(),
        speakEn: '',
        speakZh: `${upper}，${lower}`,
        distractors: Array.isArray(distractors) ? distractors.slice(0, 3) : []
      };
    }

    // 'char' | 'math' | 'fact'
    const questionFace = String(col1).trim();
    const ans = String(col2).trim();
    return {
      ...base,
      front: questionFace,
      back: ans,
      cardFront: questionFace,
      cardBack: ans,
      prompt: String(col3).trim(),
      answer: ans,
      fillPrompt: String(col1).trim(),
      fillTarget: ans,
      phonetic: '',
      hint: String(col4 || '').trim(),
      speakEn: '',
      speakZh: type === 'char' ? ans : '',
      distractors: Array.isArray(distractors) ? distractors.slice(0, 3) : []
    };
  }

  // 构建全量单元与知识点字典
  const rawAll = [
    ...(DataLow && DataLow.RAW_UNITS_G1_G3 ? DataLow.RAW_UNITS_G1_G3 : []),
    ...(DataHigh && DataHigh.RAW_UNITS_G4_G6 ? DataHigh.RAW_UNITS_G4_G6 : [])
  ];

  const UNITS = [];
  const UNIT_MAP = new Map();
  const ITEM_MAP = new Map();
  const ALL_ITEMS = [];

  for (const rawUnit of rawAll) {
    const unitId = `g${rawUnit.grade}s${rawUnit.semester}_${rawUnit.subject}_u${rawUnit.unitNo}`;
    const normalizedItems = (rawUnit.items || []).map((tuple, index) =>
      normalizeItem(tuple, unitId, index + 1, rawUnit)
    );
    const unitObj = {
      id: unitId,
      grade: rawUnit.grade,
      semester: rawUnit.semester,
      subject: rawUnit.subject,
      unitNo: rawUnit.unitNo,
      icon: rawUnit.icon || '📘',
      title: rawUnit.title,
      bookTag: rawUnit.bookTag,
      items: normalizedItems
    };
    UNITS.push(unitObj);
    UNIT_MAP.set(unitId, unitObj);
    for (const item of normalizedItems) {
      ITEM_MAP.set(item.id, item);
      ALL_ITEMS.push(item);
    }
  }

  /**
   * 按年级、学期、学科筛选课本单元列表
   * @param {object} filter { grade, semester, subject }
   */
  function getUnitsByFilter({ grade, semester, subject } = {}) {
    return UNITS.filter((u) => {
      if (grade && u.grade !== Number(grade)) return false;
      if (semester && u.semester !== Number(semester)) return false;
      if (subject && subject !== 'all' && u.subject !== subject) return false;
      return true;
    }).sort((a, b) => a.unitNo - b.unitNo);
  }

  /**
   * 获取指定筛选条件或指定单元下的全部知识点
   * @param {object} filter { unitId, grade, semester, subject }
   */
  function getItemsByScope({ unitId, grade, semester, subject } = {}) {
    if (unitId && unitId !== 'all') {
      const unit = UNIT_MAP.get(unitId);
      return unit ? unit.items.slice() : [];
    }
    const matchedUnits = getUnitsByFilter({ grade, semester, subject });
    const list = [];
    for (const u of matchedUnits) {
      list.push(...u.items);
    }
    return list;
  }

  /** 根据 ID 获取单个单元 */
  function getUnitById(unitId) {
    return UNIT_MAP.get(unitId) || null;
  }

  /** 根据 ID 获取单个知识点 */
  function getItemById(itemId) {
    return ITEM_MAP.get(itemId) || null;
  }

  /** 获取学科元数据 */
  function getSubjectMeta(subjectId) {
    return SUBJECTS.find((s) => s.id === subjectId) || SUBJECTS[0];
  }

  /** 获取课本册名展示标题，如“三年级上册 · 统编版语文” */
  function formatBookTitle(grade, semester, subject) {
    const g = GRADES.find((x) => x.id === Number(grade)) || GRADES[0];
    const s = SEMESTERS.find((x) => x.id === Number(semester)) || SEMESTERS[0];
    const sub = getSubjectMeta(subject);
    return `${g.name}${s.name} · ${sub.fullName}`;
  }

  const TextbookData = {
    GRADES,
    SEMESTERS,
    SUBJECTS,
    BADGES,
    UNITS,
    ALL_ITEMS,
    getUnitsByFilter,
    getItemsByScope,
    getUnitById,
    getItemById,
    getSubjectMeta,
    formatBookTitle
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextbookData;
  } else {
    root.PEPTextbookData = TextbookData;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
