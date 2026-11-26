/**
 * 二年级上册语文 · 纯净普通话朗读与童趣合成音效引擎
 * - 极简一键静音开关（同时控制朗读与欢呼音效，适合小朋友零门槛操作）
 * - 首次触屏自动解锁移动端 AudioContext
 * - 修复版中文普通话 Web Speech API 朗读（防 iOS/安卓连续点击吞音）
 */
(function (root) {
  'use strict';

  class SoundEngine {
    constructor() {
      this.enabled = true;
      this.rate = 0.92; // 适合二年级儿童听清字音的温和语速
      this.audioCtx = null;
      this.voices = [];
      this.playToken = 0;
      this.unlocked = false;

      this._initVoices();
      this._bindUnlockGesture();
    }

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

    setEnabled(flag) {
      this.enabled = Boolean(flag);
      if (!this.enabled) {
        this.stopSpeak();
      }
    }

    isSpeechSupported() {
      return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    stopSpeak() {
      this.playToken++;
      if (this.isSpeechSupported()) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
      }
    }

    /** 挑选清晰亲切的中文普通话发音人 */
    _pickChineseVoice() {
      if (!this.voices.length && this.isSpeechSupported()) {
        try {
          this.voices = window.speechSynthesis.getVoices() || [];
        } catch (e) {
          this.voices = [];
        }
      }
      if (!this.voices.length) return null;

      const zhVoices = this.voices.filter(
        (v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('zh')
      );
      const preferred = ['xiaoxiao', 'yunxi', 'ting-ting', 'tingting', 'meijia', 'natural', 'google'];
      const cnMainland = zhVoices.filter((v) =>
        v.lang.toLowerCase().replace('_', '-').includes('cn')
      );
      const pool = cnMainland.length ? cnMainland : zhVoices;

      const best = pool.find((v) =>
        preferred.some((kw) => v.name.toLowerCase().includes(kw))
      );
      return best || pool[0] || null;
    }

    /** 朗读中文课文、古诗或提示 */
    speak(text, { force = false } = {}) {
      if (!force && !this.enabled) return false;
      const clean = String(text || '').trim();
      if (!clean || !this.isSpeechSupported()) return false;

      const token = ++this.playToken;
      try {
        const synth = window.speechSynthesis;
        const run = () => {
          if (token !== this.playToken) return;
          const utter = new SpeechSynthesisUtterance(clean);
          const voice = this._pickChineseVoice();
          if (voice) {
            utter.voice = voice;
            utter.lang = voice.lang;
          } else {
            utter.lang = 'zh-CN';
          }
          utter.rate = this.rate;
          utter.pitch = 1.04;
          utter.volume = 1;
          synth.speak(utter);
        };

        if (synth.speaking || synth.pending) {
          synth.cancel();
          setTimeout(run, 60);
        } else {
          run();
        }
        return true;
      } catch (e) {
        return false;
      }
    }

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

    _tone(freq, duration, startOffset = 0, type = 'sine', gainVal = 0.12) {
      if (!this.enabled) return;
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
      this._tone(587.33, 0.06, 0, 'triangle', 0.08);
    }

    playPop() {
      this._tone(520, 0.05, 0, 'sine', 0.11);
      this._tone(880, 0.08, 0.03, 'triangle', 0.13);
    }

    playCorrect(combo = 1) {
      const shift = Math.min(Math.max(0, combo - 1), 5) * 26;
      this._tone(523.25 + shift, 0.1, 0, 'triangle', 0.12);
      this._tone(659.25 + shift, 0.1, 0.07, 'triangle', 0.12);
      this._tone(783.99 + shift, 0.19, 0.14, 'triangle', 0.14);
    }

    playWrong() {
      this._tone(300, 0.12, 0, 'sine', 0.09);
      this._tone(250, 0.18, 0.1, 'sine', 0.09);
    }

    playVictory() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        this._tone(f, idx === 3 ? 0.35 : 0.11, idx * 0.09, 'triangle', 0.14);
      });
    }
  }

  const AudioModule = { SoundEngine };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioModule;
  } else {
    root.PEPAudio = AudioModule;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
