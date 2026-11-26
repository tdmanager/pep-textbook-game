/**
 * 二年级上册语文 · 趣味记忆游戏核心逻辑
 * 极简三颗星设计：
 * 每个单元共有 3 种趣味玩法，玩通任意一种即点亮对应星星（最多 3 颗星 ⭐⭐⭐）：
 * - bubble: 🫧 戳泡泡（课本问答 8 题闯关）
 * - spell:  ✍️ 拼名句（古诗韵文成语积木接龙 6 题闯关）
 * - match:  🃏 消消乐（橙蓝双色课本配对 6 对消除）
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pep_grade2_chinese_v2';
  const GAME_MODES = ['bubble', 'spell', 'match'];

  /** 创建默认轻量存档 */
  function createDefaultState() {
    return {
      soundOn: true,
      // unitStars: { u1: { bubble: true, spell: false, match: true }, ... }
      unitModesCleared: {}
    };
  }

  /** 安全归一化存档 */
  function normalizeState(raw) {
    const def = createDefaultState();
    if (!raw || typeof raw !== 'object') return def;

    const cleaned = {};
    if (raw.unitModesCleared && typeof raw.unitModesCleared === 'object') {
      for (const [uid, val] of Object.entries(raw.unitModesCleared)) {
        if (val && typeof val === 'object') {
          cleaned[uid] = {
            bubble: Boolean(val.bubble),
            spell: Boolean(val.spell),
            match: Boolean(val.match)
          };
        }
      }
    }

    return {
      soundOn: typeof raw.soundOn === 'boolean' ? raw.soundOn : true,
      unitModesCleared: cleaned
    };
  }

  /** 计算某个单元已点亮的星星数 (0~3) */
  function getUnitStarCount(state, unitId) {
    const rec = state?.unitModesCleared?.[unitId];
    if (!rec) return 0;
    return GAME_MODES.reduce((sum, m) => sum + (rec[m] ? 1 : 0), 0);
  }

  /** 计算全书总星星数与最大星星数 */
  function getTotalStarProgress(state, units) {
    let earned = 0;
    const total = (units || []).length * 3;
    for (const u of units || []) {
      earned += getUnitStarCount(state, u.id);
    }
    return { earned, total };
  }

  /** 标记某单元的某个游戏玩法已通关 */
  function markUnitModeCleared(state, unitId, mode) {
    if (!unitId || unitId === 'all' || !GAME_MODES.includes(mode)) {
      return { newlyLit: false, unitStars: 0 };
    }
    if (!state.unitModesCleared[unitId]) {
      state.unitModesCleared[unitId] = { bubble: false, spell: false, match: false };
    }
    const wasCleared = Boolean(state.unitModesCleared[unitId][mode]);
    state.unitModesCleared[unitId][mode] = true;
    return {
      newlyLit: !wasCleared,
      unitStars: getUnitStarCount(state, unitId)
    };
  }

  /** 洗牌算法 */
  function shuffle(arr, rng = Math.random) {
    const list = Array.isArray(arr) ? arr.slice() : [];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /**
   * 生成「🫧 戳泡泡」一局题目队列（默认 8 道题，每题 4 个大号彩色泡泡）
   * @param {Array} items 候选知识点
   * @param {object} [opts] { count = 8, rng = Math.random }
   */
  function buildBubbleRound(items, opts = {}) {
    const rng = opts.rng || Math.random;
    const count = Math.min(items.length, Math.max(1, Number(opts.count) || 8));
    const picked = shuffle(items, rng).slice(0, count);
    const themes = ['coral', 'sky', 'mint', 'amber'];

    return picked.map((item) => {
      const ans = String(item.answer).trim();
      const seen = new Set([ans]);
      const wrongs = [];
      for (const d of item.distractors || []) {
        const txt = String(d || '').trim();
        if (txt && !seen.has(txt)) {
          seen.add(txt);
          wrongs.push(txt);
        }
        if (wrongs.length >= 3) break;
      }

      const rawOptions = shuffle(
        [
          { text: ans, isCorrect: true },
          ...wrongs.map((t) => ({ text: t, isCorrect: false }))
        ],
        rng
      );

      const bubbles = rawOptions.map((opt, idx) => ({
        text: opt.text,
        isCorrect: opt.isCorrect,
        theme: themes[idx % themes.length],
        delay: Number(((idx * 0.4) % 1.6).toFixed(2))
      }));

      return { item, bubbles };
    });
  }

  /**
   * 生成单个知识点的「✍️ 拼名句」汉字积木谜题
   * @param {object} item 带有 spellTarget 的课本知识点
   * @param {function} [rng]
   */
  function createSpellPuzzle(item, rng = Math.random) {
    const cleanTarget = String(item.spellTarget || '').replace(/[，。！？、\s]/g, '').trim();
    const chars = Array.from(cleanTarget);
    const usedChars = new Set(chars);

    // 从干扰项和常用诗词字中抽取 3 个不重复干扰字，总共约 5~10 块大号字块
    const noiseCandidates = [];
    for (const d of item.distractors || []) {
      for (const ch of Array.from(String(d).replace(/[，。！？、（）()\s]/g, ''))) {
        if (/[\u4e00-\u9fa5]/.test(ch) && !usedChars.has(ch)) {
          usedChars.add(ch);
          noiseCandidates.push(ch);
        }
      }
    }

    const fallbackChars = ['春', '风', '山', '水', '云', '月', '花', '鸟', '林', '雪', '天', '高'];
    for (const ch of shuffle(fallbackChars, rng)) {
      if (noiseCandidates.length >= 3) break;
      if (!usedChars.has(ch)) {
        usedChars.add(ch);
        noiseCandidates.push(ch);
      }
    }

    const noiseCount = chars.length >= 6 ? 2 : 3;
    const noisePicked = shuffle(noiseCandidates, rng).slice(0, noiseCount);

    const tiles = shuffle(
      [
        ...chars.map((ch, idx) => ({ tileId: `c_${idx}_${ch}`, text: ch, isNoise: false })),
        ...noisePicked.map((ch, idx) => ({ tileId: `n_${idx}_${ch}`, text: ch, isNoise: true }))
      ],
      rng
    );

    return {
      item,
      targetText: cleanTarget,
      chars,
      tiles
    };
  }

  /**
   * 生成「✍️ 拼名句」一局队列（默认 6 题）
   */
  function buildSpellRound(items, opts = {}) {
    const rng = opts.rng || Math.random;
    const eligible = (items || []).filter(
      (it) => it.spellTarget && String(it.spellTarget).trim().length >= 2
    );
    const count = Math.min(eligible.length, Math.max(1, Number(opts.count) || 6));
    return shuffle(eligible, rng)
      .slice(0, count)
      .map((it) => createSpellPuzzle(it, rng));
  }

  /**
   * 校验「✍️ 拼名句」拼装结果
   */
  function checkSpellTiles(puzzle, chosenTiles) {
    const actual = (chosenTiles || []).map((t) => t.text).join('');
    return {
      isCorrect: actual === puzzle.targetText,
      expected: puzzle.targetText,
      actual
    };
  }

  /**
   * 生成「🃏 消消乐」橙蓝双色好友配对卡组（默认 6 对 = 12 张明牌卡片，零重名冲突）
   * - side = 'left'（暖橙色题面/上句卡）
   * - side = 'right'（晴空蓝答案/下句卡）
   */
  function buildMatchDeck(items, opts = {}) {
    const rng = opts.rng || Math.random;
    const pairCount = Math.max(2, Number(opts.pairCount) || 6);
    const shuffled = shuffle(items, rng);

    const chosen = [];
    const seenText = new Set();

    for (const it of shuffled) {
      const left = String(it.pairLeft || '').trim();
      const right = String(it.pairRight || '').trim();
      if (!left || !right || left === right) continue;
      if (seenText.has(left) || seenText.has(right)) continue;

      seenText.add(left);
      seenText.add(right);
      chosen.push(it);
      if (chosen.length >= pairCount) break;
    }

    const cards = [];
    for (const it of chosen) {
      cards.push({
        cardId: `${it.id}_L`,
        pairId: it.id,
        side: 'left',
        text: String(it.pairLeft).trim(),
        item: it
      });
      cards.push({
        cardId: `${it.id}_R`,
        pairId: it.id,
        side: 'right',
        text: String(it.pairRight).trim(),
        item: it
      });
    }

    return shuffle(cards, rng);
  }

  const GameLogic = {
    STORAGE_KEY,
    GAME_MODES,
    createDefaultState,
    normalizeState,
    getUnitStarCount,
    getTotalStarProgress,
    markUnitModeCleared,
    shuffle,
    buildBubbleRound,
    createSpellPuzzle,
    buildSpellRound,
    checkSpellTiles,
    buildMatchDeck
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameLogic;
  } else {
    root.PEPGameLogic = GameLogic;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
