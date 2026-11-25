/**
 * 课本奇趣岛 - 主视图交互与游戏状态控制器
 * 负责驱动：课本单元闯关岛、四大趣味记忆小游戏、艾宾浩斯错题特训、荣誉勋章与本地存储
 */
(function () {
  'use strict';

  const Data = window.PEPTextbookData;
  const Logic = window.PEPGameLogic;
  const AudioMod = window.PEPAudio;

  if (!Data || !Logic || !AudioMod) return;

  const sound = new AudioMod.SoundEngine();

  /** 读取本地持久化存档 */
  function loadState() {
    try {
      const raw = localStorage.getItem(Logic.STORAGE_KEY);
      if (!raw) return Logic.createDefaultState();
      return Logic.normalizeState(JSON.parse(raw));
    } catch (e) {
      return Logic.createDefaultState();
    }
  }

  /** 保存存档并刷新全局徽章与角标 */
  function saveState() {
    const { newlyUnlocked } = Logic.evaluateStatsAndBadges(state, Data);
    try {
      localStorage.setItem(Logic.STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
    updateGlobalHeaderAndBadges();
    if (newlyUnlocked.length > 0) {
      showToast(`🏅 解锁新勋章：${newlyUnlocked[0].name}！`);
    }
  }

  let state = loadState();
  sound.configure(state.settings);

  // 当前 UI 运行态
  let currentView = 'map'; // 'map' | 'arcade' | 'review' | 'profile'
  let arcadeMode = 'bubble'; // 'bubble' | 'memory' | 'tile' | 'rush'
  let arcadeUnitScope = 'all'; // 'all' | unitId
  let reviewSubjectFilter = 'all';

  // 小游戏运行态
  let bubbleRound = null;
  let bubbleCombo = 0;
  let bubbleLocked = false;

  let memoryDeck = [];
  let memoryFlipped = [];
  let memoryMatchedIds = new Set();
  let memoryMoves = 0;
  let memoryBusy = false;

  let tileRound = null;
  let tileChosen = [];
  let tileStreak = 0;
  let tileLocked = false;

  let rushTimerId = null;
  let rushSecondsLeft = 60;
  let rushScore = 0;
  let rushCorrect = 0;
  let rushCombo = 0;
  let rushCurrentItem = null;

  // 单元闯关 / 艾宾浩斯复习通用舞台状态
  let activeQuest = null; // { mode: 'unit'|'review', unitId, title, steps: [], idx: 0, correctCount: 0, tileChosen: [], answered: false }
  let activeFlashcardUnitId = null;
  let resetConfirmPending = false;
  let resetConfirmTimer = null;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);

  /** HTML 转义防注入 */
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 轻提示 */
  function showToast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, 2400);
  }

  /** 通关彩色纸屑庆祝动效 */
  function launchConfetti() {
    const layer = $('confetti-layer');
    if (!layer) return;
    const colors = ['#FF7A45', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];
    for (let i = 0; i < 28; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${(Math.random() * 0.35).toFixed(2)}s`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 1950);
    }
  }

  /** 更新顶部智慧星与底部错题本待复习角标 */
  function updateGlobalHeaderAndBadges() {
    $('stat-stars').textContent = state.totalStars || 0;
    const dueList = Logic.getMistakeRecords(state, Data.getItemById, { onlyDue: true });
    const badge = $('nav-due-badge');
    if (dueList.length > 0) {
      badge.textContent = dueList.length > 99 ? '99+' : String(dueList.length);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  /** 渲染顶部年级、学期、学科选择器 */
  function renderBookSelector() {
    // 1. 年级
    $('grade-tabs').innerHTML = Data.GRADES.map(
      (g) =>
        `<button type="button" class="grade-chip ${state.grade === g.id ? 'active' : ''}" data-grade="${g.id}">${g.emoji} ${g.name}</button>`
    ).join('');

    // 2. 学期
    $('semester-tabs').innerHTML = Data.SEMESTERS.map(
      (s) =>
        `<button type="button" class="sem-btn ${state.semester === s.id ? 'active' : ''}" data-sem="${s.id}">${s.name}</button>`
    ).join('');

    // 3. 四大学科
    $('subject-tabs').innerHTML = Data.SUBJECTS.map(
      (sub) => `
        <button type="button" class="subject-card ${state.subject === sub.id ? 'active' : ''}" data-subject="${sub.id}">
          <span class="sub-icon">${sub.icon}</span>
          <span class="sub-name">${sub.name}</span>
        </button>`
    ).join('');
  }

  /** 切换主视图 */
  function switchView(viewName) {
    if (viewName !== 'arcade') {
      stopRushTimer();
    }
    currentView = viewName;

    document.querySelectorAll('.view').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `view-${viewName}`);
    });
    document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // 闯关岛和游乐场显示选书栏，错题本和成长册收起选书栏
    const selector = $('book-selector-bar');
    selector.classList.toggle('hidden', viewName === 'review' || viewName === 'profile');

    if (viewName === 'map') renderMapView();
    if (viewName === 'arcade') renderArcadeView();
    if (viewName === 'review') renderReviewView();
    if (viewName === 'profile') renderProfileView();
  }

  // ==================== 视图 1：课本单元闯关岛 ====================
  function renderMapView() {
    const units = Data.getUnitsByFilter({
      grade: state.grade,
      semester: state.semester,
      subject: state.subject
    });
    const subMeta = Data.getSubjectMeta(state.subject);
    const bookTitle = Data.formatBookTitle(state.grade, state.semester, state.subject);

    let earnedStars = 0;
    const maxStars = units.length * 3;
    for (const u of units) {
      earnedStars += state.unitProgress[u.id]?.stars || 0;
    }
    const pct = maxStars > 0 ? Math.round((earnedStars / maxStars) * 100) : 0;

    const banner = $('current-book-banner');
    banner.dataset.subject = state.subject;
    banner.innerHTML = `
      <div class="banner-top">
        <div>
          <h2 class="banner-title">${subMeta.icon} ${esc(bookTitle)}</h2>
          <p class="banner-desc">${esc(subMeta.desc)}</p>
        </div>
        <span class="banner-star-pill">⭐ ${earnedStars} / ${maxStars}</span>
      </div>
      <div class="banner-progress-track">
        <div class="banner-progress-fill" style="width: ${pct}%"></div>
      </div>
    `;

    $('unit-list').innerHTML = units
      .map((u) => {
        const prog = state.unitProgress[u.id];
        const stars = prog ? prog.stars || 0 : 0;
        const starIcons = [1, 2, 3].map((n) => (n <= stars ? '⭐' : '☆')).join('');
        const previews = u.items
          .slice(0, 4)
          .map((it) => `<span class="preview-chip">${esc(it.front)}</span>`)
          .join('');

        return `
          <article class="unit-card ${stars > 0 ? 'cleared' : ''}">
            <div class="unit-head">
              <div class="unit-icon-box">${u.icon}</div>
              <div class="unit-info">
                <div class="unit-tag-row">
                  <span class="unit-book-tag">${esc(u.bookTag)}</span>
                  <span class="unit-stars" aria-label="已得${stars}星">${starIcons}</span>
                </div>
                <h3 class="unit-title">${esc(u.title)}</h3>
              </div>
            </div>
            <div class="unit-preview-chips">${previews}</div>
            <div class="unit-actions">
              <button type="button" class="ghost-btn" data-action="flashcards" data-unit="${u.id}">📘 速记闪卡</button>
              <button type="button" class="primary-btn" data-action="quest" data-unit="${u.id}">
                ⚔️ ${stars > 0 ? '再战摘三星' : '开始闯关'}
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  /** 打开单元速记闪卡弹窗 */
  function openFlashcardsModal(unitId) {
    const unit = Data.getUnitById(unitId);
    if (!unit) return;
    activeFlashcardUnitId = unitId;
    $('flashcard-modal-title').textContent = `${unit.icon} ${unit.title}`;

    $('flashcard-list').innerHTML = unit.items
      .map((it, idx) => {
        const hasVoice = Boolean(it.speakEn || it.speakZh);
        return `
          <div class="flash-item">
            <div class="flash-row-top">
              <div>
                <div class="flash-front">${idx + 1}. ${esc(it.front)} ${it.phonetic ? `<small>${esc(it.phonetic)}</small>` : ''}</div>
                <div class="flash-back">👉 ${esc(it.back)}</div>
              </div>
              ${
                hasVoice
                  ? `<button type="button" class="sound-pill-btn ghost" data-speak-item="${it.id}">🔊 朗读</button>`
                  : ''
              }
            </div>
            ${it.hint ? `<div class="flash-hint">💡 课本助记：${esc(it.hint)}</div>` : ''}
          </div>
        `;
      })
      .join('');

    // 预加载英语音频
    unit.items.forEach((it) => {
      if (it.speakEn) sound.preloadEn(it.speakEn);
    });

    $('modal-flashcards').classList.remove('hidden');
  }

  // ==================== 单元综合闯关 & 艾宾浩斯错题特训舞台 ====================
  function startUnitQuest(unitId) {
    const unit = Data.getUnitById(unitId);
    if (!unit) return;
    const bookPool = Data.getItemsByScope({
      grade: unit.grade,
      semester: unit.semester,
      subject: unit.subject
    });
    const steps = Logic.buildUnitQuest(unit, bookPool);
    activeQuest = {
      mode: 'unit',
      unitId,
      title: `${unit.icon} ${unit.title}`,
      steps,
      idx: 0,
      correctCount: 0,
      tileChosen: [],
      answered: false
    };
    openQuestModal();
  }

  function startMistakeReviewQuest(onlyDue) {
    const records = Logic.getMistakeRecords(state, Data.getItemById, {
      onlyDue,
      subject: reviewSubjectFilter
    });

    if (records.length === 0) {
      showToast(onlyDue ? '🎉 太棒啦！当前没有到期待复习的错题！' : '🎉 错题本空空如也，去闯关岛挑战新单元吧！');
      return;
    }

    const batch = records.slice(0, 8);
    const steps = batch.map((rec, idx) => {
      const item = rec.item;
      const subjectPool = Data.getItemsByScope({
        grade: item.grade,
        semester: item.semester,
        subject: item.subject
      });
      const cleanLen = Logic.extractCleanFillTarget(item).length;
      const useTile = idx % 2 === 1 && cleanLen >= 2 && cleanLen <= 10;
      if (useTile) {
        return {
          stepIndex: idx,
          mode: 'tile',
          item,
          puzzle: Logic.generateTilePuzzle(item, { distractorCount: 3 })
        };
      }
      return {
        stepIndex: idx,
        mode: 'choice',
        item,
        options: Logic.buildChoiceOptions(item, subjectPool, 4)
      };
    });

    activeQuest = {
      mode: 'review',
      unitId: null,
      title: onlyDue ? '🎯 艾宾浩斯智能复习' : '💪 错题本强化特训',
      steps,
      idx: 0,
      correctCount: 0,
      tileChosen: [],
      answered: false
    };
    openQuestModal();
  }

  function openQuestModal() {
    $('modal-flashcards').classList.add('hidden');
    $('modal-quest').classList.remove('hidden');
    $('quest-summary').classList.add('hidden');
    $('quest-body').classList.remove('hidden');
    renderQuestStep();
  }

  function renderQuestStep() {
    if (!activeQuest) return;
    const { steps, idx, title } = activeQuest;
    const step = steps[idx];
    if (!step) return;

    activeQuest.tileChosen = [];
    activeQuest.answered = false;

    $('quest-title').textContent = title;
    $('quest-step-text').textContent = `${idx + 1} / ${steps.length}`;
    $('quest-progress-fill').style.width = `${Math.round(((idx + 1) / steps.length) * 100)}%`;

    const item = step.item;
    const hasAudio = Boolean(item.speakEn || item.speakZh);
    const letters = ['A', 'B', 'C', 'D'];

    let interactionHtml = '';
    if (step.mode === 'choice') {
      interactionHtml = `
        <div class="choice-list" id="quest-choices">
          ${step.options
            .map(
              (opt, i) => `
              <button type="button" class="choice-btn" data-q-choice="${i}">
                <span class="choice-letter">${letters[i] || i + 1}</span>
                <span>${esc(opt.text)}</span>
              </button>`
            )
            .join('')}
        </div>
      `;
    } else {
      interactionHtml = `
        <p class="stage-sub-guide">点选下方魔法字块拼出正确答案（点上方槽位可退回）：</p>
        <div class="tile-slots" id="quest-tile-slots"></div>
        <div class="tile-bank" id="quest-tile-bank"></div>
      `;
    }

    $('quest-body').innerHTML = `
      <div class="prompt-panel">
        <span class="unit-book-tag">${esc(item.bookTag)}</span>
        <p class="stage-prompt-text" style="margin-top:6px;">${esc(step.mode === 'tile' ? item.fillPrompt : item.prompt)}</p>
        ${
          hasAudio
            ? `<div class="audio-inline-row">
                <button type="button" class="sound-pill-btn" data-speak-item="${item.id}">🔊 点我听发音</button>
              </div>`
            : ''
        }
      </div>
      ${interactionHtml}
      <div id="quest-feedback" class="feedback-box hidden"></div>
      <button id="btn-quest-next" type="button" class="primary-btn full-btn hidden">
        ${idx + 1 < steps.length ? '下一题 ➡️' : '查看闯关成绩 🏆'}
      </button>
    `;

    if (step.mode === 'tile') {
      refreshQuestTileUI();
    }

    if (item.speakEn && state.settings.autoSpeak) {
      sound.speakEn(item.speakEn);
    }
  }

  function refreshQuestTileUI() {
    if (!activeQuest) return;
    const step = activeQuest.steps[activeQuest.idx];
    if (!step || step.mode !== 'tile') return;
    const puzzle = step.puzzle;
    const chosen = activeQuest.tileChosen;
    const usedSet = new Set(chosen.map((c) => c.tileId));

    $('quest-tile-slots').innerHTML = puzzle.segments
      .map((_, sIdx) => {
        const picked = chosen[sIdx];
        return `<button type="button" class="slot-box ${picked ? 'filled' : ''}" data-q-slot="${sIdx}">${
          picked ? esc(picked.text) : ''
        }</button>`;
      })
      .join('');

    $('quest-tile-bank').innerHTML = puzzle.tiles
      .map(
        (t) =>
          `<button type="button" class="magic-tile ${usedSet.has(t.tileId) ? 'used' : ''}" data-q-tile="${t.tileId}">${esc(
            t.text
          )}</button>`
      )
      .join('');
  }

  function settleQuestStep(isCorrect) {
    if (!activeQuest || activeQuest.answered) return;
    activeQuest.answered = true;
    const step = activeQuest.steps[activeQuest.idx];
    const item = step.item;

    if (isCorrect) {
      activeQuest.correctCount++;
      sound.playCorrect(activeQuest.correctCount);
    } else {
      sound.playWrong();
    }

    const ebRes = Logic.recordAnswerOutcome(state, item.id, isCorrect, {
      isReviewMode: activeQuest.mode === 'review'
    });
    saveState();

    const fb = $('quest-feedback');
    fb.className = `feedback-box ${isCorrect ? 'ok' : 'err'}`;
    let extraNote = '';
    if (activeQuest.mode === 'review' && isCorrect) {
      extraNote =
        ebRes.ebbinghausAction === 'graduated'
          ? '<br>🎓 <strong>恭喜！该考点已完成全部艾宾浩斯记忆周期，荣升“已彻底攻克”！</strong>'
          : `<br>📈 艾宾浩斯阶段升级：<strong>${esc(ebRes.stageLabel)}</strong>`;
    } else if (!isCorrect) {
      extraNote = '<br>📒 已自动加入<strong>艾宾浩斯错题本</strong>，稍后为您智能安排强化复习！';
    }

    fb.innerHTML = `
      <strong>${isCorrect ? '✅ 回答正确！太棒啦！' : `❌ 差一点点！正确答案是：「${esc(item.answer)}」`}</strong>
      ${item.hint ? `<br>💡 ${esc(item.hint)}` : ''}
      ${extraNote}
    `;
    fb.classList.remove('hidden');
    $('btn-quest-next').classList.remove('hidden');
  }

  function finishQuestModal() {
    if (!activeQuest) return;
    $('quest-body').classList.add('hidden');
    const summary = $('quest-summary');
    summary.classList.remove('hidden');

    const total = activeQuest.steps.length;
    const right = activeQuest.correctCount;

    if (activeQuest.mode === 'unit') {
      const res = Logic.completeUnitQuest(state, activeQuest.unitId, right, total);
      saveState();
      const starsStr = [1, 2, 3].map((n) => (n <= res.stars ? '⭐' : '☆')).join('');
      if (res.stars >= 2) {
        sound.playVictory();
        launchConfetti();
      }
      summary.innerHTML = `
        <div class="big-stars-row">${starsStr}</div>
        <h3>${res.stars === 3 ? '完美三星通关！课本小状元！' : res.stars >= 1 ? '恭喜闯关成功！' : '加油！再复习一下就能摘星啦！'}</h3>
        <p>本关答对 <strong>${right} / ${total}</strong> 题，奖励 <strong>+${res.starsReward} 颗智慧星</strong>！</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;">
          <button type="button" class="ghost-btn" id="btn-quest-retry">🔄 再闯一次</button>
          <button type="button" class="primary-btn" id="btn-quest-done">🏝️ 返回闯关岛</button>
        </div>
      `;
      renderMapView();
    } else {
      const bonus = Math.max(2, right * 2);
      state.totalStars = (state.totalStars || 0) + bonus;
      saveState();
      sound.playVictory();
      launchConfetti();
      summary.innerHTML = `
        <div class="big-stars-row">🧠✨</div>
        <h3>艾宾浩斯记忆特训完成！</h3>
        <p>本次成功巩固 <strong>${right} / ${total}</strong> 个薄弱知识点，奖励 <strong>+${bonus} 颗智慧星</strong>！</p>
        <div style="margin-top:16px;">
          <button type="button" class="primary-btn full-btn" id="btn-quest-done">📒 返回错题本</button>
        </div>
      `;
      renderReviewView();
    }
  }

  // ==================== 视图 2：趣味游乐场（4 大游戏） ====================
  function getArcadeItemsPool() {
    const bookItems = Data.getItemsByScope({
      grade: state.grade,
      semester: state.semester,
      subject: state.subject
    });
    if (arcadeUnitScope !== 'all') {
      const unitItems = Data.getItemsByScope({ unitId: arcadeUnitScope });
      if (unitItems.length > 0) {
        return { primary: unitItems, bookPool: bookItems };
      }
    }
    return { primary: bookItems, bookPool: bookItems };
  }

  function renderArcadeView() {
    const units = Data.getUnitsByFilter({
      grade: state.grade,
      semester: state.semester,
      subject: state.subject
    });

    // 若之前选中的单元不在当前册本中，自动重置为本册全部
    if (arcadeUnitScope !== 'all' && !units.some((u) => u.id === arcadeUnitScope)) {
      arcadeUnitScope = 'all';
    }

    $('arcade-unit-scope').innerHTML = [
      `<button type="button" class="scope-chip ${arcadeUnitScope === 'all' ? 'active' : ''}" data-scope="all">本册全部 (${units.length * 6}题)</button>`,
      ...units.map(
        (u) =>
          `<button type="button" class="scope-chip ${arcadeUnitScope === u.id ? 'active' : ''}" data-scope="${u.id}">${u.icon} 第${u.unitNo}关</button>`
      )
    ].join('');

    document.querySelectorAll('.arcade-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === arcadeMode);
    });
    document.querySelectorAll('.arcade-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `arcade-${arcadeMode}`);
    });

    if (arcadeMode === 'bubble') startNextBubbleQuestion();
    if (arcadeMode === 'memory') startMemoryGame();
    if (arcadeMode === 'tile') startNextTilePuzzle();
    if (arcadeMode === 'rush') resetRushIntro();
  }

  // ---- 小游戏 1：打泡泡 ----
  function startNextBubbleQuestion() {
    const { primary } = getArcadeItemsPool();
    bubbleRound = Logic.generateBubbleQuestion(primary, {
      bubbleCount: 5,
      excludeId: bubbleRound?.target?.id || ''
    });
    bubbleLocked = false;
    if (!bubbleRound) return;

    const item = bubbleRound.target;
    $('bubble-book-tag').textContent = item.bookTag;
    $('bubble-combo').textContent = String(bubbleCombo);
    $('bubble-prompt').textContent = item.prompt;
    $('bubble-feedback').classList.add('hidden');
    $('btn-bubble-next').classList.add('hidden');

    const hasAudio = Boolean(item.speakEn || item.speakZh);
    $('bubble-audio-row').classList.toggle('hidden', !hasAudio);

    $('bubble-stage').innerHTML = bubbleRound.bubbles
      .map(
        (b, idx) => `
          <button type="button" class="magic-bubble" data-bubble-idx="${idx}" data-theme="${b.colorTheme}" style="animation-delay:${b.floatDelay}s">
            ${esc(b.text)}
          </button>`
      )
      .join('');

    if (item.speakEn && state.settings.autoSpeak) {
      sound.speakEn(item.speakEn);
    }
  }

  function handleBubbleClick(idx, btnEl) {
    if (!bubbleRound || bubbleLocked) return;
    const chosen = bubbleRound.bubbles[idx];
    if (!chosen) return;
    bubbleLocked = true;
    sound.playPop();

    const item = bubbleRound.target;
    const isCorrect = chosen.isCorrect;

    if (isCorrect) {
      bubbleCombo++;
      state.totalStars = (state.totalStars || 0) + (bubbleCombo >= 3 ? 2 : 1);
      btnEl.classList.add('popped-right');
      sound.playCorrect(bubbleCombo);
    } else {
      bubbleCombo = 0;
      btnEl.classList.add('popped-wrong');
      sound.playWrong();
      // 高亮正确泡泡
      document.querySelectorAll('#bubble-stage .magic-bubble').forEach((el) => {
        const b = bubbleRound.bubbles[Number(el.dataset.bubbleIdx)];
        if (b && b.isCorrect) el.classList.add('popped-right');
      });
    }

    Logic.recordAnswerOutcome(state, item.id, isCorrect);
    saveState();

    $('bubble-combo').textContent = String(bubbleCombo);
    const fb = $('bubble-feedback');
    fb.className = `feedback-box ${isCorrect ? 'ok' : 'err'}`;
    fb.innerHTML = `
      <strong>${isCorrect ? '🫧 戳中啦！记忆超准！' : `💡 正确答案是：「${esc(item.answer)}」`}</strong>
      ${item.hint ? `<br>${esc(item.hint)}` : ''}
      ${!isCorrect ? '<br>📒 已收入错题本，随时巩固！' : ''}
    `;
    fb.classList.remove('hidden');
    $('btn-bubble-next').classList.remove('hidden');
  }

  // ---- 小游戏 2：翻牌消消乐 ----
  function startMemoryGame() {
    const { primary, bookPool } = getArcadeItemsPool();
    memoryDeck = Logic.generateMemoryDeck(primary, {
      pairCount: 6,
      supplementPool: bookPool
    });
    memoryFlipped = [];
    memoryMatchedIds = new Set();
    memoryMoves = 0;
    memoryBusy = false;

    $('memory-victory').classList.add('hidden');
    renderMemoryBoard();
  }

  function renderMemoryBoard() {
    const totalPairs = Math.floor(memoryDeck.length / 2);
    $('memory-moves').textContent = String(memoryMoves);
    $('memory-pairs').textContent = `${memoryMatchedIds.size}/${totalPairs}`;

    $('memory-board').innerHTML = memoryDeck
      .map((card, idx) => {
        const isMatched = memoryMatchedIds.has(card.pairId);
        const isFlipped = isMatched || memoryFlipped.includes(idx);
        return `
          <button type="button" class="mem-card ${isFlipped ? 'flipped' : ''} ${isMatched ? 'matched' : ''}" data-mem-idx="${idx}">
            ${
              isFlipped
                ? `<span class="mem-tag">${esc(card.subTag)}</span><span class="mem-text">${esc(card.text)}</span>`
                : `<span class="mem-back-icon">❓</span>`
            }
          </button>
        `;
      })
      .join('');
  }

  function handleMemoryCardClick(idx) {
    if (memoryBusy) return;
    const card = memoryDeck[idx];
    if (!card || memoryMatchedIds.has(card.pairId) || memoryFlipped.includes(idx)) return;

    sound.playFlip();
    if (card.item.speakEn && card.side === 'front') {
      sound.speakEn(card.item.speakEn);
    }

    memoryFlipped.push(idx);
    renderMemoryBoard();

    if (memoryFlipped.length === 2) {
      memoryMoves++;
      memoryBusy = true;
      const [i1, i2] = memoryFlipped;
      const c1 = memoryDeck[i1];
      const c2 = memoryDeck[i2];

      if (c1.pairId === c2.pairId) {
        memoryMatchedIds.add(c1.pairId);
        memoryFlipped = [];
        memoryBusy = false;
        sound.playCorrect(memoryMatchedIds.size);
        renderMemoryBoard();

        const totalPairs = Math.floor(memoryDeck.length / 2);
        if (memoryMatchedIds.size >= totalPairs) {
          const starsEarned = memoryMoves <= totalPairs + 3 ? 5 : 3;
          state.totalStars = (state.totalStars || 0) + starsEarned;
          saveState();
          sound.playVictory();
          launchConfetti();
          $('memory-victory-desc').textContent = `共翻牌 ${memoryMoves} 步完成全部配对，奖励 +${starsEarned} 颗智慧星！`;
          $('memory-victory').classList.remove('hidden');
        }
      } else {
        setTimeout(() => {
          memoryFlipped = [];
          memoryBusy = false;
          renderMemoryBoard();
        }, 780);
      }
    }
  }

  // ---- 小游戏 3：古诗接龙与拼词填字 ----
  function startNextTilePuzzle() {
    const { primary } = getArcadeItemsPool();
    const candidates = primary.filter((it) => it.id !== tileRound?.item?.id);
    const pool = candidates.length > 0 ? candidates : primary;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (!picked) return;

    tileRound = Logic.generateTilePuzzle(picked, { distractorCount: 3 });
    tileChosen = [];
    tileLocked = false;

    const typeNames = {
      poem: '📜 古诗名句接龙',
      word: '🔤 课本单词拼写',
      char: '✍️ 字词国学拼装',
      math: '🧮 公式算式拼装',
      fact: '🔬 核心考点填空'
    };
    $('tile-type-tag').textContent = typeNames[picked.type] || '接龙拼词';
    $('tile-streak').textContent = String(tileStreak);
    $('tile-prompt').textContent = picked.fillPrompt;
    $('tile-audio-row').classList.toggle('hidden', !Boolean(picked.speakEn || picked.speakZh));
    $('tile-feedback').classList.add('hidden');
    $('btn-tile-next').classList.add('hidden');

    renderArcadeTileStage();

    if (picked.speakEn && state.settings.autoSpeak) {
      sound.speakEn(picked.speakEn);
    }
  }

  function renderArcadeTileStage() {
    if (!tileRound) return;
    const usedIds = new Set(tileChosen.map((t) => t.tileId));

    $('tile-slots').innerHTML = tileRound.segments
      .map((_, sIdx) => {
        const picked = tileChosen[sIdx];
        return `<button type="button" class="slot-box ${picked ? 'filled' : ''}" data-a-slot="${sIdx}">${
          picked ? esc(picked.text) : ''
        }</button>`;
      })
      .join('');

    $('tile-bank').innerHTML = tileRound.tiles
      .map(
        (t) =>
          `<button type="button" class="magic-tile ${usedIds.has(t.tileId) ? 'used' : ''}" data-a-tile="${t.tileId}">${esc(
            t.text
          )}</button>`
      )
      .join('');
  }

  function evaluateArcadeTileIfFull() {
    if (!tileRound || tileLocked) return;
    if (tileChosen.length < tileRound.segments.length) return;

    tileLocked = true;
    const res = Logic.checkTileAttempt(tileRound, tileChosen);
    const item = tileRound.item;

    if (res.isCorrect) {
      tileStreak++;
      state.totalStars = (state.totalStars || 0) + 2;
      sound.playCorrect(tileStreak);
    } else {
      tileStreak = 0;
      sound.playWrong();
    }

    Logic.recordAnswerOutcome(state, item.id, res.isCorrect);
    saveState();

    $('tile-streak').textContent = String(tileStreak);
    const fb = $('tile-feedback');
    fb.className = `feedback-box ${res.isCorrect ? 'ok' : 'err'}`;
    fb.innerHTML = `
      <strong>${res.isCorrect ? '🎉 拼装完全正确！奖励 +2 星！' : `❌ 顺序不对哦，正确写法是：「${esc(tileRound.cleanTarget)}」`}</strong>
      ${item.hint ? `<br>💡 ${esc(item.hint)}` : ''}
    `;
    fb.classList.remove('hidden');
    $('btn-tile-next').classList.remove('hidden');
  }

  // ---- 小游戏 4：60秒限时闪电挑战 ----
  function stopRushTimer() {
    if (rushTimerId) {
      clearInterval(rushTimerId);
      rushTimerId = null;
    }
  }

  function resetRushIntro() {
    stopRushTimer();
    $('rush-best-score').textContent = String(state.bestRushScore || 0);
    $('rush-intro').classList.remove('hidden');
    $('rush-playing').classList.add('hidden');
    $('rush-result').classList.add('hidden');
  }

  function startRushGame() {
    stopRushTimer();
    rushSecondsLeft = 60;
    rushScore = 0;
    rushCorrect = 0;
    rushCombo = 0;

    $('rush-intro').classList.add('hidden');
    $('rush-result').classList.add('hidden');
    $('rush-playing').classList.remove('hidden');

    updateRushHud();
    nextRushQuestion();

    rushTimerId = setInterval(() => {
      rushSecondsLeft--;
      updateRushHud();
      if (rushSecondsLeft <= 0) {
        finishRushGame();
      }
    }, 1000);
  }

  function updateRushHud() {
    $('rush-timer').textContent = String(Math.max(0, rushSecondsLeft));
    $('rush-score').textContent = String(rushScore);
    $('rush-combo').textContent = String(rushCombo);
    $('rush-bar-fill').style.width = `${Math.max(0, (rushSecondsLeft / 60) * 100)}%`;
  }

  function nextRushQuestion() {
    const { primary, bookPool } = getArcadeItemsPool();
    const candidates = primary.filter((x) => x.id !== rushCurrentItem?.id);
    const list = candidates.length > 0 ? candidates : primary;
    const item = list[Math.floor(Math.random() * list.length)];
    if (!item) return;

    rushCurrentItem = item;
    const opts = Logic.buildChoiceOptions(item, bookPool, 4);
    const letters = ['A', 'B', 'C', 'D'];

    $('rush-prompt').textContent = item.prompt;
    $('rush-options').innerHTML = opts
      .map(
        (opt, idx) => `
          <button type="button" class="choice-btn" data-rush-correct="${opt.isCorrect ? '1' : '0'}">
            <span class="choice-letter">${letters[idx]}</span>
            <span>${esc(opt.text)}</span>
          </button>`
      )
      .join('');

    if (item.speakEn && state.settings.autoSpeak) {
      sound.speakEn(item.speakEn);
    }
  }

  function finishRushGame() {
    stopRushTimer();
    $('rush-playing').classList.add('hidden');
    $('rush-result').classList.remove('hidden');

    const res = Logic.completeRushRound(state, rushScore, rushCorrect);
    saveState();
    sound.playVictory();
    if (rushCorrect >= 8) launchConfetti();

    $('rush-final-score').textContent = String(rushScore);
    $('rush-final-correct').textContent = String(rushCorrect);
    $('rush-final-desc').textContent = `${
      res.isNewBest ? '🎊 刷新本机最高纪录！' : ''
    }奖励 +${res.starsReward} 颗智慧星！（答错题目已自动归入错题本）`;
  }

  // ==================== 视图 3：艾宾浩斯错题本 ====================
  function renderReviewView() {
    const allMistakes = Logic.getMistakeRecords(state, Data.getItemById, { onlyDue: false });
    const dueMistakes = allMistakes.filter((r) => r.isDue);

    $('review-due-count').textContent = String(dueMistakes.length);
    $('review-total-count').textContent = String(allMistakes.length);
    $('review-mastered-count').textContent = String((state.masteredIds || []).length);

    const filters = [{ id: 'all', name: '全部学科' }, ...Data.SUBJECTS];
    $('review-subject-filter').innerHTML = filters
      .map(
        (f) =>
          `<button type="button" class="scope-chip ${reviewSubjectFilter === f.id ? 'active' : ''}" data-rev-sub="${f.id}">${esc(
            f.name
          )}</button>`
      )
      .join('');

    const filtered = Logic.getMistakeRecords(state, Data.getItemById, {
      onlyDue: false,
      subject: reviewSubjectFilter
    });

    if (filtered.length === 0) {
      $('mistake-list').innerHTML = `
        <div class="empty-state">
          <div class="empty-emoji">🌟</div>
          <h3>当前筛选下没有待巩固错题</h3>
          <p>去「闯关岛」或「游乐场」挑战课本知识点，答错的题目会自动进入这里按艾宾浩斯曲线帮你牢牢记住！</p>
        </div>
      `;
      return;
    }

    $('mistake-list').innerHTML = filtered
      .map((rec) => {
        const it = rec.item;
        const countdown = Logic.formatNextReviewCountdown(rec.nextReviewAt);
        const hasAudio = Boolean(it.speakEn || it.speakZh);
        return `
          <article class="mistake-card">
            <div class="mistake-top">
              <span class="unit-book-tag">${esc(it.bookTag)}</span>
              <span class="mistake-stage-badge ${rec.isDue ? 'due' : ''}">${esc(rec.stageLabel)} · ${esc(countdown)}</span>
            </div>
            <p class="mistake-prompt">${esc(it.prompt)}</p>
            <div class="mistake-ans">✅ 正确答案：${esc(it.answer)}</div>
            ${it.hint ? `<div class="mistake-hint">💡 ${esc(it.hint)}</div>` : ''}
            <div class="mistake-foot">
              <span class="mistake-meta">答错 ${rec.wrongCount} 次 · 连续复习对 ${rec.streak || 0} 次</span>
              <div class="mistake-btns">
                ${
                  hasAudio
                    ? `<button type="button" class="mini-action-btn" data-speak-item="${it.id}">🔊 朗读</button>`
                    : ''
                }
                <button type="button" class="mini-action-btn" data-master-id="${it.id}">✔️ 已熟记</button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // ==================== 视图 4：成长册 ====================
  function renderProfileView() {
    const { stats } = Logic.evaluateStatsAndBadges(state, Data);
    const accuracy =
      state.totalAnswered > 0 ? `${Math.round((state.totalCorrect / state.totalAnswered) * 100)}%` : '100%';

    // 根据通关数授予头衔
    let rankTitle = '萌芽小学童';
    let rankEmoji = '🌱';
    if (stats.clearedUnits >= 36) {
      rankTitle = '金榜小状元';
      rankEmoji = '👑';
    } else if (stats.clearedUnits >= 18) {
      rankTitle = '博学领航员';
      rankEmoji = '🚀';
    } else if (stats.clearedUnits >= 8) {
      rankTitle = '课本探索家';
      rankEmoji = '🔭';
    } else if (stats.clearedUnits >= 3) {
      rankTitle = '勤学小骑士';
      rankEmoji = '⛵';
    }

    $('profile-avatar').textContent = rankEmoji;
    $('profile-rank-badge').textContent = rankTitle;
    $('profile-stars').textContent = String(stats.totalStars);
    $('profile-cleared-units').textContent = `${stats.clearedUnits}/${stats.totalUnits}`;
    $('profile-perfect-units').textContent = String(stats.perfectUnits);
    $('profile-books-done').textContent = `${stats.booksCompleted}/48`;
    $('profile-accuracy').textContent = accuracy;
    $('profile-reviewed').textContent = String(stats.totalReviewed);

    $('badges-grid').innerHTML = Data.BADGES.map((b) => {
      const unlocked = state.unlockedBadges.includes(b.id);
      return `
        <div class="badge-card ${unlocked ? 'unlocked' : ''}">
          <span class="badge-icon">${b.icon}</span>
          <div class="badge-info">
            <h4>${esc(b.name)}</h4>
            <p>${esc(b.desc)}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  // ==================== 设置弹窗 ====================
  function syncSettingsModalUI() {
    document.querySelectorAll('#setting-accent .seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.accent === state.settings.accent);
    });
    document.querySelectorAll('#setting-rate .seg-btn').forEach((btn) => {
      btn.classList.toggle('active', Math.abs(Number(btn.dataset.rate) - state.settings.rate) < 0.03);
    });

    const autoBtn = $('setting-autospeak-toggle');
    autoBtn.classList.toggle('on', state.settings.autoSpeak);
    autoBtn.textContent = state.settings.autoSpeak ? '开启' : '关闭';

    const sfxBtn = $('setting-sfx-toggle');
    sfxBtn.classList.toggle('on', state.settings.sfxEnabled);
    sfxBtn.textContent = state.settings.sfxEnabled ? '开启' : '关闭';
  }

  // ==================== 全局事件委托绑定 ====================
  function bindEvents() {
    // 底部导航切换
    document.querySelector('.bottom-nav').addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (!btn) return;
      sound.playClick();
      switchView(btn.dataset.view);
    });

    // 顶部星级与设置按钮
    $('btn-top-stars').addEventListener('click', () => {
      sound.playClick();
      switchView('profile');
    });

    $('btn-settings').addEventListener('click', () => {
      sound.playClick();
      syncSettingsModalUI();
      $('modal-settings').classList.remove('hidden');
    });

    // 选书器：年级、学期、学科
    $('book-selector-bar').addEventListener('click', (e) => {
      const gBtn = e.target.closest('[data-grade]');
      if (gBtn) {
        sound.playClick();
        state.grade = Number(gBtn.dataset.grade);
        arcadeUnitScope = 'all';
        saveState();
        renderBookSelector();
        switchView(currentView);
        return;
      }

      const sBtn = e.target.closest('[data-sem]');
      if (sBtn) {
        sound.playClick();
        state.semester = Number(sBtn.dataset.sem);
        arcadeUnitScope = 'all';
        saveState();
        renderBookSelector();
        switchView(currentView);
        return;
      }

      const subBtn = e.target.closest('[data-subject]');
      if (subBtn) {
        sound.playClick();
        state.subject = subBtn.dataset.subject;
        arcadeUnitScope = 'all';
        saveState();
        renderBookSelector();
        switchView(currentView);
      }
    });

    // 闯关岛卡片操作
    $('unit-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      sound.playClick();
      const unitId = btn.dataset.unit;
      if (btn.dataset.action === 'flashcards') openFlashcardsModal(unitId);
      if (btn.dataset.action === 'quest') startUnitQuest(unitId);
    });

    $('btn-flashcard-start-quest').addEventListener('click', () => {
      sound.playClick();
      if (activeFlashcardUnitId) startUnitQuest(activeFlashcardUnitId);
    });

    // 游乐场模式与单元筛选
    $('arcade-mode-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-mode]');
      if (!tab) return;
      sound.playClick();
      stopRushTimer();
      arcadeMode = tab.dataset.mode;
      renderArcadeView();
    });

    $('arcade-unit-scope').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-scope]');
      if (!chip) return;
      sound.playClick();
      stopRushTimer();
      arcadeUnitScope = chip.dataset.scope;
      renderArcadeView();
    });

    // 泡泡互动
    $('bubble-stage').addEventListener('click', (e) => {
      const b = e.target.closest('.magic-bubble');
      if (!b) return;
      handleBubbleClick(Number(b.dataset.bubbleIdx), b);
    });
    $('btn-bubble-next').addEventListener('click', () => {
      sound.playClick();
      startNextBubbleQuestion();
    });
    $('btn-bubble-speak').addEventListener('click', () => {
      if (bubbleRound?.target) sound.speakItem(bubbleRound.target);
    });
    $('btn-bubble-slow').addEventListener('click', () => {
      if (bubbleRound?.target) sound.speakItem(bubbleRound.target, { slow: true });
    });

    // 翻牌消消乐互动
    $('memory-board').addEventListener('click', (e) => {
      const c = e.target.closest('[data-mem-idx]');
      if (!c) return;
      handleMemoryCardClick(Number(c.dataset.memIdx));
    });
    $('btn-memory-restart').addEventListener('click', () => {
      sound.playClick();
      startMemoryGame();
    });
    $('btn-memory-again').addEventListener('click', () => {
      sound.playClick();
      startMemoryGame();
    });

    // 接龙拼词互动
    $('tile-bank').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-a-tile]');
      if (!btn || !tileRound || tileLocked) return;
      const tileObj = tileRound.tiles.find((t) => t.tileId === btn.dataset.aTile);
      if (!tileObj || tileChosen.some((c) => c.tileId === tileObj.tileId)) return;
      sound.playClick();
      tileChosen.push(tileObj);
      renderArcadeTileStage();
      evaluateArcadeTileIfFull();
    });

    $('tile-slots').addEventListener('click', (e) => {
      const slot = e.target.closest('[data-a-slot]');
      if (!slot || tileLocked) return;
      const idx = Number(slot.dataset.aSlot);
      if (idx >= 0 && idx < tileChosen.length) {
        sound.playClick();
        tileChosen.splice(idx, 1);
        renderArcadeTileStage();
      }
    });

    $('btn-tile-clear').addEventListener('click', () => {
      if (tileLocked) return;
      sound.playClick();
      tileChosen = [];
      renderArcadeTileStage();
    });

    $('btn-tile-hint').addEventListener('click', () => {
      if (!tileRound || tileLocked) return;
      const nextIdx = tileChosen.length;
      if (nextIdx >= tileRound.segments.length) return;
      const neededText = tileRound.segments[nextIdx];
      const matchTile = tileRound.tiles.find(
        (t) => !t.isNoise && t.text === neededText && !tileChosen.some((c) => c.tileId === t.tileId)
      );
      if (matchTile) {
        sound.playClick();
        tileChosen.push(matchTile);
        renderArcadeTileStage();
        evaluateArcadeTileIfFull();
      }
    });

    $('btn-tile-speak').addEventListener('click', () => {
      if (tileRound?.item) sound.speakItem(tileRound.item);
    });

    $('btn-tile-next').addEventListener('click', () => {
      sound.playClick();
      startNextTilePuzzle();
    });

    // 60秒闪电挑战互动
    $('btn-rush-start').addEventListener('click', () => {
      sound.playClick();
      startRushGame();
    });
    $('btn-rush-again').addEventListener('click', () => {
      sound.playClick();
      startRushGame();
    });
    $('rush-options').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rush-correct]');
      if (!btn || !rushCurrentItem) return;
      const isRight = btn.dataset.rushCorrect === '1';
      if (isRight) {
        rushCombo++;
        rushCorrect++;
        rushScore += 10 + Math.min(rushCombo, 6) * 2;
        sound.playCorrect(rushCombo);
      } else {
        rushCombo = 0;
        sound.playWrong();
      }
      Logic.recordAnswerOutcome(state, rushCurrentItem.id, isRight);
      saveState();
      updateRushHud();
      nextRushQuestion();
    });

    // 艾宾浩斯错题本互动
    $('btn-start-due-review').addEventListener('click', () => {
      sound.playClick();
      startMistakeReviewQuest(true);
    });
    $('btn-start-all-review').addEventListener('click', () => {
      sound.playClick();
      startMistakeReviewQuest(false);
    });
    $('review-subject-filter').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-rev-sub]');
      if (!chip) return;
      sound.playClick();
      reviewSubjectFilter = chip.dataset.revSub;
      renderReviewView();
    });
    $('mistake-list').addEventListener('click', (e) => {
      const masterBtn = e.target.closest('[data-master-id]');
      if (masterBtn) {
        sound.playClick();
        if (Logic.markMistakeMastered(state, masterBtn.dataset.masterId)) {
          saveState();
          renderReviewView();
          showToast('🎓 已标记为熟记掌握！');
        }
      }
    });

    // 单元闯关弹窗内部事件委托
    $('modal-quest').addEventListener('click', (e) => {
      if (e.target.closest('#btn-quest-close') || e.target.closest('#btn-quest-done')) {
        sound.playClick();
        $('modal-quest').classList.add('hidden');
        activeQuest = null;
        return;
      }

      if (e.target.closest('#btn-quest-retry')) {
        sound.playClick();
        if (activeQuest?.unitId) startUnitQuest(activeQuest.unitId);
        return;
      }

      if (e.target.closest('#btn-quest-next')) {
        sound.playClick();
        if (!activeQuest) return;
        activeQuest.idx++;
        if (activeQuest.idx >= activeQuest.steps.length) {
          finishQuestModal();
        } else {
          renderQuestStep();
        }
        return;
      }

      const choiceBtn = e.target.closest('[data-q-choice]');
      if (choiceBtn && activeQuest && !activeQuest.answered) {
        const step = activeQuest.steps[activeQuest.idx];
        const chosenIdx = Number(choiceBtn.dataset.qChoice);
        const pickedOpt = step.options[chosenIdx];
        if (!pickedOpt) return;

        document.querySelectorAll('#quest-choices .choice-btn').forEach((el, idx) => {
          const opt = step.options[idx];
          if (opt.isCorrect) el.classList.add('correct');
          else if (idx === chosenIdx) el.classList.add('wrong');
        });

        settleQuestStep(pickedOpt.isCorrect);
        return;
      }

      const qTile = e.target.closest('[data-q-tile]');
      if (qTile && activeQuest && !activeQuest.answered) {
        const step = activeQuest.steps[activeQuest.idx];
        const tileObj = step.puzzle.tiles.find((t) => t.tileId === qTile.dataset.qTile);
        if (!tileObj || activeQuest.tileChosen.some((c) => c.tileId === tileObj.tileId)) return;
        sound.playClick();
        activeQuest.tileChosen.push(tileObj);
        refreshQuestTileUI();
        if (activeQuest.tileChosen.length >= step.puzzle.segments.length) {
          const check = Logic.checkTileAttempt(step.puzzle, activeQuest.tileChosen);
          settleQuestStep(check.isCorrect);
        }
        return;
      }

      const qSlot = e.target.closest('[data-q-slot]');
      if (qSlot && activeQuest && !activeQuest.answered) {
        const sIdx = Number(qSlot.dataset.qSlot);
        if (sIdx >= 0 && sIdx < activeQuest.tileChosen.length) {
          sound.playClick();
          activeQuest.tileChosen.splice(sIdx, 1);
          refreshQuestTileUI();
        }
      }
    });

    // 全局朗读按钮与关闭模态框委托
    document.body.addEventListener('click', (e) => {
      const speakBtn = e.target.closest('[data-speak-item]');
      if (speakBtn) {
        const item = Data.getItemById(speakBtn.dataset.speakItem);
        if (item) sound.speakItem(item);
        return;
      }

      const closeTarget = e.target.closest('[data-close-modal]');
      if (closeTarget) {
        sound.playClick();
        const modalId = closeTarget.dataset.closeModal;
        $(modalId)?.classList.add('hidden');
      }
    });

    // 设置弹窗控制
    $('setting-accent').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-accent]');
      if (!btn) return;
      state.settings.accent = btn.dataset.accent;
      sound.configure(state.settings);
      saveState();
      syncSettingsModalUI();
      sound.speakEn('classroom');
    });

    $('setting-rate').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rate]');
      if (!btn) return;
      state.settings.rate = Number(btn.dataset.rate);
      sound.configure(state.settings);
      saveState();
      syncSettingsModalUI();
      sound.speakEn('apple');
    });

    $('setting-autospeak-toggle').addEventListener('click', () => {
      state.settings.autoSpeak = !state.settings.autoSpeak;
      sound.configure(state.settings);
      saveState();
      syncSettingsModalUI();
    });

    $('setting-sfx-toggle').addEventListener('click', () => {
      state.settings.sfxEnabled = !state.settings.sfxEnabled;
      sound.configure(state.settings);
      saveState();
      syncSettingsModalUI();
      if (state.settings.sfxEnabled) sound.playClick();
    });

    $('btn-test-voice').addEventListener('click', () => {
      sound.speakEn('classroom');
      showToast('🔊 正在播放真人英语示范音...');
    });

    // 二次点击安全清空进度（避免移动端 confirm 被拦截）
    $('btn-reset-progress').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (!resetConfirmPending) {
        resetConfirmPending = true;
        btn.textContent = '⚠️ 再点一次确认清空全部记录';
        if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
        resetConfirmTimer = setTimeout(() => {
          resetConfirmPending = false;
          btn.textContent = '清空本机闯关与错题记录';
        }, 3500);
        return;
      }
      resetConfirmPending = false;
      btn.textContent = '清空本机闯关与错题记录';
      state = Logic.createDefaultState();
      sound.configure(state.settings);
      saveState();
      renderBookSelector();
      switchView('map');
      $('modal-settings').classList.add('hidden');
      showToast('✨ 学习记录已重置');
    });
  }

  /** 启动初始化 */
  function init() {
    renderBookSelector();
    updateGlobalHeaderAndBadges();
    bindEvents();
    switchView('map');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
