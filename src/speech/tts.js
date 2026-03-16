import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// ── Paths ─────────────────────────────────────────────────────────────────────
const PIPER_DIR = path.join(process.cwd(), 'bin', 'piper');
const MODELS_DIR = path.join(process.cwd(), 'models', 'piper');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'audio');

// Default voice model (downloaded by setup script)
const DEFAULT_MODEL = path.join(MODELS_DIR, 'en_US-ryan-high.onnx');

// ── Detect Piper Binary ───────────────────────────────────────────────────────
const getPiperBinary = () => {
  // 1. Check local bin/piper directory (downloaded by setup script)
  const localBinaries = ['piper', 'piper_linux_x86_64', 'piper_macos_x86_64', 'piper_macos_arm64'];
  for (const bin of localBinaries) {
    const localPath = path.join(PIPER_DIR, bin);
    if (fs.existsSync(localPath)) return localPath;
  }

  // 2. Check system PATH
  try {
    execSync('which piper', { stdio: 'ignore' });
    return 'piper';
  } catch (_) {}

  return null;
};

// ── Ensure output directory ───────────────────────────────────────────────────
const ensureOutputDir = () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
};

/**
 * Piper TTS Service
 *
 * Piper is a fast, local NSS-based neural text-to-speech engine.
 * It runs entirely offline (no API cost) and produces high-quality audio.
 *
 * Setup: Run `npm run setup` to download the piper binary and voice models.
 * GitHub: https://github.com/rhasspy/piper
 */
export const ttsService = {
  /**
   * Whether Piper is available on this system.
   */
  isAvailable() {
    const bin = getPiperBinary();
    const modelExists = fs.existsSync(DEFAULT_MODEL);
    return !!(bin && modelExists);
  },

  /**
   * Convert text to speech using Piper TTS.
   * @param {string} text - Text to synthesize.
   * @param {string} [sessionId] - Used for output file naming.
   * @param {object} [options] - Optional options.
   * @param {string} [options.modelPath] - Override the default voice model.
   * @param {number} [options.speed=1.0] - Speech speed (0.5 = slow, 2.0 = fast).
   * @returns {Promise<string>} Public URL path of the generated audio (e.g. /audio/xxx.wav).
   */
  async speak(text, sessionId = uuidv4(), options = {}) {
    ensureOutputDir();

    const piperBin = getPiperBinary();

    if (!piperBin) {
      console.warn('⚠️  Piper TTS binary not found. Run `npm run setup` to install it.');
      return null;
    }

    const modelPath = options.modelPath || DEFAULT_MODEL;
    if (!fs.existsSync(modelPath)) {
      console.warn(`⚠️  Piper voice model not found at: ${modelPath}`);
      console.warn('    Run `npm run setup` to download voice models.');
      return null;
    }

    const outputFileName = `${sessionId}_${uuidv4()}.wav`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);
    const speed = options.speed || 1.0;

    return new Promise((resolve, reject) => {
      console.log(`🔊 Piper TTS: Generating audio for "${text.slice(0, 60)}..."`);

      const args = [
        '--model', modelPath,
        '--output_file', outputPath,
        '--length_scale', String(1.0 / speed), // Piper uses length_scale (inverse of speed)
      ];

      const piper = spawn(piperBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write text to piper's stdin
      piper.stdin.write(text);
      piper.stdin.end();

      let stderr = '';
      piper.stderr.on('data', (data) => { stderr += data.toString(); });

      piper.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          console.log(`✅ Piper TTS: Audio generated → ${outputFileName}`);
          resolve(`/audio/${outputFileName}`);
        } else {
          console.error(`❌ Piper TTS failed (exit ${code}): ${stderr}`);
          reject(new Error(`Piper TTS failed with exit code ${code}`));
        }
      });

      piper.on('error', (err) => {
        console.error('❌ Piper process error:', err.message);
        reject(err);
      });

      // Safety timeout: 30 seconds
      setTimeout(() => {
        piper.kill();
        reject(new Error('Piper TTS timed out after 30s'));
      }, 30000);
    });
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
      if (count > 0) console.log(`🧹 Piper cleanup: Removed ${count} old audio files`);
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  },
};
