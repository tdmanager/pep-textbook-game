/**
 * 二年级语文（上册 + 下册）· 趣味记课本 极简人性化交互控制器
 * - 顶部一键切换「📕 二年级上册」与「📘 二年级下册」
 * - 零复杂菜单：课本目录页 <-> 单元记忆乐园页
 */
(function () {
  'use strict';

  const Data = window.PEPTextbookData;
  const Logic = window.PEPGameLogic;
  const AudioMod = window.PEPAudio;

  if (!Data || !Logic || !AudioMod) return;

  const sound = new AudioMod.SoundEngine();
  const $ = (id) => document.getElementById(id);

  function loadState() {
    try {
      const raw = localStorage.getItem(Logic.STORAGE_KEY);
      if (!raw) return Logic.createDefaultState();
      return Logic.normalizeState(JSON.parse(raw));
    } catch (e) {
      return Logic.createDefaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(Logic.STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
    renderTopHeader();
  }

  let state = loadState();
  sound.setEnabled(state.soundOn);

  // 当前运行态
  let activeUnitId = 'u1'; // 具体单元 ID 或 'book_all'（本册随机玩）
  let activeMode = 'read'; // 'read' | 'bubble' | 'spell' | 'match'
  let maskAnswers = false;

  // 🫧 戳泡泡状态
  let bubbleQueue = [];
  let bubbleIdx = 0;
  let bubbleCorrectCount = 0;
  let bubbleLocked = false;
  let autoNextTimer = null;

  // ✍️ 拼名句状态
  let spellQueue = [];
  let spellIdx = 0;
  let spellChosen = [];
  let spellLocked = false;

  // 🃏 消消乐状态
  let matchDeck = [];
  let matchSelectedIdx = null;
  let matchClearedPairs = new Set();
  let matchBusy = false;

  let resetPending = false;
  let resetTimer = null;
  let toastTimer = null;

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clearAutoTimer() {
    if (autoNextTimer) {
      clearTimeout(autoNextTimer);
      autoNextTimer = null;
    }
  }

  function showToast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function launchConfetti() {
    const layer = $('confetti-layer');
    if (!layer) return;
    const colors = ['#FF7A45', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${(Math.random() * 0.3).toFixed(2)}s`;
      layer.appendChild(p);
      setTimeout(() => p.remove(), 1850);
    }
  }

  /** 更新顶部书名、上下册总星数与静音按钮 */
  function renderTopHeader() {
    const bookMeta = Data.getBookMeta(state.book);
    $('brand-book-icon').textContent = bookMeta.icon;
    $('brand-book-title').textContent = `${bookMeta.name} · 语文`;

    const allProg = Logic.getTotalStarProgress(state, Data.UNITS);
    $('total-stars-text').textContent = `${allProg.earned} / ${allProg.total}`;

    const sBtn = $('btn-sound-toggle');
    sBtn.textContent = state.soundOn ? '🔊 声音开' : '🔇 已静音';
    sBtn.classList.toggle('muted', !state.soundOn);
  }

  // ==================== 画面一：课本单元目录页 ====================
  function showHomeScreen() {
    clearAutoTimer();
    sound.stopSpeak();
    $('screen-unit').classList.remove('active');
    $('screen-home').classList.add('active');
    renderHomeScreen();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHomeScreen() {
    renderTopHeader();

    // 渲染上下册双书切换器
    $('book-switcher').innerHTML = Data.BOOKS.map((b) => {
      const bUnits = Data.getUnitsByBook(b.id);
      const prog = Logic.getTotalStarProgress(state, bUnits);
      const isActive = state.book === b.id;
      return `
        <button type="button" class="book-tab ${isActive ? 'active' : ''}" data-book="${b.id}" role="tab" aria-selected="${isActive}">
          <span class="book-tab-left">
            <span>${b.icon}</span>
            <span>${esc(b.name)}</span>
          </span>
          <span class="book-tab-stars">⭐ ${prog.earned}/${prog.total}</span>
        </button>
      `;
    }).join('');

    const curUnits = Data.getUnitsByBook(state.book);
    const bookMeta = Data.getBookMeta(state.book);
    const { earned, total } = Logic.getTotalStarProgress(state, curUnits);
    const pct = total > 0 ? Math.round((earned / total) * 100) : 0;

    const banner = $('welcome-banner');
    banner.dataset.book = String(state.book);
    $('welcome-book-heading').textContent = `✨ ${bookMeta.name} · 选一个单元开玩吧！`;
    $('total-bar-fill').style.width = `${pct}%`;
    $('welcome-progress-desc').textContent =
      earned === 0
        ? '每个单元玩通 3 个小游戏，就能点亮 3 颗小星星！'
        : earned >= total
          ? `👑 太棒啦！${bookMeta.name} 24 颗星星全部点亮啦！`
          : `本册已收集 ${earned} / ${total} 颗小星星，继续加油吧！`;

    $('unit-cards-list').innerHTML = curUnits
      .map((u) => {
        const stars = Logic.getUnitStarCount(state, u.id);
        const rec = state.unitModesCleared[u.id] || {};
        const starStr = [1, 2, 3].map((n) => (n <= stars ? '⭐' : '☆')).join('');

        return `
          <article class="unit-card ${stars === 3 ? 'all-lit' : ''}" data-open-unit="${u.id}">
            <div class="u-card-top">
              <div class="u-avatar" style="background:${u.softBg};">${u.icon}</div>
              <div class="u-main">
                <div class="u-title-row">
                  <h2 class="u-title">${esc(u.title)}</h2>
                  <span class="u-stars" aria-label="已得${stars}颗星">${starStr}</span>
                </div>
                <p class="u-lessons">${esc(u.lessonsSummary)}</p>
              </div>
            </div>

            <div class="u-quick-pills">
              <button type="button" class="u-pill" data-unit="${u.id}" data-go-mode="read">📖 读课本</button>
              <button type="button" class="u-pill ${rec.bubble ? 'done' : ''}" data-unit="${u.id}" data-go-mode="bubble">
                🫧 戳泡泡 ${rec.bubble ? '⭐' : ''}
              </button>
              <button type="button" class="u-pill ${rec.spell ? 'done' : ''}" data-unit="${u.id}" data-go-mode="spell">
                ✍️ 拼名句 ${rec.spell ? '⭐' : ''}
              </button>
              <button type="button" class="u-pill ${rec.match ? 'done' : ''}" data-unit="${u.id}" data-go-mode="match">
                🃏 消消乐 ${rec.match ? '⭐' : ''}
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // ==================== 画面二：单元记忆乐园页 ====================
  function openUnitScreen(unitId, initialMode = 'read') {
    clearAutoTimer();
    sound.stopSpeak();
    activeUnitId = unitId;
    $('screen-home').classList.remove('active');
    $('screen-unit').classList.add('active');
    switchUnitMode(initialMode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateUnitHeaderAndTabs() {
    if (activeUnitId === 'book_all') {
      const bookMeta = Data.getBookMeta(state.book);
      $('unit-header-title').textContent = `🎲 ${bookMeta.name} · 随机大闯关`;
      $('unit-header-stars').textContent = '🌟';
      $('tab-star-bubble').textContent = '';
      $('tab-star-spell').textContent = '';
      $('tab-star-match').textContent = '';
    } else {
      const unit = Data.getUnitById(activeUnitId);
      const stars = Logic.getUnitStarCount(state, activeUnitId);
      const rec = state.unitModesCleared[activeUnitId] || {};
      $('unit-header-title').textContent = unit ? `${unit.icon} ${unit.title}` : '';
      $('unit-header-stars').textContent = [1, 2, 3].map((n) => (n <= stars ? '⭐' : '☆')).join('');
      $('tab-star-bubble').textContent = rec.bubble ? '⭐' : '';
      $('tab-star-spell').textContent = rec.spell ? '⭐' : '';
      $('tab-star-match').textContent = rec.match ? '⭐' : '';
    }

    document.querySelectorAll('#mode-tabs .mode-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === activeMode);
    });
    document.querySelectorAll('.game-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${activeMode}`);
    });
  }

  function getActiveScopeItems() {
    return Data.getItemsByScope(activeUnitId, state.book);
  }

  function switchUnitMode(mode) {
    clearAutoTimer();
    sound.stopSpeak();
    activeMode = mode;
    updateUnitHeaderAndTabs();

    if (mode === 'read') renderReadPanel();
    if (mode === 'bubble') startBubbleGame();
    if (mode === 'spell') startSpellGame();
    if (mode === 'match') startMatchGame();
  }

  // -------------------- 模式 1：📖 读课本 --------------------
  function renderReadPanel() {
    const rawItems = getActiveScopeItems();
    const items = activeUnitId === 'book_all' ? Logic.shuffle(rawItems).slice(0, 12) : rawItems;

    const maskBtn = $('btn-toggle-mask');
    maskBtn.classList.toggle('active', maskAnswers);
    maskBtn.textContent = maskAnswers ? '👀 显示全部答案' : '🙈 遮住答案背一背';

    $('read-cards-container').innerHTML = items
      .map(
        (it, idx) => `
        <article class="read-card">
          <div class="rc-top">
            <span class="lesson-badge">${esc(it.lesson)}</span>
            <button type="button" class="speak-chip-btn" data-speak-id="${it.id}">🔊 读给我听</button>
          </div>
          <p class="rc-question">${idx + 1}. ${esc(it.prompt)}</p>
          <div class="rc-answer-box ${maskAnswers ? 'masked' : ''}" data-reveal-ans="${esc(it.answer)}">
            ${maskAnswers ? '👆 点我看答案' : `✅ ${esc(it.answer)}`}
          </div>
          ${it.tip ? `<p class="rc-tip">💡 ${esc(it.tip)}</p>` : ''}
        </article>
      `
      )
      .join('');
  }

  // -------------------- 模式 2：🫧 戳泡泡 --------------------
  function startBubbleGame() {
    const items = getActiveScopeItems();
    bubbleQueue = Logic.buildBubbleRound(items, { count: 8 });
    bubbleIdx = 0;
    bubbleCorrectCount = 0;
    bubbleLocked = false;

    $('bubble-finish-box').classList.add('hidden');
    $('bubble-play-box').classList.remove('hidden');
    renderBubbleQuestion();
  }

  function renderBubbleQuestion() {
    clearAutoTimer();
    const round = bubbleQueue[bubbleIdx];
    if (!round) return;
    bubbleLocked = false;

    const total = bubbleQueue.length;
    $('bubble-lesson-tag').textContent = round.item.lesson;
    $('bubble-step-text').textContent = `第 ${bubbleIdx + 1} / ${total} 题`;
    $('bubble-progress-fill').style.width = `${Math.round(((bubbleIdx + 1) / total) * 100)}%`;
    $('bubble-question-text').textContent = round.item.prompt;

    $('bubble-feedback').classList.add('hidden');
    $('btn-bubble-next').classList.add('hidden');

    $('bubble-pond').innerHTML = round.bubbles
      .map(
        (b, i) => `
        <button type="button" class="big-bubble" data-b-idx="${i}" data-theme="${b.theme}" style="animation-delay:${b.delay}s">
          ${esc(b.text)}
        </button>
      `
      )
      .join('');
  }

  function handleBubblePick(bIdx, btnEl) {
    if (bubbleLocked) return;
    const round = bubbleQueue[bubbleIdx];
    if (!round) return;
    const picked = round.bubbles[bIdx];
    if (!picked) return;

    bubbleLocked = true;
    sound.playPop();

    if (picked.isCorrect) {
      bubbleCorrectCount++;
      btnEl.classList.add('right');
      sound.playCorrect(bubbleCorrectCount);

      const fb = $('bubble-feedback');
      fb.className = 'gentle-feedback ok';
      fb.innerHTML = `<strong>🎉 答对啦！真棒！</strong>`;
      fb.classList.remove('hidden');

      autoNextTimer = setTimeout(() => {
        advanceBubbleStep();
      }, 850);
    } else {
      btnEl.classList.add('wrong');
      sound.playWrong();
      document.querySelectorAll('#bubble-pond .big-bubble').forEach((el) => {
        const b = round.bubbles[Number(el.dataset.bIdx)];
        if (b && b.isCorrect) el.classList.add('right');
      });

      const fb = $('bubble-feedback');
      fb.className = 'gentle-feedback err';
      fb.innerHTML = `
        <strong>💡 正确答案是：「${esc(round.item.answer)}」</strong>
        ${round.item.tip ? `<br>${esc(round.item.tip)}` : ''}
      `;
      fb.classList.remove('hidden');
      $('btn-bubble-next').classList.remove('hidden');
    }
  }

  function advanceBubbleStep() {
    clearAutoTimer();
    bubbleIdx++;
    if (bubbleIdx >= bubbleQueue.length) {
      finishGameMode('bubble', `本局 8 道题答对了 ${bubbleCorrectCount} 道！`, 'spell', '✍️ 接着去玩拼名句');
    } else {
      renderBubbleQuestion();
    }
  }

  // -------------------- 模式 3：✍️ 拼名句 --------------------
  function startSpellGame() {
    const items = getActiveScopeItems();
    spellQueue = Logic.buildSpellRound(items, { count: 6 });
    spellIdx = 0;
    spellChosen = [];
    spellLocked = false;

    $('spell-finish-box').classList.add('hidden');
    $('spell-play-box').classList.remove('hidden');
    renderSpellStep();
  }

  function renderSpellStep() {
    clearAutoTimer();
    const puzzle = spellQueue[spellIdx];
    if (!puzzle) return;

    spellChosen = [];
    spellLocked = false;

    const total = spellQueue.length;
    $('spell-lesson-tag').textContent = puzzle.item.lesson;
    $('spell-step-text').textContent = `第 ${spellIdx + 1} / ${total} 题`;
    $('spell-progress-fill').style.width = `${Math.round(((spellIdx + 1) / total) * 100)}%`;
    $('spell-prompt-text').textContent = puzzle.item.spellPrompt || puzzle.item.prompt;

    $('spell-helper-row').classList.remove('hidden');
    $('spell-feedback').classList.add('hidden');
    $('btn-spell-retry').classList.add('hidden');

    renderSpellSlotsAndTiles();
  }

  function renderSpellSlotsAndTiles(isAllRight = false) {
    const puzzle = spellQueue[spellIdx];
    if (!puzzle) return;
    const usedIds = new Set(spellChosen.map((t) => t.tileId));

    $('spell-slots').innerHTML = puzzle.chars
      .map((_, sIdx) => {
        const chosen = spellChosen[sIdx];
        const cls = isAllRight ? 'char-slot right' : chosen ? 'char-slot filled' : 'char-slot';
        return `<button type="button" class="${cls}" data-s-slot="${sIdx}">${chosen ? esc(chosen.text) : ''}</button>`;
      })
      .join('');

    $('spell-tiles').innerHTML = puzzle.tiles
      .map(
        (t) =>
          `<button type="button" class="char-tile ${usedIds.has(t.tileId) ? 'used' : ''}" data-s-tile="${t.tileId}">${esc(
            t.text
          )}</button>`
      )
      .join('');
  }

  function evaluateSpellIfFull() {
    const puzzle = spellQueue[spellIdx];
    if (!puzzle || spellLocked) return;
    if (spellChosen.length < puzzle.chars.length) return;

    spellLocked = true;
    const res = Logic.checkSpellTiles(puzzle, spellChosen);

    if (res.isCorrect) {
      renderSpellSlotsAndTiles(true);
      sound.playCorrect(spellIdx + 1);
      if (puzzle.item.speakText) {
        sound.speak(puzzle.item.speakText);
      }

      const fb = $('spell-feedback');
      fb.className = 'gentle-feedback ok';
      fb.innerHTML = `<strong>🎉 拼对啦！「${esc(puzzle.targetText)}」</strong>`;
      fb.classList.remove('hidden');
      $('spell-helper-row').classList.add('hidden');

      autoNextTimer = setTimeout(() => {
        spellIdx++;
        if (spellIdx >= spellQueue.length) {
          finishGameMode('spell', '6 句课本名句与重点词全部亲手拼对啦！', 'match', '🃏 接着去玩消消乐');
        } else {
          renderSpellStep();
        }
      }, 1250);
    } else {
      sound.playWrong();
      const fb = $('spell-feedback');
      fb.className = 'gentle-feedback err';
      fb.innerHTML = `
        <strong>💡 正确写法是：「${esc(puzzle.targetText)}」</strong>
        ${puzzle.item.tip ? `<br>${esc(puzzle.item.tip)}` : ''}
      `;
      fb.classList.remove('hidden');
      $('spell-helper-row').classList.add('hidden');
      $('btn-spell-retry').classList.remove('hidden');
    }
  }

  // -------------------- 模式 4：🃏 消消乐 --------------------
  function startMatchGame() {
    const items = getActiveScopeItems();
    matchDeck = Logic.buildMatchDeck(items, { pairCount: 6 });
    matchSelectedIdx = null;
    matchClearedPairs = new Set();
    matchBusy = false;

    $('match-finish-box').classList.add('hidden');
    $('match-play-box').classList.remove('hidden');
    renderMatchGrid();
  }

  function renderMatchGrid() {
    const totalPairs = Math.floor(matchDeck.length / 2);
    $('match-step-text').textContent = `已消 ${matchClearedPairs.size} / ${totalPairs} 对`;

    $('match-grid').innerHTML = matchDeck
      .map((card, idx) => {
        const isMatched = matchClearedPairs.has(card.pairId);
        const isSelected = matchSelectedIdx === idx;
        const sideCls = card.side === 'left' ? 'side-left' : 'side-right';
        return `
          <button type="button" class="pair-card ${sideCls} ${isSelected ? 'selected' : ''} ${isMatched ? 'matched' : ''}" data-m-idx="${idx}">
            ${esc(card.text)}
          </button>
        `;
      })
      .join('');
  }

  function handleMatchCardClick(idx, cardEl) {
    if (matchBusy) return;
    const card = matchDeck[idx];
    if (!card || matchClearedPairs.has(card.pairId)) return;

    if (matchSelectedIdx === null) {
      sound.playClick();
      matchSelectedIdx = idx;
      renderMatchGrid();
      return;
    }

    if (matchSelectedIdx === idx) {
      sound.playClick();
      matchSelectedIdx = null;
      renderMatchGrid();
      return;
    }

    const firstCard = matchDeck[matchSelectedIdx];
    if (firstCard.side === card.side) {
      sound.playClick();
      matchSelectedIdx = idx;
      renderMatchGrid();
      return;
    }

    if (firstCard.pairId === card.pairId) {
      matchClearedPairs.add(card.pairId);
      matchSelectedIdx = null;
      sound.playCorrect(matchClearedPairs.size);
      renderMatchGrid();

      const totalPairs = Math.floor(matchDeck.length / 2);
      if (matchClearedPairs.size >= totalPairs) {
        autoNextTimer = setTimeout(() => {
          finishGameMode('match', '6 组课本好朋友全部配对消除成功！', 'bubble', '🫧 再去玩戳泡泡');
        }, 450);
      }
    } else {
      matchBusy = true;
      sound.playWrong();
      cardEl.classList.add('shake');
      setTimeout(() => {
        matchSelectedIdx = null;
        matchBusy = false;
        renderMatchGrid();
      }, 420);
    }
  }

  // -------------------- 统一通关欢呼与点亮星星 --------------------
  function finishGameMode(mode, summaryText, nextMode, nextBtnLabel) {
    clearAutoTimer();
    const res = Logic.markUnitModeCleared(state, activeUnitId, mode);
    saveState();
    updateUnitHeaderAndTabs();

    sound.playVictory();
    launchConfetti();

    $(`${mode}-play-box`).classList.add('hidden');
    const finishBox = $(`${mode}-finish-box`);
    finishBox.classList.remove('hidden');

    const starMsg =
      activeUnitId === 'book_all'
        ? '本册随机挑战大满贯！'
        : res.newlyLit
          ? `⭐ 成功点亮本单元 1 颗新星星（当前 ${res.unitStars}/3 星）！`
          : `本单元已集齐 ${res.unitStars}/3 颗星星！`;

    finishBox.innerHTML = `
      <div class="finish-emoji">🏆</div>
      <h3>太棒啦！闯关完成！</h3>
      <p>${esc(summaryText)}<br><strong>${esc(starMsg)}</strong></p>
      <div class="finish-btns">
        <button type="button" class="secondary-btn" data-replay-mode="${mode}">🔄 再玩一次</button>
        <button type="button" class="primary-big-btn" data-next-mode="${nextMode}">${esc(nextBtnLabel)}</button>
      </div>
    `;
  }

  // ==================== 全局事件绑定 ====================
  function bindEvents() {
    $('btn-home-logo').addEventListener('click', () => {
      sound.playClick();
      showHomeScreen();
    });

    $('btn-back-home').addEventListener('click', () => {
      sound.playClick();
      showHomeScreen();
    });

    // 上下册一键切换
    $('book-switcher').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-book]');
      if (!tab) return;
      const nextBook = Number(tab.dataset.book);
      if (nextBook === state.book) return;
      sound.playClick();
      state.book = nextBook;
      saveState();
      renderHomeScreen();
    });

    $('btn-sound-toggle').addEventListener('click', () => {
      state.soundOn = !state.soundOn;
      sound.setEnabled(state.soundOn);
      saveState();
      if (state.soundOn) {
        sound.playClick();
        showToast('🔊 声音已开启');
      } else {
        showToast('🔇 已切换为静音');
      }
    });

    $('btn-random-all').addEventListener('click', () => {
      sound.playClick();
      openUnitScreen('book_all', 'bubble');
    });

    $('unit-cards-list').addEventListener('click', (e) => {
      const quickPill = e.target.closest('[data-go-mode]');
      if (quickPill) {
        e.stopPropagation();
        sound.playClick();
        openUnitScreen(quickPill.dataset.unit, quickPill.dataset.goMode);
        return;
      }

      const card = e.target.closest('[data-open-unit]');
      if (card) {
        sound.playClick();
        openUnitScreen(card.dataset.openUnit, 'read');
      }
    });

    $('mode-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-mode]');
      if (!tab) return;
      sound.playClick();
      switchUnitMode(tab.dataset.mode);
    });

    $('btn-toggle-mask').addEventListener('click', () => {
      sound.playClick();
      maskAnswers = !maskAnswers;
      renderReadPanel();
    });

    $('read-cards-container').addEventListener('click', (e) => {
      const speakBtn = e.target.closest('[data-speak-id]');
      if (speakBtn) {
        const it = Data.getItemById(speakBtn.dataset.speakId);
        if (it) {
          const ok = sound.speak(it.speakText || `${it.prompt} ${it.answer}`, { force: true });
          if (!ok) showToast('📱 当前浏览器暂不支持语音合成');
        }
        return;
      }

      const ansBox = e.target.closest('[data-reveal-ans]');
      if (ansBox && ansBox.classList.contains('masked')) {
        sound.playClick();
        ansBox.classList.remove('masked');
        ansBox.textContent = `✅ ${ansBox.dataset.revealAns}`;
      }
    });

    $('btn-read-go-play').addEventListener('click', () => {
      sound.playClick();
      switchUnitMode('bubble');
    });

    $('bubble-pond').addEventListener('click', (e) => {
      const b = e.target.closest('[data-b-idx]');
      if (!b) return;
      handleBubblePick(Number(b.dataset.bIdx), b);
    });

    $('btn-bubble-next').addEventListener('click', () => {
      sound.playClick();
      advanceBubbleStep();
    });

    $('btn-bubble-speak').addEventListener('click', () => {
      const round = bubbleQueue[bubbleIdx];
      if (round?.item) {
        sound.speak(round.item.speakText || round.item.prompt, { force: true });
      }
    });

    $('spell-tiles').addEventListener('click', (e) => {
      const tileBtn = e.target.closest('[data-s-tile]');
      if (!tileBtn || spellLocked) return;
      const puzzle = spellQueue[spellIdx];
      if (!puzzle) return;
      const tileObj = puzzle.tiles.find((t) => t.tileId === tileBtn.dataset.sTile);
      if (!tileObj || spellChosen.some((c) => c.tileId === tileObj.tileId)) return;

      sound.playClick();
      spellChosen.push(tileObj);
      renderSpellSlotsAndTiles();
      evaluateSpellIfFull();
    });

    $('spell-slots').addEventListener('click', (e) => {
      const slotBtn = e.target.closest('[data-s-slot]');
      if (!slotBtn || spellLocked) return;
      const idx = Number(slotBtn.dataset.sSlot);
      if (idx >= 0 && idx < spellChosen.length) {
        sound.playClick();
        spellChosen.splice(idx, 1);
        renderSpellSlotsAndTiles();
      }
    });

    $('btn-spell-clear').addEventListener('click', () => {
      if (spellLocked) return;
      sound.playClick();
      spellChosen = [];
      renderSpellSlotsAndTiles();
    });

    $('btn-spell-hint').addEventListener('click', () => {
      const puzzle = spellQueue[spellIdx];
      if (!puzzle || spellLocked) return;
      while (spellChosen.length > 0) {
        const lastIdx = spellChosen.length - 1;
        if (spellChosen[lastIdx].text === puzzle.chars[lastIdx]) break;
        spellChosen.pop();
      }
      const nextPos = spellChosen.length;
      if (nextPos >= puzzle.chars.length) return;
      const neededChar = puzzle.chars[nextPos];
      const targetTile = puzzle.tiles.find(
        (t) => !t.isNoise && t.text === neededChar && !spellChosen.some((c) => c.tileId === t.tileId)
      );
      if (targetTile) {
        sound.playClick();
        spellChosen.push(targetTile);
        renderSpellSlotsAndTiles();
        evaluateSpellIfFull();
      }
    });

    $('btn-spell-retry').addEventListener('click', () => {
      sound.playClick();
      spellChosen = [];
      spellLocked = false;
      $('spell-feedback').classList.add('hidden');
      $('btn-spell-retry').classList.add('hidden');
      $('spell-helper-row').classList.remove('hidden');
      renderSpellSlotsAndTiles();
    });

    $('btn-spell-speak').addEventListener('click', () => {
      const puzzle = spellQueue[spellIdx];
      if (puzzle?.item) {
        sound.speak(puzzle.item.speakText || puzzle.targetText, { force: true });
      }
    });

    $('match-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-m-idx]');
      if (!btn) return;
      handleMatchCardClick(Number(btn.dataset.mIdx), btn);
    });

    $('screen-unit').addEventListener('click', (e) => {
      const replayBtn = e.target.closest('[data-replay-mode]');
      if (replayBtn) {
        sound.playClick();
        switchUnitMode(replayBtn.dataset.replayMode);
        return;
      }

      const nextBtn = e.target.closest('[data-next-mode]');
      if (nextBtn) {
        sound.playClick();
        switchUnitMode(nextBtn.dataset.nextMode);
      }
    });

    $('btn-reset-stars').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (!resetPending) {
        resetPending = true;
        btn.textContent = '⚠️ 再点一次确认清空星星记录';
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          resetPending = false;
          btn.textContent = '重置星星记录';
        }, 3200);
        return;
      }
      resetPending = false;
      btn.textContent = '重置星星记录';
      const curBook = state.book;
      state = Logic.createDefaultState();
      state.book = curBook;
      sound.setEnabled(state.soundOn);
      saveState();
      renderHomeScreen();
      showToast('✨ 已重置星星进度');
    });
  }

  function init() {
    bindEvents();
    renderHomeScreen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
