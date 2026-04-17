import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import { genAI } from '../ai/aiService.js';
import { log } from '../utils/logger.js';

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT = process.cwd();
// Industry standard: use the OS temp directory for ephemeral generated files.
// os.tmpdir() always exists, is never committed to git, and the OS manages cleanup.
const OUTPUT_DIR = path.join(os.tmpdir(), 'ai-interview-tts');
const PIPER_BIN = path.join(ROOT, 'bin', 'piper', 'piper');
const PIPER_MODEL = path.join(ROOT, 'models', 'piper', 'en_US-ryan-high.onnx');

// ── Ensure output directory ───────────────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Hybrid TTS Service (Piper + Gemini Fallback)
 */
export const ttsService = {
  /**
   * TTS is available if Piper binary exists OR Gemini key is set.
   */
  isAvailable() {
    return fs.existsSync(PIPER_BIN) || !!genAI;
  },

  /**
   * Generate speech using local Piper binary (Primary).
   * @private
   */
  async speakPiper(text, outputPath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(PIPER_BIN)) return reject(new Error('Piper binary not found'));
      if (!fs.existsSync(PIPER_MODEL)) return reject(new Error('Piper model not found'));

      log.info(`🔊 Piper TTS: Synthesizing "${text.slice(0, 30)}..."`);

      const piperDir = path.dirname(PIPER_BIN);
      const piper = spawn(PIPER_BIN, [
        '--model', PIPER_MODEL,
        '--output_file', outputPath,
        '--espeak_data', path.join(piperDir, 'espeak-ng-data')
      ], {
        env: {
          ...process.env,
          DYLD_LIBRARY_PATH: piperDir,
          LD_LIBRARY_PATH: piperDir
        }
      });

      piper.stdin.write(text);
      piper.stdin.end();

      const timeout = setTimeout(() => {
        piper.kill();
        reject(new Error('Piper TTS Timeout (60s)'));
      }, 60000);

      piper.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Piper exited with code ${code}`));
        }
      });

      piper.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  },

  /**
   * Convert text to speech using Piper (Primary) or Gemini (Fallback).
   * @param {string} text - Text to synthesize.
   * @param {string} [sessionId] - Used for output file naming.
   * @param {object} [options] - Optional options.
   * @returns {Promise<string>} Public URL path of the generated audio.
   */
  async speak(text, sessionId = uuidv4(), options = {}) {
    if (!this.isAvailable()) {
      log.warn('⚠️ TTS: No service available (Piper or Gemini)');
      return null;
    }

    const cleanText = (text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return null;

    const hash = crypto.createHash('md5').update(cleanText).digest('hex').slice(0, 8);

    // Piper uses .wav, Gemini uses .mp3
    // We check for either existing file to avoid re-synthesis
    const piperFileName = `${sessionId}_${hash}.wav`;
    const geminiFileName = `${sessionId}_${hash}.mp3`;

    if (fs.existsSync(path.join(OUTPUT_DIR, piperFileName))) return `/audio/${piperFileName}`;
    if (fs.existsSync(path.join(OUTPUT_DIR, geminiFileName))) return `/audio/${geminiFileName}`;

    // --- Try Piper (Primary) ---
    if (fs.existsSync(PIPER_BIN)) {
      try {
        const outputPath = path.join(OUTPUT_DIR, piperFileName);
        await this.speakPiper(cleanText, outputPath);
        log.success(`🔊 Piper TTS: Generated → ${piperFileName}`);
        return `/audio/${piperFileName}`;
      } catch (err) {
        log.warn(`⚠️ Piper TTS Failed: ${err.message}. Falling back to Gemini...`);
      }
    }

    // --- Try Gemini (Fallback) ---
    if (genAI) {
      try {
        const voiceName = options.voice || 'Puck';
        log.info(`🔊 Gemini TTS: Synthesizing with voice "${voiceName}"...`);

        const result = await genAI.models.generateContent({
          model: 'gemini-2.5-flash-preview-tts', // Multimodal audio model
          contents: [{ role: 'user', parts: [{ text: cleanText }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voiceName
                }
              }
            }
          }
        });

        const audioPart = result.response?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!audioPart?.inlineData?.data) throw new Error('Gemini did not return audio data');

        const outputPath = path.join(OUTPUT_DIR, geminiFileName);
        fs.writeFileSync(outputPath, Buffer.from(audioPart.inlineData.data, 'base64'));
        log.success(`🔊 Gemini TTS: Generated → ${geminiFileName}`);
        return `/audio/${geminiFileName}`;
      } catch (err) {
        log.error(`❌ Gemini TTS Error: ${err.message}`);
      }
    }

    return null;
  },

  /**
   * Cleanup old audio files
   */
  cleanup(olderThanMs = 60 * 60 * 1000) {
    try {
      const now = Date.now();
      const files = fs.readdirSync(OUTPUT_DIR);
      let count = 0;
      for (const file of files) {
        const fp = path.join(OUTPUT_DIR, file);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > olderThanMs) {
          fs.unlinkSync(fp);
          count++;
        }
      }
      if (count > 0) log.info(`🧹 TTS Cleanup: Removed ${count} old files`);
    } catch (err) {
      log.error(`Cleanup error: ${err.message}`);
    }
  },
};
