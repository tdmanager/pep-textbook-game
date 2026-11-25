/**
 * 课本奇趣岛 - 游戏核心逻辑与艾宾浩斯智能错题复习引擎
 * 包含：
 * 1. 学习档案与课本闯关星级结算
 * 2. 艾宾浩斯遗忘曲线调度算法（阶段推进、到期筛选、错题记录与攻克移除）
 * 3. 四大趣味记忆小游戏生成器（翻牌消消乐、听音/读题打泡泡、古诗接龙/拼词填字、60秒闪电挑战）
 * 4. 单元综合闯关任务构建器
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pep_textbook_island_v1';

  /**
   * 艾宾浩斯记忆复习间隔（单位：分钟）
   * Stage 0 -> 立即复习 (0m)
   * Stage 1 -> 5 分钟后
   * Stage 2 -> 30 分钟后
   * Stage 3 -> 12 小时后 (720m)
   * Stage 4 -> 1 天后 (1440m)
   * Stage 5 -> 3 天后 (4320m)
   * Stage 6 -> 已彻底攻克毕业！
   */
  const EBBINGHAUS_STAGE_MINUTES = [0, 5, 30, 720, 1440, 4320];

  const EBBINGHAUS_STAGE_LABELS = [
    '首次待巩固',
    '5分钟短时记忆',
    '30分钟强化期',
    '12小时隔夜记',
    '1天周期巩固',
    '3天长效冲刺'
  ];

  /** 创建默认玩家存档状态 */
  function createDefaultState() {
    return {
      grade: 1,
      semester: 1,
      subject: 'cn',
      totalStars: 0,
      totalAnswered: 0,
      totalCorrect: 0,
      totalReviewed: 0,
      bestRushScore: 0,
      bestRushCorrect: 0,
      unitProgress: {}, // { [unitId]: { stars: 1..3, bestCorrect: 0..6, attempts: 1, updatedAt } }
      mistakes: {}, // { [itemId]: { itemId, wrongCount, streak, stage, lastWrongAt, nextReviewAt } }
      masteredIds: [], // 已从错题本彻底攻克毕业的知识点 ID 列表
      unlockedBadges: [],
      settings: {
        accent: 'en-GB',
        rate: 0.88,
        sfxEnabled: true,
        autoSpeak: true
      }
    };
  }

  /** 安全归一化存档数据，兼容旧结构或损坏字段 */
  function normalizeState(raw) {
    const def = createDefaultState();
    if (!raw || typeof raw !== 'object') return def;

    return {
      grade: [1, 2, 3, 4, 5, 6].includes(Number(raw.grade)) ? Number(raw.grade) : def.grade,
      semester: [1, 2].includes(Number(raw.semester)) ? Number(raw.semester) : def.semester,
      subject: ['cn', 'en', 'ma', 'sc'].includes(raw.subject) ? raw.subject : def.subject,
      totalStars: Math.max(0, Number(raw.totalStars) || 0),
      totalAnswered: Math.max(0, Number(raw.totalAnswered) || 0),
      totalCorrect: Math.max(0, Number(raw.totalCorrect) || 0),
      totalReviewed: Math.max(0, Number(raw.totalReviewed) || 0),
      bestRushScore: Math.max(0, Number(raw.bestRushScore) || 0),
      bestRushCorrect: Math.max(0, Number(raw.bestRushCorrect) || 0),
      unitProgress: raw.unitProgress && typeof raw.unitProgress === 'object' ? { ...raw.unitProgress } : {},
      mistakes: raw.mistakes && typeof raw.mistakes === 'object' ? { ...raw.mistakes } : {},
      masteredIds: Array.isArray(raw.masteredIds) ? Array.from(new Set(raw.masteredIds)) : [],
      unlockedBadges: Array.isArray(raw.unlockedBadges) ? Array.from(new Set(raw.unlockedBadges)) : [],
      settings: {
        accent: raw.settings?.accent === 'en-US' ? 'en-US' : 'en-GB',
        rate: typeof raw.settings?.rate === 'number' ? raw.settings.rate : 0.88,
        sfxEnabled: typeof raw.settings?.sfxEnabled === 'boolean' ? raw.settings.sfxEnabled : true,
        autoSpeak: typeof raw.settings?.autoSpeak === 'boolean' ? raw.settings.autoSpeak : true
      }
    };
  }

  /** 洗牌算法（Fisher-Yates） */
  function shuffle(list, rng = Math.random) {
    const arr = Array.isArray(list) ? list.slice() : [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * 为单个知识点构造不重复的四选一（或多选一）选项列表
   * @param {object} targetItem 目标知识点
   * @param {Array} pool 候选补充池
   * @param {number} optionCount 选项总数（默认 4）
   */
  function buildChoiceOptions(targetItem, pool = [], optionCount = 4, rng = Math.random) {
    const correctText = String(targetItem.answer).trim();
    const seen = new Set([correctText]);
    const distractors = [];

    // 1. 优先采用词条精配的高迷惑干扰项
    for (const d of targetItem.distractors || []) {
      const txt = String(d || '').trim();
      if (txt && !seen.has(txt)) {
        seen.add(txt);
        distractors.push(txt);
      }
      if (distractors.length >= optionCount - 1) break;
    }

    // 2. 不足时从同范围知识点池补充
    if (distractors.length < optionCount - 1 && Array.isArray(pool)) {
      const candidates = shuffle(
        pool.filter((x) => x && x.id !== targetItem.id && x.subject === targetItem.subject),
        rng
      );
      for (const c of candidates) {
        const txt = String(c.answer || '').trim();
        if (txt && !seen.has(txt)) {
          seen.add(txt);
          distractors.push(txt);
        }
        if (distractors.length >= optionCount - 1) break;
      }
    }

    const options = [
      { text: correctText, isCorrect: true },
      ...distractors.map((txt) => ({ text: txt, isCorrect: false }))
    ];
    return shuffle(options, rng);
  }

  /**
   * 提取用于“魔法块拼字/接龙”的精炼目标文本（剥离补充圆括号说明与句末标点）
   * @param {object} item 知识点对象
   * @returns {string}
   */
  function extractCleanFillTarget(item) {
    let raw = String(item.fillTarget || item.answer || '').trim();
    if (!raw) return '';

    // 剥离中文全角括号内的补充解释（如 "不会（反射太阳光）" -> "不会"）
    if (item.type !== 'math') {
      const stripped = raw.replace(/（[^）]*）/g, '').trim();
      if (stripped.length >= 1) {
        raw = stripped;
      }
    }

    // 去除首尾句号、感叹号、问号
    raw = raw.replace(/^[，。！？,.!?]+|[，。！？,.!?]+$/g, '').trim();
    return raw || String(item.answer).trim();
  }

  /**
   * 将精炼目标文本智能切分为 1~7 个适合手机点击拼装的魔法块
   * @param {string} cleanTarget 精炼目标字符串
   * @param {string} itemType 题型 'word' | 'poem' | 'char' | 'math' | 'fact'
   * @returns {Array<string>}
   */
  function splitTargetIntoSegments(cleanTarget, itemType) {
    const str = String(cleanTarget || '').trim();
    if (!str) return [];

    // 英语单词：保留字母/连字符，忽略空格或按词切分
    if (itemType === 'word' || /^[a-zA-Z\s-]+$/.test(str)) {
      const compact = str.replace(/\s+/g, '');
      if (compact.length <= 6) {
        return Array.from(compact);
      }
      // 较长单词按 2~3 个字符切成 4~6 块，避免槽位过多
      const chunkSize = compact.length > 10 ? 3 : 2;
      const chunks = [];
      for (let i = 0; i < compact.length; i += chunkSize) {
        chunks.push(compact.slice(i, i + chunkSize));
      }
      return chunks;
    }

    // 中文古诗、字词、数学算式或科学口诀
    const chars = Array.from(str);
    if (chars.length <= 7) {
      return chars;
    }

    // 超过 7 个字的长口诀，自动按 2~3 字词组切分为 4~6 个词组块，点击体验丝滑
    const groupSize = Math.ceil(chars.length / 5);
    const groups = [];
    for (let i = 0; i < chars.length; i += groupSize) {
      groups.push(chars.slice(i, i + groupSize).join(''));
    }
    return groups;
  }

  /**
   * 生成“古诗接龙与拼词填字”谜题（Tile Builder）
   * @param {object} item 知识点对象
   * @param {object} [opts] { distractorCount = 3, rng = Math.random }
   */
  function generateTilePuzzle(item, opts = {}) {
    const rng = opts.rng || Math.random;
    const distractorCount = typeof opts.distractorCount === 'number' ? opts.distractorCount : 3;

    const cleanTarget = extractCleanFillTarget(item);
    const segments = splitTargetIntoSegments(cleanTarget, item.type);
    const existingSet = new Set(segments);

    // 从当前题目的干扰项中提取同风格干扰碎片
    const candidateNoise = [];
    for (const d of item.distractors || []) {
      const cleanD = String(d || '')
        .replace(/（[^）]*）/g, '')
        .replace(/[，。！？,.!?\s]+/g, '')
        .trim();
      if (!cleanD) continue;
      const dSegs = splitTargetIntoSegments(cleanD, item.type);
      for (const s of dSegs) {
        if (s && !existingSet.has(s)) {
          existingSet.add(s);
          candidateNoise.push(s);
        }
      }
    }

    // 兜底补充同类型干扰字符，确保始终有足够干扰块提升趣味性
    const fallbackPool =
      item.type === 'word'
        ? ['a', 'e', 'i', 'o', 'u', 's', 't', 'n', 'r', 'l']
        : item.type === 'math'
          ? ['0', '1', '2', '3', '4', '5', '6', '8', '9', '×']
          : ['春', '风', '山', '水', '月', '云', '花', '心', '人', '不'];

    for (const fb of shuffle(fallbackPool, rng)) {
      if (candidateNoise.length >= distractorCount) break;
      if (!existingSet.has(fb)) {
        existingSet.add(fb);
        candidateNoise.push(fb);
      }
    }

    const noisePieces = shuffle(candidateNoise, rng).slice(0, distractorCount);

    const correctTiles = segments.map((text, idx) => ({
      tileId: `c_${idx}_${text}`,
      text,
      isNoise: false
    }));
    const noiseTiles = noisePieces.map((text, idx) => ({
      tileId: `n_${idx}_${text}`,
      text,
      isNoise: true
    }));

    return {
      item,
      cleanTarget,
      segments,
      tiles: shuffle([...correctTiles, ...noiseTiles], rng)
    };
  }

  /**
   * 校验玩家在“古诗接龙/拼词填字”中的拼装结果
   * @param {object} puzzle generateTilePuzzle 返回的谜题对象
   * @param {Array<object>} chosenTiles 玩家依次选中的魔法块数组
   */
  function checkTileAttempt(puzzle, chosenTiles) {
    const expected = puzzle.segments.join('');
    const actual = (chosenTiles || []).map((t) => t.text).join('');
    const isCorrect =
      puzzle.item.type === 'word'
        ? actual.toLowerCase() === expected.toLowerCase()
        : actual === expected;
    return {
      isCorrect,
      expected,
      actual
    };
  }

  /**
   * 生成“翻牌消消乐”卡组（确保每对牌的正反面文本在局内唯一不重名，消除歧义！）
   * @param {Array} items 候选知识点数组
   * @param {object} [opts] { pairCount = 6, supplementPool = [], rng = Math.random }
   */
  function generateMemoryDeck(items, opts = {}) {
    const rng = opts.rng || Math.random;
    const pairCount = Math.max(2, Number(opts.pairCount) || 6);
    const supplement = Array.isArray(opts.supplementPool) ? opts.supplementPool : [];

    const candidates = [...shuffle(items, rng), ...shuffle(supplement, rng)];
    const chosen = [];
    const usedIds = new Set();
    const usedFaces = new Set();

    for (const item of candidates) {
      if (!item || usedIds.has(item.id)) continue;
      const frontText = String(item.cardFront || item.front).trim();
      const backText = String(item.cardBack || item.back).trim();
      if (!frontText || !backText || frontText === backText) continue;
      if (usedFaces.has(frontText) || usedFaces.has(backText)) continue;

      usedIds.add(item.id);
      usedFaces.add(frontText);
      usedFaces.add(backText);
      chosen.push(item);
      if (chosen.length >= pairCount) break;
    }

    const cards = [];
    for (const item of chosen) {
      cards.push({
        cardId: `${item.id}_A`,
        pairId: item.id,
        side: 'front',
        text: String(item.cardFront || item.front).trim(),
        subTag: item.type === 'word' ? '英文' : item.type === 'poem' ? '上句' : '题面',
        item
      });
      cards.push({
        cardId: `${item.id}_B`,
        pairId: item.id,
        side: 'back',
        text: String(item.cardBack || item.back).trim(),
        subTag: item.type === 'word' ? '释义' : item.type === 'poem' ? '下句' : '答案',
        item
      });
    }

    return shuffle(cards, rng);
  }

  /**
   * 生成“听音/看题打泡泡”单局题目（含 5 个彩色漂浮泡泡）
   * @param {Array} items 候选知识点池
   * @param {object} [opts] { bubbleCount = 5, rng = Math.random, excludeId = '' }
   */
  function generateBubbleQuestion(items, opts = {}) {
    const rng = opts.rng || Math.random;
    const bubbleCount = Math.max(4, Number(opts.bubbleCount) || 5);
    if (!Array.isArray(items) || items.length === 0) return null;

    let pool = items.filter((x) => x && x.id !== opts.excludeId);
    if (pool.length === 0) pool = items.slice();

    const target = pool[Math.floor(rng() * pool.length)];
    const choiceList = buildChoiceOptions(target, items, bubbleCount, rng);

    const palettes = ['coral', 'sky', 'mint', 'violet', 'amber', 'rose'];
    const bubbles = choiceList.map((opt, idx) => ({
      bubbleId: `b_${idx}_${target.id}`,
      text: opt.text,
      isCorrect: opt.isCorrect,
      colorTheme: palettes[idx % palettes.length],
      floatDelay: Number(((idx * 0.45) % 2.2).toFixed(2))
    }));

    return {
      target,
      prompt: target.prompt,
      bubbles
    };
  }

  /**
   * 生成“单元综合闯关”任务队列（融合选择题 + 魔法块拼字接龙题）
   * @param {object} unit 课本单元对象
   * @param {Array} bookPool 同册补充知识点池
   * @param {function} [rng]
   */
  function buildUnitQuest(unit, bookPool = [], rng = Math.random) {
    if (!unit || !Array.isArray(unit.items)) return [];
    const ordered = shuffle(unit.items, rng);

    return ordered.map((item, idx) => {
      // 第 3 题和第 6 题采用趣味“拼词/古诗接龙”互动题，其余采用四选一快答，节奏丰富不枯燥
      const cleanLen = extractCleanFillTarget(item).length;
      const useTileMode = (idx === 2 || idx === 5) && cleanLen >= 2 && cleanLen <= 12;

      if (useTileMode) {
        return {
          stepIndex: idx,
          mode: 'tile',
          item,
          puzzle: generateTilePuzzle(item, { distractorCount: 3, rng })
        };
      }

      return {
        stepIndex: idx,
        mode: 'choice',
        item,
        options: buildChoiceOptions(item, bookPool.length ? bookPool : unit.items, 4, rng)
      };
    });
  }

  /**
   * 计算单元闯关星级（0~3 星）
   * @param {number} correctCount 答对题数
   * @param {number} totalCount 总题数
   */
  function computeQuestStars(correctCount, totalCount) {
    if (totalCount <= 0) return 0;
    const ratio = correctCount / totalCount;
    if (correctCount === totalCount) return 3;
    if (ratio >= 0.66) return 2;
    if (ratio >= 0.5) return 1;
    return 0;
  }

  /**
   * 记录单道知识点的作答结果，自动联动艾宾浩斯错题本
   * @param {object} state 玩家状态（原地更新）
   * @param {string} itemId 知识点 ID
   * @param {boolean} isCorrect 是否答对
   * @param {object} [context] { isReviewMode = false, now = Date.now() }
   */
  function recordAnswerOutcome(state, itemId, isCorrect, context = {}) {
    const now = typeof context.now === 'number' ? context.now : Date.now();
    const isReviewMode = Boolean(context.isReviewMode);

    state.totalAnswered = (state.totalAnswered || 0) + 1;

    if (isCorrect) {
      state.totalCorrect = (state.totalCorrect || 0) + 1;

      const existing = state.mistakes[itemId];
      if (existing && isReviewMode) {
        // 在艾宾浩斯复习模式中答对 -> 推进记忆阶段！
        const nextStage = (existing.stage || 0) + 1;
        state.totalReviewed = (state.totalReviewed || 0) + 1;

        if (nextStage >= EBBINGHAUS_STAGE_MINUTES.length) {
          // 走完完整艾宾浩斯曲线，彻底攻克移出错题本！
          delete state.mistakes[itemId];
          if (!state.masteredIds.includes(itemId)) {
            state.masteredIds.push(itemId);
          }
          return {
            ebbinghausAction: 'graduated',
            stage: nextStage,
            stageLabel: '已彻底掌握'
          };
        }

        const waitMinutes = EBBINGHAUS_STAGE_MINUTES[nextStage];
        existing.stage = nextStage;
        existing.streak = (existing.streak || 0) + 1;
        existing.nextReviewAt = now + waitMinutes * 60 * 1000;
        return {
          ebbinghausAction: 'promoted',
          stage: nextStage,
          stageLabel: EBBINGHAUS_STAGE_LABELS[nextStage] || '巩固中',
          nextReviewAt: existing.nextReviewAt
        };
      }

      return { ebbinghausAction: 'none' };
    }

    // 答错 -> 自动归集或重置艾宾浩斯阶段（立即可复习！）
    const prev = state.mistakes[itemId];
    const nextStage = prev ? Math.max(0, (prev.stage || 0) - 1) : 0;
    state.mistakes[itemId] = {
      itemId,
      wrongCount: prev ? (prev.wrongCount || 0) + 1 : 1,
      streak: 0,
      stage: nextStage,
      lastWrongAt: now,
      nextReviewAt: now // 刚答错的薄弱项立即进入待复习队列
    };

    return {
      ebbinghausAction: prev ? 'reset' : 'added',
      stage: nextStage,
      stageLabel: EBBINGHAUS_STAGE_LABELS[nextStage]
    };
  }

  /**
   * 手动将错题标记为“已熟记掌握”并移出错题本
   */
  function markMistakeMastered(state, itemId) {
    if (!state.mistakes[itemId]) return false;
    delete state.mistakes[itemId];
    state.totalReviewed = (state.totalReviewed || 0) + 1;
    if (!state.masteredIds.includes(itemId)) {
      state.masteredIds.push(itemId);
    }
    return true;
  }

  /**
   * 获取艾宾浩斯错题列表（按是否已到复习时间 & 错误次数智能排序）
   * @param {object} state 玩家状态
   * @param {function} getItemById 根据 ID 查知识点的函数
   * @param {object} [opts] { onlyDue = false, subject = 'all', now = Date.now() }
   */
  function getMistakeRecords(state, getItemById, opts = {}) {
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const onlyDue = Boolean(opts.onlyDue);
    const subject = opts.subject || 'all';

    const records = [];
    for (const key of Object.keys(state.mistakes || {})) {
      const rec = state.mistakes[key];
      const item = typeof getItemById === 'function' ? getItemById(key) : null;
      if (!item) continue;
      if (subject !== 'all' && item.subject !== subject) continue;

      const isDue = (rec.nextReviewAt || 0) <= now;
      if (onlyDue && !isDue) continue;

      records.push({
        ...rec,
        item,
        isDue,
        stageLabel: EBBINGHAUS_STAGE_LABELS[rec.stage || 0] || '待巩固'
      });
    }

    // 排序优先级：1. 已到期优先；2. 错误次数多优先；3. 阶段低优先
    records.sort((a, b) => {
      if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
      if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
      return (a.stage || 0) - (b.stage || 0);
    });

    return records;
  }

  /**
   * 结算单元闯关成绩并更新最高星级与智慧星奖励
   */
  function completeUnitQuest(state, unitId, correctCount, totalCount, now = Date.now()) {
    const stars = computeQuestStars(correctCount, totalCount);
    const prev = state.unitProgress[unitId];
    const prevStars = prev ? prev.stars || 0 : 0;

    // 首次摘星得全额星数奖励，重复通关至少奖励 2 颗鼓励智慧星
    let starsReward = 0;
    if (stars > 0) {
      if (stars > prevStars) {
        starsReward = (stars - prevStars) * 4 + 2;
      } else {
        starsReward = 2;
      }
    } else {
      starsReward = 1; // 参与鼓励星
    }

    state.totalStars = (state.totalStars || 0) + starsReward;
    state.unitProgress[unitId] = {
      stars: Math.max(prevStars, stars),
      bestCorrect: Math.max(prev ? prev.bestCorrect || 0 : 0, correctCount),
      attempts: (prev ? prev.attempts || 0 : 0) + 1,
      updatedAt: now
    };

    return {
      stars,
      prevStars,
      isNewRecord: stars > prevStars,
      starsReward
    };
  }

  /**
   * 结算 60 秒限时闪电挑战记录
   */
  function completeRushRound(state, score, correctCount) {
    const starsReward = Math.max(1, Math.min(10, Math.floor(correctCount / 2) + 1));
    const isNewBest = score > (state.bestRushScore || 0);
    state.bestRushScore = Math.max(state.bestRushScore || 0, score);
    state.bestRushCorrect = Math.max(state.bestRushCorrect || 0, correctCount);
    state.totalStars = (state.totalStars || 0) + starsReward;
    return { isNewBest, starsReward };
  }

  /**
   * 汇总全局统计指标并检测新解锁的勋章
   * @param {object} state 玩家状态
   * @param {object} textbookData TextbookData 模块
   */
  function evaluateStatsAndBadges(state, textbookData) {
    const units = textbookData.UNITS || [];
    let clearedUnits = 0;
    let perfectUnits = 0;
    const subjectsSet = new Set();
    const bookClearCountMap = new Map();

    for (const u of units) {
      const prog = state.unitProgress[u.id];
      if (prog && prog.stars >= 1) {
        clearedUnits++;
        if (prog.stars >= 3) perfectUnits++;
        subjectsSet.add(u.subject);
        const bookKey = `g${u.grade}s${u.semester}_${u.subject}`;
        bookClearCountMap.set(bookKey, (bookClearCountMap.get(bookKey) || 0) + 1);
      }
    }

    let booksCompleted = 0;
    for (const [, count] of bookClearCountMap.entries()) {
      if (count >= 3) booksCompleted++;
    }

    const stats = {
      clearedUnits,
      perfectUnits,
      totalUnits: units.length,
      subjectsCleared: subjectsSet.size,
      booksCompleted,
      totalStars: state.totalStars || 0,
      totalReviewed: state.totalReviewed || 0,
      bestRushScore: state.bestRushScore || 0,
      bestRushCorrect: state.bestRushCorrect || 0,
      mistakeCount: Object.keys(state.mistakes || {}).length,
      masteredCount: (state.masteredIds || []).length
    };

    const newlyUnlocked = [];
    for (const badge of textbookData.BADGES || []) {
      if (!state.unlockedBadges.includes(badge.id) && badge.check(stats)) {
        state.unlockedBadges.push(badge.id);
        newlyUnlocked.push(badge);
      }
    }

    return { stats, newlyUnlocked };
  }

  /** 格式化距离下次艾宾浩斯复习的友好中文提示 */
  function formatNextReviewCountdown(nextReviewAt, now = Date.now()) {
    const diffMs = (nextReviewAt || 0) - now;
    if (diffMs <= 0) return '🔔 现在待复习';
    const mins = Math.ceil(diffMs / 60000);
    if (mins < 60) return `${mins} 分钟后复习`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `约 ${hours} 小时后复习`;
    const days = Math.round(hours / 24);
    return `约 ${days} 天后复习`;
  }

  const GameLogic = {
    STORAGE_KEY,
    EBBINGHAUS_STAGE_MINUTES,
    EBBINGHAUS_STAGE_LABELS,
    createDefaultState,
    normalizeState,
    shuffle,
    buildChoiceOptions,
    extractCleanFillTarget,
    splitTargetIntoSegments,
    generateTilePuzzle,
    checkTileAttempt,
    generateMemoryDeck,
    generateBubbleQuestion,
    buildUnitQuest,
    computeQuestStars,
    recordAnswerOutcome,
    markMistakeMastered,
    getMistakeRecords,
    completeUnitQuest,
    completeRushRound,
    evaluateStatsAndBadges,
    formatNextReviewCountdown
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameLogic;
  } else {
    root.PEPGameLogic = GameLogic;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
