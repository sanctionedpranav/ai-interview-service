#!/usr/bin/env node
/**
 * AI Interview Service - Setup Script
 *
 * Downloads:
 *  1. Silero VAD ONNX model  → models/silero_vad.onnx
 *  2. Piper TTS binary       → bin/piper/piper (macOS/Linux)
 *  3. Piper voice model      → models/piper/en_US-ryan-high.onnx
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Asset URLs ────────────────────────────────────────────────────────────────
const ASSETS = {
  sieroVad: {
    url: 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx',
    dest: path.join(ROOT, 'models', 'silero_vad.onnx'),
    label: 'Silero VAD ONNX model',
  },
  piperVoice: {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx',
    dest: path.join(ROOT, 'models', 'piper', 'en_US-ryan-high.onnx'),
    label: 'Piper voice model (en_US-ryan-high)',
  },
  piperVoiceJson: {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json',
    dest: path.join(ROOT, 'models', 'piper', 'en_US-ryan-high.onnx.json'),
    label: 'Piper voice config JSON',
  },
};

// Piper binary URLs per platform
const PIPER_BINARY = (() => {
  const platform = process.platform;
  const arch = process.arch;
  // Use the actual working release tag
  const base = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';

  if (platform === 'darwin') {
    return arch === 'arm64'
      ? { url: base + 'piper_macos_aarch64.tar.gz', label: 'Piper binary (macOS ARM64)' }
      : { url: base + 'piper_macos_x64.tar.gz', label: 'Piper binary (macOS x64)' };
  }
  if (platform === 'linux') {
    return arch === 'arm64' || arch === 'aarch64'
      ? { url: base + 'piper_linux_aarch64.tar.gz', label: 'Piper binary (Linux ARM64)' }
      : { url: base + 'piper_linux_x86_64.tar.gz', label: 'Piper binary (Linux x86_64)' };
  }
  return null;
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
const ensureDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const download = (url, dest, label) => new Promise((resolve, reject) => {
  if (fs.existsSync(dest)) {
    console.log(`  ⏩ Already exists: ${label}`);
    return resolve();
  }

  ensureDir(dest);
  console.log(`  ⬇️  Downloading: ${label}`);
  console.log(`     ${url}`);

  const file = fs.createWriteStream(dest);
  
  const request = (reqUrl) => {
    const proto = reqUrl.startsWith('https') ? https : http;
    proto.get(reqUrl, (res) => {
      // Handle all redirect codes
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
            // Handle relative redirects if any
            const origin = new URL(reqUrl).origin;
            redirectUrl = new URL(redirectUrl, origin).href;
        }
        return request(redirectUrl); 
      }
      
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`  ✅ Downloaded: ${label}`);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  };

  request(url);
});

const extractTarGz = (tarPath, destDir) => {
  fs.mkdirSync(destDir, { recursive: true });
  execSync(`tar -xzf "${tarPath}" -C "${destDir}" --strip-components=1`);
  fs.unlinkSync(tarPath);
};

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🚀 AI Interview Service - Setup\n');

  // 1. Silero VAD model
  try {
    await download(ASSETS.sieroVad.url, ASSETS.sieroVad.dest, ASSETS.sieroVad.label);
  } catch (e) {
    console.error(`  ❌ Failed to download Silero VAD: ${e.message}`);
  }

  // 2. Piper voice model
  try {
    await download(ASSETS.piperVoice.url, ASSETS.piperVoice.dest, ASSETS.piperVoice.label);
    await download(ASSETS.piperVoiceJson.url, ASSETS.piperVoiceJson.dest, ASSETS.piperVoiceJson.label);
  } catch (e) {
    console.error(`  ❌ Failed to download Piper voice: ${e.message}`);
  }

  // 3. Piper binary
  if (!PIPER_BINARY) {
    console.warn('\n  ⚠️  Windows is not supported for automatic Piper download.');
    console.warn('     Please download manually from: https://github.com/rhasspy/piper/releases');
  } else {
    const tarDest = path.join(ROOT, 'bin', `piper.tar.gz`);
    const binDir = path.join(ROOT, 'bin', 'piper');
    try {
      await download(PIPER_BINARY.url, tarDest, PIPER_BINARY.label);
      console.log('  📦 Extracting Piper binary...');
      extractTarGz(tarDest, binDir);
      // Make binary executable
      const piperExe = path.join(binDir, 'piper');
      if (fs.existsSync(piperExe)) execSync(`chmod +x "${piperExe}"`);
      console.log('  ✅ Piper binary ready');
    } catch (e) {
      console.error(`  ❌ Failed to install Piper: ${e.message}`);
      console.warn('     You can still install Piper manually: https://github.com/rhasspy/piper/releases');
    }
  }

  console.log('\n✨ Setup complete!\n');
  console.log('  Next steps:');
  console.log('  1. Add your GROQ_API_KEY to .env (for Whisper STT)');
  console.log('  2. Run: npm run dev\n');
})();
