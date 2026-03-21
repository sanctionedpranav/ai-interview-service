import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, '../../error.log');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const COLORS = {
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const icons = {
  start: '🚀',
  vad: '🔊',
  stt: '🎤',
  ai: '🧠',
  question: '❓',
  followup: '🔁',
  tts: '🔈',
  result: '📊',
  success: '✅',
  warn: '⚠️ ',
  error: '❌',
  info: 'ℹ️ ',
  separator: '═',
};

const timestamp = () => {
  const now = new Date();
  return `${DIM}${now.toISOString().split('T')[1].split('.')[0]}${RESET}`;
};

const separator = (label = '', color = COLORS.cyan) => {
  const line = icons.separator.repeat(50);
  if (label) {
    console.log(`\n${color}${BOLD}${line}${RESET}`);
    console.log(`${color}${BOLD}  ${label}${RESET}`);
    console.log(`${color}${BOLD}${line}${RESET}`);
  } else {
    console.log(`${DIM}${line}${RESET}`);
  }
};

export const log = {
  // ── LangGraph Node Logs ─────────────────────────────────────────────────────

  graphStart: (sessionId, mode) => {
    separator(`[LangGraph] ${mode.toUpperCase()} — Session: ${sessionId?.slice(0, 8)}`, COLORS.magenta);
  },

  node: (nodeName, details = '') => {
    const nodeColors = {
      introduction: COLORS.cyan,
      vad_check: COLORS.blue,
      stt_transcribe: COLORS.green,
      evaluate_answer: COLORS.yellow,
      generate_question: COLORS.magenta,
      followup_question: COLORS.magenta,
      tts_speak: COLORS.cyan,
      final_evaluation: COLORS.red,
    };
    const color = nodeColors[nodeName] || COLORS.white;
    const nodeIcons = {
      introduction: icons.start,
      vad_check: icons.vad,
      stt_transcribe: icons.stt,
      evaluate_answer: icons.ai,
      generate_question: icons.question,
      followup_question: icons.followup,
      tts_speak: icons.tts,
      final_evaluation: icons.result,
    };
    const icon = nodeIcons[nodeName] || icons.info;
    console.log(`\n${timestamp()} ${icon}  ${color}${BOLD}[${nodeName}]${RESET}${details ? ` ${DIM}${details}${RESET}` : ''}`);
  },

  // ── VAD ─────────────────────────────────────────────────────────────────────
  vadResult: (hasSpeech, fileSizeKb) => {
    const color = hasSpeech ? COLORS.green : COLORS.yellow;
    const label = hasSpeech ? `${icons.success} Speech detected` : `${icons.warn} Silence detected`;
    console.log(`     ${color}${label}${RESET}   ${DIM}file: ${fileSizeKb.toFixed(1)} KB${RESET}`);
  },

  // ── STT ─────────────────────────────────────────────────────────────────────
  sttResult: (text) => {
    const preview = text?.slice(0, 120) + (text?.length > 120 ? '...' : '');
    console.log(`     ${COLORS.green}${icons.success} Transcript:${RESET} "${preview}"`);
  },

  sttFallback: (reason) => {
    console.log(`     ${COLORS.yellow}${icons.warn} STT skipped: ${reason}${RESET}`);
  },

  // ── Evaluate ─────────────────────────────────────────────────────────────────
  evaluateResult: (score, rating, needsFollowup, newDifficulty) => {
    const scoreColor = score >= 7 ? COLORS.green : score >= 5 ? COLORS.yellow : COLORS.red;
    console.log(`     ${scoreColor}Score: ${BOLD}${score}/10${RESET}  ${DIM}(${rating})${RESET}`);
    console.log(`     Difficulty → ${COLORS.cyan}${BOLD}${newDifficulty}${RESET}`);
    if (needsFollowup) {
      console.log(`     ${COLORS.yellow}${icons.followup} Follow-up needed${RESET}`);
    }
  },

  // ── Question ─────────────────────────────────────────────────────────────────
  questionGenerated: (question, topic, type = 'main') => {
    const label = type === 'followup' ? `${icons.followup} Follow-up` : `${icons.question} Question`;
    console.log(`     ${COLORS.magenta}${label}${RESET} [${DIM}${topic}${RESET}]`);
    console.log(`     ${BOLD}"${question?.slice(0, 100)}${question?.length > 100 ? '...' : ''}"${RESET}`);
  },

  // ── TTS ─────────────────────────────────────────────────────────────────────
  ttsResult: (audioUrl) => {
    if (audioUrl) {
      console.log(`     ${COLORS.green}${icons.success} Piper TTS: ${DIM}${audioUrl}${RESET}`);
    } else {
      console.log(`     ${COLORS.blue}${icons.info} Browser TTS fallback (Piper not installed)${RESET}`);
    }
  },

  // ── General ─────────────────────────────────────────────────────────────────
  success: (msg) => console.log(`${timestamp()} ${icons.success} ${COLORS.green}${msg}${RESET}`),
  warn: (msg) => console.log(`${timestamp()} ${icons.warn} ${COLORS.yellow}${msg}${RESET}`),
  error: (msg, err) => {
    const time = new Date().toISOString();
    const errorMsg = `${time} [ERROR] ${msg}: ${err?.message || err || 'Unknown Error'}\n${err?.stack || ''}\n`;
    fs.appendFileSync(LOG_FILE, errorMsg);
    console.error(`${timestamp()} ${icons.error} ${COLORS.red}${msg}${RESET}`, err?.message || '');
  },
  info: (msg) => console.log(`${timestamp()} ${icons.info} ${COLORS.cyan}${msg}${RESET}`),

  // ── Session summary (printed after each answer cycle) ───────────────────────
  sessionSummary: (questionCount, maxQuestions, runningScore, difficultyLevel, coveredTopics) => {
    separator('Session State', COLORS.gray);
    console.log(`  Q Progress : ${COLORS.cyan}${questionCount} / ${maxQuestions}${RESET}`);
    console.log(`  Avg Score  : ${COLORS.yellow}${runningScore.toFixed(1)}/10${RESET}`);
    console.log(`  Difficulty : ${COLORS.magenta}${difficultyLevel}${RESET}`);
    console.log(`  Topics     : ${DIM}${coveredTopics?.slice(-5).join(', ') || 'none'}${RESET}`);
    separator('', COLORS.gray);
  },
};
