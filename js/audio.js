/**
 * 课本奇趣岛 - 高可用双语真人语音与互动音效引擎
 * 1. 英语优先采用复用 HTML5 <audio> 播放 HTTPS 真人词典 MP3（兼容微信/iOS/安卓），失败自动降级到修复版 Web Speech API；
 * 2. 语文古诗词/生字支持中文普通话（zh-CN）朗读；
 * 3. 内置首次触屏解锁 AudioContext 与 Web Audio 合成闯关/泡泡音效。
 */
(function (root) {
  'use strict';

  /**
   * 构造标准真人英语词典 HTTPS MP3 地址
   * @param {string} text 英文单词或短语
   * @param {string} accent 'en-GB'（英音）| 'en-US'（美音）
   * @returns {string}
   */
  function buildDictAudioUrl(text, accent) {
    const clean = String(text || '').trim().toLowerCase();
    if (!clean) return '';
    const type = accent === 'en-US' ? 2 : 1; // 1=英式真人发音, 2=美式真人发音
    return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(clean)}&type=${type}`;
  }

  /** 将语速映射到自然清晰的播放倍率 */
  function mapPlaybackRate(rate, slow = false) {
    let target = typeof rate === 'number' ? rate : 0.88;
    if (slow) target = Math.min(target, 0.72);
    return Math.max(0.65, Math.min(1.15, Number(target.toFixed(2))));
  }

  class SoundEngine {
    constructor() {
      this.accent = 'en-GB';
      this.rate = 0.88;
      this.sfxEnabled = true;
      this.autoSpeak = true;
      this.audioCtx = null;
      this.voices = [];
      this.player = null; // 复用单一 HTMLAudioElement，解决移动端自动播放拦截
      this.playToken = 0;
      this.unlocked = false;
      this.preloadCache = new Set();

      this._initVoices();
      this._initPlayer();
      this._bindUnlockGesture();
    }

    /** 初始化浏览器系统语音列表 */
    _initVoices() {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const load = () => {
        try {
          this.voices = window.speechSynthesis.getVoices() || [];
        } catch (e) {
          this.voices = [];
        }
      };
      load();
      if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = load;
      }
    }

    /** 初始化复用的 HTML5 Audio 实例 */
    _initPlayer() {
      if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
      try {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.setAttribute('playsinline', '');
        audio.setAttribute('webkit-playsinline', '');
        this.player = audio;
      } catch (e) {
        this.player = null;
      }
    }

    /** 监听首次触摸或点击，立即解锁移动端 AudioContext */
    _bindUnlockGesture() {
      if (typeof document === 'undefined') return;
      const unlock = () => {
        if (this.unlocked) return;
        this.unlocked = true;
        this._ensureAudioCtx();
        try {
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
          }
        } catch (e) {}
      };
      ['touchstart', 'pointerdown', 'click'].forEach((evt) => {
        document.addEventListener(evt, unlock, { capture: true, passive: true });
      });
    }

    /** 更新发音与音效设置 */
    configure({ accent, rate, sfxEnabled, autoSpeak } = {}) {
      if (accent) this.accent = accent;
      if (typeof rate === 'number') this.rate = rate;
      if (typeof sfxEnabled === 'boolean') this.sfxEnabled = sfxEnabled;
      if (typeof autoSpeak === 'boolean') this.autoSpeak = autoSpeak;
    }

    /** 是否具备音频播放能力 */
    isAudioAvailable() {
      return Boolean(this.player) || this.isSpeechSupported();
    }

    /** 是否支持 Web Speech API */
    isSpeechSupported() {
      return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    /** 预加载英文单词真人发音 MP3 */
    preloadEn(word, accent) {
      if (typeof Audio === 'undefined') return;
      const url = buildDictAudioUrl(word, accent || this.accent);
      if (!url || this.preloadCache.has(url)) return;
      this.preloadCache.add(url);
      try {
        const pre = new Audio();
        pre.preload = 'auto';
        pre.src = url;
        pre.load();
      } catch (e) {}
    }

    /**
     * 朗读英语单词/短语（优先真人词典 MP3，超时或离线无缝降级到 Web Speech）
     */
    speakEn(text, options = {}) {
      const clean = String(text || '').trim();
      if (!clean) return false;

      const token = ++this.playToken;
      const accent = options.accent || this.accent;
      const rate = typeof options.rate === 'number' ? options.rate : this.rate;
      const slow = Boolean(options.slow);

      if (this.player) {
        const url = buildDictAudioUrl(clean, accent);
        if (url) {
          this._playMp3WithFallback(url, clean, { token, lang: accent, rate, slow, ...options });
          return true;
        }
      }

      return this._speakViaWebSpeech(clean, { token, lang: accent, rate, slow, ...options });
    }

    /**
     * 朗读中文古诗名句或生字词
     */
    speakZh(text, options = {}) {
      const clean = String(text || '').trim();
      if (!clean) return false;
      const token = ++this.playToken;
      const rate = typeof options.rate === 'number' ? options.rate : this.rate;
      const slow = Boolean(options.slow);
      return this._speakViaWebSpeech(clean, {
        token,
        lang: 'zh-CN',
        rate,
        slow,
        ...options
      });
    }

    /**
     * 智能朗读课本知识点（自动识别英语词条或语文古诗字词）
     */
    speakItem(item, options = {}) {
      if (!item) return false;
      if (item.speakEn) {
        return this.speakEn(item.speakEn, options);
      }
      if (item.speakZh) {
        return this.speakZh(item.speakZh, options);
      }
      return false;
    }

    /** 复用 HTMLAudioElement 播放 MP3 并带 3.2 秒超时保护 */
    _playMp3WithFallback(url, fallbackText, opts) {
      const audio = this.player;
      const { token, onStart, onEnd } = opts;
      let settled = false;
      let started = false;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        audio.onplaying = null;
        audio.onended = null;
        audio.onerror = null;
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (token === this.playToken && onEnd) onEnd();
      };

      const fallback = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (token !== this.playToken) return;
        const ok = this._speakViaWebSpeech(fallbackText, opts);
        if (!ok && onEnd) onEnd();
      };

      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {}

      audio.src = url;
      const targetRate = mapPlaybackRate(opts.rate, opts.slow);
      try {
        audio.defaultPlaybackRate = targetRate;
        audio.playbackRate = targetRate;
      } catch (e) {}

      audio.onplaying = () => {
        if (token !== this.playToken) return;
        started = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        try {
          audio.playbackRate = targetRate;
        } catch (e) {}
        if (onStart) onStart();
      };

      audio.onended = finish;
      audio.onerror = fallback;

      timeoutId = setTimeout(() => {
        if (!started && !settled) fallback();
      }, 3200);

      try {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.catch(() => {
            if (!started && !settled) fallback();
          });
        }
      } catch (err) {
        fallback();
      }
    }

    /** 挑选清晰自然的系统发音人 */
    _pickVoice(langPref) {
      if (!this.voices.length && this.isSpeechSupported()) {
        try {
          this.voices = window.speechSynthesis.getVoices() || [];
        } catch (e) {
          this.voices = [];
        }
      }
      if (!this.voices.length) return null;

      const target = String(langPref || 'en-GB').toLowerCase().replace('_', '-');
      const exact = this.voices.filter(
        (v) => v.lang && v.lang.toLowerCase().replace('_', '-') === target
      );
      const preferred = [
        'xiaoxiao', 'yunxi', 'ting-ting', 'meijia', 'google', 'natural', 'samantha', 'daniel'
      ];
      const best = exact.find((v) =>
        preferred.some((name) => v.name.toLowerCase().includes(name))
      );
      if (best) return best;
      if (exact.length) return exact[0];

      const prefix = target.split('-')[0];
      return this.voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix)) || null;
    }

    /** 修复版 Web Speech API 朗读（防止 iOS Safari 连续 cancel 吞音） */
    _speakViaWebSpeech(text, options = {}) {
      if (!this.isSpeechSupported() || !text) return false;
      try {
        const synth = window.speechSynthesis;
        const doSpeak = () => {
          if (options.token && options.token !== this.playToken) return;
          const utter = new SpeechSynthesisUtterance(text);
          const lang = options.lang || this.accent;
          const voice = this._pickVoice(lang);
          if (voice) {
            utter.voice = voice;
            utter.lang = voice.lang;
          } else {
            utter.lang = lang;
          }
          utter.rate = mapPlaybackRate(options.rate, options.slow);
          utter.pitch = 1.02;
          utter.volume = 1;
          if (options.onStart) utter.onstart = options.onStart;
          if (options.onEnd) {
            utter.onend = options.onEnd;
            utter.onerror = options.onEnd;
          }
          synth.speak(utter);
        };

        if (synth.speaking || synth.pending) {
          synth.cancel();
          setTimeout(doSpeak, 60);
        } else {
          doSpeak();
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    /** 确保 Web Audio 上下文激活 */
    _ensureAudioCtx() {
      if (typeof window === 'undefined') return null;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!this.audioCtx) {
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    }

    /** 合成单音符音效 */
    _tone(freq, duration, startOffset = 0, type = 'sine', gainVal = 0.13) {
      if (!this.sfxEnabled) return;
      const ctx = this._ensureAudioCtx();
      if (!ctx) return;

      const startAt = () => {
        const now = ctx.currentTime + startOffset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(startAt).catch(() => {});
      } else {
        startAt();
      }
    }

    playClick() {
      this._tone(587.33, 0.06, 0, 'triangle', 0.09);
    }

    playFlip() {
      this._tone(440, 0.06, 0, 'sine', 0.08);
      this._tone(659.25, 0.08, 0.04, 'sine', 0.08);
    }

    playPop() {
      this._tone(520, 0.05, 0, 'sine', 0.12);
      this._tone(880, 0.08, 0.03, 'triangle', 0.14);
    }

    playCorrect(combo = 1) {
      const shift = Math.min(Math.max(0, combo - 1), 6) * 26;
      this._tone(523.25 + shift, 0.11, 0, 'triangle', 0.13);
      this._tone(659.25 + shift, 0.11, 0.08, 'triangle', 0.13);
      this._tone(783.99 + shift, 0.2, 0.16, 'triangle', 0.15);
    }

    playWrong() {
      this._tone(280, 0.14, 0, 'sine', 0.11);
      this._tone(230, 0.2, 0.12, 'sine', 0.11);
    }

    playVictory() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        this._tone(f, idx === 3 ? 0.36 : 0.12, idx * 0.09, 'triangle', 0.15);
      });
    }
  }

  const AudioModule = {
    SoundEngine,
    buildDictAudioUrl,
    mapPlaybackRate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioModule;
  } else {
    root.PEPAudio = AudioModule;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
