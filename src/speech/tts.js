import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// ── Paths ─────────────────────────────────────────────────────────────────────
const PIPER_DIR = path.join(process.cwd(), 'bin', 'piper');
const MODELS_DIR = path.join(process.cwd(), 'models', 'piper');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'audio');

// Default voice model — use joe-medium (63MB, fast) instead of ryan-high (120MB, slow)
// ryan-high takes 30-60s to synthesize on Mac, easily hitting our timeout
const DEFAULT_MODEL = path.join(MODELS_DIR, 'en_US-joe-medium.onnx');

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
    // Piper is hanging on this mac architecture, disable it entirely.
    return null;

    // (macOS quarantine blocks ANY downloaded binary with EACCES even with chmod +x)
    // We also need to clear quarantine for the libraries we just added.
    try {
      execSync(`xattr -cr "${PIPER_DIR}" 2>/dev/null`);
      execSync(`chmod +x "${piperBin}"`);
      // Also chmod the dylibs in the same folder if any
      execSync(`chmod +x "${PIPER_DIR}"/*.dylib 2>/dev/null || true`);
    } catch (_) {}

    const modelPath = options.modelPath || DEFAULT_MODEL;
    if (!fs.existsSync(modelPath)) {
      console.warn(`⚠️  Piper voice model not found at: ${modelPath}`);
      console.warn('    Run `npm run setup` to download voice models.');
      return null;
    }

    // Safety check for text
    const cleanText = (text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) {
      console.warn('⚠️  Piper TTS: Empty text provided, skipping.');
      return null;
    }

    // Predictable filename based on sessionId and text hash to avoid duplicates and allow prediction
    const hash = crypto.createHash('md5').update(cleanText).digest('hex').slice(0, 8);
    const outputFileName = `${sessionId}_${hash}.wav`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);
    const speed = 1.05; 

    // If file already exists, return immediately (cache hit)
    if (fs.existsSync(outputPath)) {
      return `/audio/${outputFileName}`;
    }

    // ── Synthesis Logic ──────────────────────────────────────────────────────────
    const runSynthesis = () => new Promise((resolve, reject) => {
      const args = [
        '--model', modelPath,
        '--output_file', outputPath,
        '--length_scale', String(1.0 / speed),
      ];

      // We MUST use DYLD_LIBRARY_PATH to point to our local x86_64 dylibs.
      // Since the official "arm64" release is actually x86_64, it will FAIL to load
      // the arm64 dylibs from /opt/homebrew/lib.
      const env = { 
        ...process.env, 
        DYLD_LIBRARY_PATH: `${PIPER_DIR}:${process.env.DYLD_LIBRARY_PATH || ''}`,
        DYLD_FALLBACK_LIBRARY_PATH: `/opt/homebrew/lib:/usr/local/lib:/usr/lib`
      };

      const piper = spawn(piperBin, args, { 
        stdio: ['pipe', 'pipe', 'pipe'], 
        env,
        // Optional: explicitly trigger Rosetta if on Apple Silicon
        shell: true 
      });
      piper.stdin.write(cleanText);
      piper.stdin.end();

      const timeout = setTimeout(() => {
        piper.kill();
        reject(new Error(`TTS Timeout (90s) for: ${cleanText.slice(0, 30)}...`));
      }, 90000);

      let stderrMsg = '';
      piper.stderr.on('data', data => {
          stderrMsg += data.toString();
      });

      piper.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 && fs.existsSync(outputPath)) {
            resolve(`/audio/${outputFileName}`);
        } else {
            console.error('Piper TTS Stderr:', stderrMsg);
            reject(new Error(`Piper failed with code ${code} or file not created.`));
        }
      });

      piper.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    if (options.background) {
      console.log(`🔊 Piper TTS: Starting background synth → ${outputFileName}`);
      // Fire and log (no unhandled rejection)
      runSynthesis().catch(err => {
        console.error(`❌ Background TTS Error [${outputFileName}]:`, err.message);
      });
      return `/audio/${outputFileName}`;
    }

    return runSynthesis();
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
