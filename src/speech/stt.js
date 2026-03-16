import fs from 'fs';
import path from 'path';
import Groq from 'groq-sdk';
import { config } from '../config/index.js';

const groq = new Groq({ apiKey: config.groqApiKey });

/**
 * Whisper STT Service (powered by Groq Whisper API)
 *
 * Groq hosts whisper-large-v3 and provides sub-1-second transcription latency,
 * which is ideal for near real-time interview feedback.
 *
 * Model: whisper-large-v3
 * Supported formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm
 */
export const sttService = {
  /**
   * Transcribe an audio file to text using Whisper via Groq.
   * @param {string} audioPath - Absolute path to the audio file.
   * @param {object} options - Optional params.
   * @param {string} [options.language='en'] - ISO-639-1 language code.
   * @param {string} [options.prompt] - Optional initial prompt for context.
   * @returns {Promise<string>} Transcribed text.
   */
  async transcribe(audioPath, options = {}) {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const fileExtension = path.extname(audioPath).slice(1) || 'wav';
    const supportedFormats = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm'];

    if (!supportedFormats.includes(fileExtension)) {
      throw new Error(`Unsupported audio format: ${fileExtension}. Supported: ${supportedFormats.join(', ')}`);
    }

    const fileSize = fs.statSync(audioPath).size;
    if (fileSize === 0) {
      throw new Error('Audio file is empty');
    }

    // Max file size for Whisper API: 25MB
    const MAX_SIZE_MB = 25 * 1024 * 1024;
    if (fileSize > MAX_SIZE_MB) {
      throw new Error('Audio file exceeds 25MB limit');
    }

    try {
      console.log(`🎤 Transcribing audio: ${path.basename(audioPath)} (${(fileSize / 1024).toFixed(1)} KB)`);

      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-large-v3',
        response_format: 'verbose_json', // verbose gives word-level timestamps
        language: options.language || 'en',
        ...(options.prompt && { prompt: options.prompt }),
      });

      const text = transcription.text?.trim();
      if (!text) {
        console.warn('⚠️ Whisper returned empty transcription');
        return '';
      }

      console.log(`✅ Transcription complete: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);
      return text;
    } catch (error) {
      const msg = error.error?.message || error.message;
      console.error('❌ Whisper STT Error:', msg);

      // Provide helpful error messages
      if (msg?.includes('Invalid API Key') || msg?.includes('401')) {
        throw new Error('Invalid Groq API key. Please set a valid GROQ_API_KEY in your .env file.');
      }
      if (msg?.includes('rate limit') || msg?.includes('429')) {
        throw new Error('Groq rate limit reached. Please wait a moment and try again.');
      }

      throw new Error(`Transcription failed: ${msg}`);
    }
  },

  /**
   * Transcribe audio from a Buffer (useful when piping audio directly).
   * Writes to a temp file then calls transcribe().
   * @param {Buffer} audioBuffer - The audio buffer to transcribe.
   * @param {string} [format='webm'] - Format of audio data in the buffer.
   * @returns {Promise<string>} Transcribed text.
   */
  async transcribeBuffer(audioBuffer, format = 'webm') {
    const tmpPath = path.join(process.cwd(), 'uploads', `tmp_${Date.now()}.${format}`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, audioBuffer);
    try {
      return await this.transcribe(tmpPath);
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  },
};
