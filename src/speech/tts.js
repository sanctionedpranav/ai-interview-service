import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { genAI } from '../ai/aiService.js';
import { log } from '../utils/logger.js';

// ── Paths ─────────────────────────────────────────────────────────────────────
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'audio');

// ── Ensure output directory ───────────────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Gemini TTS Service (2026 Edition)
 *
 * Uses Gemini 2.5's native multimodal audio output capabilities.
 * Supports high-quality voices like "Vega".
 */
export const ttsService = {
  /**
   * Gemini TTS is available if the GenAI client has been initialized with a valid key.
   */
  isAvailable() {
    return !!genAI;
  },

  /**
   * Convert text to speech using Gemini Multimodal Audio Output.
   * @param {string} text - Text to synthesize.
   * @param {string} [sessionId] - Used for output file naming.
   * @param {object} [options] - Optional options.
   * @param {string} [options.voice='Vega'] - Voice name (e.g., Vega, Kore, Zephyr).
   * @returns {Promise<string>} Public URL path of the generated audio (e.g. /audio/xxx.mp3).
   */
  async speak(text, sessionId = uuidv4(), options = {}) {
    if (!this.isAvailable()) {
      log.warn('⚠️  Gemini TTS: Service not available (check API key)');
      return null;
    }

    // Safety check for text
    const cleanText = (text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) {
      log.warn('⚠️  Gemini TTS: Empty text provided, skipping.');
      return null;
    }

    // Predictable filename based on sessionId and text hash
    const hash = crypto.createHash('md5').update(cleanText).digest('hex').slice(0, 8);
    const outputFileName = `${sessionId}_${hash}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    // If file already exists, return immediately (cache hit)
    if (fs.existsSync(outputPath)) {
      return `/audio/${outputFileName}`;
    }

    try {
      const voiceName = options.voice || 'Puck';
      log.info(`🔊 Gemini TTS: Synthesizing with voice "${voiceName}"...`);

      const result = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
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

      // Extract audio data from response
      const audioPart = result.response?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      
      if (!audioPart || !audioPart.inlineData || !audioPart.inlineData.data) {
        throw new Error('Gemini did not return audio data');
      }

      const buffer = Buffer.from(audioPart.inlineData.data, 'base64');
      fs.writeFileSync(outputPath, buffer);

      log.success(`🔊 Gemini TTS: Generated audio → ${outputFileName}`);
      return `/audio/${outputFileName}`;

    } catch (err) {
      if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
        log.warn('⚠️  Gemini TTS: Quota Exceeded (Free Tier). Skipping audio for this turn.');
      } else {
        log.error(`❌ Gemini TTS Error: ${err.message}`);
      }
      return null;
    }
  },

  /**
   * Remove old generated audio files to free disk space.
   * @param {number} [olderThanMs=3600000] - Delete files older than this (default: 1 hour).
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
      if (count > 0) log.info(`🧹 Gemini TTS cleanup: Removed ${count} old audio files`);
    } catch (err) {
      log.error(`Cleanup error: ${err.message}`);
    }
  },
};
