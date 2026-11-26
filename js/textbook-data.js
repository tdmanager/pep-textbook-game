/**
 * 二年级语文（上册 + 下册）· 统编人教版课本同步题库汇总索引
 * 包含：
 * - 上册 8 个单元 × 12 题 = 96 个核心记忆点
 * - 下册 8 个单元 × 12 题 = 96 个核心记忆点
 * 全年合计 16 个单元、192 个课本必会考点
 */
(function (root) {
  'use strict';

  const DataS1 =
    typeof module !== 'undefined' && module.exports
      ? require('./data-s1.js')
      : root.PEPDataS1;

  const DataS2 =
    typeof module !== 'undefined' && module.exports
      ? require('./data-s2.js')
      : root.PEPDataS2;

  /** 上下两册元数据 */
  const BOOKS = [
    {
      id: 1,
      name: '二年级上册',
      shortName: '上册',
      icon: '📕',
      themeColor: '#FF7A45',
      bannerGradient: 'linear-gradient(135deg, #FF8A5B 0%, #FF6238 100%)'
    },
    {
      id: 2,
      name: '二年级下册',
      shortName: '下册',
      icon: '📘',
      themeColor: '#2563EB',
      bannerGradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)'
    }
  ];

  const rawUnits = [
    ...(DataS1 && DataS1.UNITS_S1 ? DataS1.UNITS_S1 : []),
    ...(DataS2 && DataS2.UNITS_S2 ? DataS2.UNITS_S2 : [])
  ];

  const UNITS = [];
  const ALL_ITEMS = [];
  const UNIT_MAP = new Map();
  const ITEM_MAP = new Map();

  for (const rawUnit of rawUnits) {
    const items = (rawUnit.items || []).map((raw, idx) => {
      const id = `${rawUnit.id}_${idx + 1}`;
      const item = {
        id,
        book: rawUnit.book,
        unitId: rawUnit.id,
        unitNo: rawUnit.unitNo,
        unitTitle: rawUnit.title,
        ...raw
      };
      ALL_ITEMS.push(item);
      ITEM_MAP.set(id, item);
      return item;
    });

    const unitObj = {
      ...rawUnit,
      items
    };
    UNITS.push(unitObj);
    UNIT_MAP.set(unitObj.id, unitObj);
  }

  /** 获取某册（1=上册，2=下册）的全部 8 个单元 */
  function getUnitsByBook(bookId) {
    const b = Number(bookId) === 2 ? 2 : 1;
    return UNITS.filter((u) => u.book === b).sort((a, b) => a.unitNo - b.unitNo);
  }

  /** 获取某单元或整册的知识点 */
  function getItemsByScope(unitId, bookId = 1) {
    if (!unitId || unitId === 'book_all') {
      const bUnits = getUnitsByBook(bookId);
      const res = [];
      for (const u of bUnits) res.push(...u.items);
      return res;
    }
    const u = UNIT_MAP.get(unitId);
    return u ? u.items.slice() : [];
  }

  function getUnitById(unitId) {
    return UNIT_MAP.get(unitId) || null;
  }

  function getItemById(itemId) {
    return ITEM_MAP.get(itemId) || null;
  }

  function getBookMeta(bookId) {
    return BOOKS.find((b) => b.id === Number(bookId)) || BOOKS[0];
  }

  const TextbookData = {
    BOOKS,
    UNITS,
    ALL_ITEMS,
    getUnitsByBook,
    getItemsByScope,
    getUnitById,
    getItemById,
    getBookMeta
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextbookData;
  } else {
    root.PEPTextbookData = TextbookData;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
