import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to Silero VAD ONNX model (download via scripts/setup.js)
const MODEL_PATH = path.join(process.cwd(), 'models', 'silero_vad.onnx');

const SAMPLE_RATE = 16000;
const WINDOW_SIZE_SAMPLES = 512; // for 16kHz

let session = null;
let hState = null;
let cState = null;
let ort = null; // Lazy-loaded onnxruntime-node

/**
 * Load (or lazily init) the Silero VAD ONNX model session.
 */
const loadModel = async () => {
  if (session) return;
  if (!fs.existsSync(MODEL_PATH)) {
    console.warn('⚠️  Silero VAD model not found. Run `npm run setup` to download it.');
    return;
  }
  // Dynamically import onnxruntime-node (optional dep — may not be installed)
  try {
    ort = await import('onnxruntime-node');
  } catch (e) {
    console.warn('⚠️  onnxruntime-node not installed. Run `npm install` first.');
    return;
  }
  session = await ort.InferenceSession.create(MODEL_PATH);
  // Initialize hidden/cell states (zero tensors)
  hState = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  cState = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  console.log('✅ Silero VAD model loaded');
};

/**
 * Convert a Buffer of raw 16-bit PCM to Float32Array normalised to [-1, 1].
 */
const pcmBufferToFloat32 = (buffer) => {
  const float32 = new Float32Array(buffer.length / 2);
  for (let i = 0; i < float32.length; i++) {
    float32[i] = buffer.readInt16LE(i * 2) / 32768.0;
  }
  return float32;
};

/**
 * Silero VAD Service
 * Detects speech activity from raw PCM audio data.
 */
export const vadService = {
  /**
   * Initialise the VAD model. Call once at startup.
   */
  async init() {
    await loadModel();
  },

  /**
   * Detect if speech is present in a chunk of raw PCM 16-bit mono audio.
   * @param {Buffer} pcmBuffer - Raw 16-bit LE PCM at 16 kHz mono.
   * @returns {Promise<boolean>} True if speech detected (probability > 0.5).
   */
  async isSpeechPresent(pcmBuffer) {
    if (!session) {
      // Fallback if model not loaded: assume speech present if buffer has data
      return pcmBuffer && pcmBuffer.length > 0;
    }

    const float32 = pcmBufferToFloat32(pcmBuffer);

    // Pad or truncate to WINDOW_SIZE_SAMPLES
    const windowData = new Float32Array(WINDOW_SIZE_SAMPLES);
    windowData.set(float32.subarray(0, WINDOW_SIZE_SAMPLES));

    const inputTensor = new ort.Tensor('float32', windowData, [1, WINDOW_SIZE_SAMPLES]);
    const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), [1]);

    const feeds = {
      input: inputTensor,
      sr: srTensor,
      h: hState,
      c: cState,
    };

    const results = await session.run(feeds);
    // Update recurrent state
    hState = results.hn;
    cState = results.cn;

    const probability = results.output.data[0];
    return probability > 0.5;
  },

  /**
   * Processes an array of PCM buffers (chunks) and returns only the ones
   * that contain speech – effectively trimming silence.
   * @param {Buffer[]} chunks - Array of PCM audio chunks.
   * @returns {Promise<Buffer[]>} Chunks that contain speech.
   */
  async filterSpeech(chunks) {
    const speechChunks = [];
    for (const chunk of chunks) {
      const hasSpeech = await this.isSpeechPresent(chunk);
      if (hasSpeech) speechChunks.push(chunk);
    }
    return speechChunks;
  },

  /**
   * Reset LSTM hidden/cell states between sessions.
   */
  resetState() {
    if (!session) return;
    hState = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    cState = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  },
};
