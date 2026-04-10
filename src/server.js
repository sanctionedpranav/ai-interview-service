import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import interviewRoutes from './routes/interviewRoutes.js';
import { log } from './utils/logger.js';
// Initialize BullMQ queue and worker for interview graph processing
import './queues/interviewQueue.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('etag', false); // Disable etag to prevent 304 errors on POST requests

// Middleware
app.use(cors());
app.use(express.json());

// Custom HTTP request logger — shows method, path, status, duration
app.use((req, _res, next) => {
  const start = Date.now();
  _res.on('finish', () => {
    const duration = Date.now() - start;
    const color = _res.statusCode >= 500 ? '\x1b[31m' : _res.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';
    console.log(
      `  ${color}${req.method.padEnd(6)}${reset} ${dim}${req.originalUrl.padEnd(50)}${reset}` +
      ` ${color}${_res.statusCode}${reset}  ${dim}${duration}ms${reset}`
    );
  });
  next();
});

app.use('/audio', express.static(path.join(__dirname, '../public/audio')));

// Routes
app.use('/interview', interviewRoutes);

// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ai-interview', env: config.nodeEnv }));

// Global Error Handler
app.use((err, req, res, next) => {
  log.error('GLOBAL ERROR', err);
  res.status(500).json({ 
    error: 'Internal Server Error', 
    message: err.message,
    stack: config.nodeEnv === 'development' ? err.stack : undefined
  });
});

// MongoDB Connection
mongoose.connect(config.mongodbUri)
  .then(() => log.success('MongoDB connected'))
  .catch((err) => log.error('MongoDB connection failed', err));

// Start Server
app.listen(config.port, async () => {
  // ── Startup Banner ────────────────────────────────────────────────────────────
  console.log('\n\x1b[35m\x1b[1m' + '═'.repeat(55) + '\x1b[0m');
  console.log('\x1b[35m\x1b[1m  🤖 AI Interview Service\x1b[0m');
  console.log('\x1b[35m\x1b[1m' + '═'.repeat(55) + '\x1b[0m');
  console.log(`  Port        : \x1b[36m${config.port}\x1b[0m`);
  console.log(`  Environment : \x1b[36m${config.nodeEnv}\x1b[0m`);
  console.log(`  Groq Key    : \x1b[${config.groqApiKey ? '32m✅ set' : '31m❌ missing'}\x1b[0m`);
  console.log(`  Gemini Key  : \x1b[${config.geminiApiKey ? '32m✅ set' : '31m❌ missing'}\x1b[0m`);
  console.log('\x1b[35m\x1b[1m' + '─'.repeat(55) + '\x1b[0m');

  // ── Silero VAD ────────────────────────────────────────────────────────────────
  try {
    const { vadService } = await import('./speech/vad.js');
    await vadService.init();
    log.success('Silero VAD: ONNX model loaded');
  } catch (e) {
    log.warn(`Silero VAD not loaded: ${e.message}`);
    console.log('   → Run: npm install && npm run setup');
  }

  // ── TTS Service (Hybrid: Piper + Gemini) ──────────────────────────────────────
  try {
    const { ttsService } = await import('./speech/tts.js');
    if (ttsService.isAvailable()) {
      const hasPiper = fs.existsSync(path.join(__dirname, '../bin/piper/piper'));
      const hasGemini = config.geminiApiKey;
      log.success(`TTS Ready: ${hasPiper ? 'Piper (Local)' : ''}${hasPiper && hasGemini ? ' + ' : ''}${hasGemini ? 'Gemini (Cloud)' : ''}`);
      setInterval(() => ttsService.cleanup(), 60 * 60 * 1000);
    } else {
      log.warn('TTS not ready — set Gemini API key or run: npm run setup');
    }
  } catch (e) {
    log.error(`TTS initialization failed: ${e.message}`);
  }

  // ── LangGraph ─────────────────────────────────────────────────────────────────
  log.success('LangGraph: interview graph compiled (8 nodes)');
  console.log('  Nodes: introduction → vad_check → stt_transcribe → evaluate_answer');
  console.log('         → generate_question / followup_question → tts_speak → END');
  console.log('\x1b[35m\x1b[1m' + '═'.repeat(55) + '\x1b[0m\n');
});
