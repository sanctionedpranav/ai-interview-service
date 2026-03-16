import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import interviewRoutes from './routes/interviewRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/audio', express.static(path.join(__dirname, '../public/audio')));

// Routes
app.use('/interview', interviewRoutes);

// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// MongoDB Connection
mongoose.connect(config.mongodbUri)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// Start Server
app.listen(config.port, async () => {
  console.log(`\n🚀 AI Interview Service running on port ${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);

  // Lazily initialise Silero VAD (only if onnxruntime-node is installed)
  try {
    const { vadService } = await import('./speech/vad.js');
    await vadService.init();
  } catch (e) {
    console.warn('⚠️  Silero VAD not loaded:', e.message);
    console.warn('   Run: npm install && npm run setup');
  }

  // Lazily check Piper TTS
  try {
    const { ttsService } = await import('./speech/tts.js');
    if (ttsService.isAvailable()) {
      console.log('✅ Piper TTS: ready');
      setInterval(() => ttsService.cleanup(), 60 * 60 * 1000);
    } else {
      console.warn('⚠️  Piper TTS not ready. Run: npm run setup');
    }
  } catch (e) {
    console.warn('⚠️  Piper TTS check failed:', e.message);
  }
});
