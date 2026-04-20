/**
 * securityUtils.js
 *
 * Shared security helpers for the AI Interview anti-cheating system.
 * Used by interviewController.js and graph.js.
 *
 * Sections:
 *  1. Word/text utilities
 *  2. Answer integrity checks (gibberish, AI-generated, prompt injection, code-paste)
 *  3. Weighted threat scoring
 *  4. customPrompt sanitiser
 */

// ── 1. Word / Text Utilities ──────────────────────────────────────────────────

/** Count words in a string (splits on whitespace). */
export const countWords = (text = '') =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

/** Truncate text to maxWords words, returning the trimmed version. */
export const truncateToWords = (text = '', maxWords = 800) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + ' [truncated]';
};

// ── 2. Answer Integrity Checks ────────────────────────────────────────────────

/** Minimum spoken words for an answer to be considered real, not silence. */
export const MIN_ANSWER_WORDS = 3;

/** Maximum words before we suspect copy-paste or AI-generated content. */
export const MAX_ANSWER_WORDS = 800;

/**
 * isGibberish
 * Returns true if the answer is keyboard-mashing or completely non-semantic.
 * Heuristic: ratio of recognisable words (3+ chars, alpha-only) to total tokens < 30%.
 */
export const isGibberish = (text = '') => {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return true; // single token is suspicious
  const realWords = tokens.filter((t) => /^[a-zA-Z]{3,}$/.test(t));
  return realWords.length / tokens.length < 0.3;
};

/**
 * isLikelyAIGenerated
 * Heuristic check for AI-generated (ChatGPT/Gemini) text pasted as an answer.
 *
 * Signals:
 *  - Very long (>200 words for a spoken answer)
 *  - Zero spoken fillers ("um", "uh", "you know", "like", "kind of")
 *  - Begins with a structured header or numbered list
 *  - Contains markdown-style formatting (bold, bullets, numbered list)
 */
export const isLikelyAIGenerated = (text = '') => {
  const wc = countWords(text);
  if (wc < 80) return false; // too short to be suspicious

  const fillerPattern = /\b(um+|uh+|you know|like|kind of|sort of|basically|right\?|actually|I mean)\b/gi;
  const fillerMatches = (text.match(fillerPattern) || []).length;

  const hasMarkdown =
    /^#{1,3}\s/m.test(text) ||        // ## heading
    /^\d+\.\s/m.test(text) ||          // 1. numbered list
    /^\s*[-*]\s/m.test(text) ||        // bullet points
    /\*\*[^*]+\*\*/m.test(text);       // **bold**

  const hasNoFillers = fillerMatches === 0;

  // Needs ≥ 2 of the 3 signals to flag
  let signals = 0;
  if (wc > 200) signals++;
  if (hasNoFillers) signals++;
  if (hasMarkdown) signals++;

  return signals >= 2;
};

/**
 * containsPromptInjection
 * Detects attempts to override the interviewer AI's instructions.
 * Returns the matched pattern string, or null if clean.
 */
export const containsPromptInjection = (text = '') => {
  const patterns = [
    /ignore (your|previous|all|the above|prior) instructions?/i,
    /disregard (your|previous|all|the above) (instructions?|context|prompt)/i,
    /you are now (a|an|my)/i,
    /act as (if|a|an|my|the)/i,
    /forget everything/i,
    /new (system|persona|role|instruction|prompt)/i,
    /\bsystem\s*:/i,
    /\bHuman\s*:/i,
    /<INST>/i,
    /###\s*(instruction|system|override)/i,
    /DAN (prompt|mode|jailbreak)/i,
    /jailbreak/i,
    /pretend (you are|to be|that you)/i,
    /override (your|the) (system|instructions?|prompt)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
};

/**
 * containsCodePaste
 * Detects whether the answer is primarily a large code block pasted into a text field.
 * Signals: triple backtick fence, OR ≥3 lines starting with standard code indentation
 * alongside keywords like function/class/const/def/import.
 */
export const containsCodePaste = (text = '') => {
  if (/```[\s\S]*?```/.test(text)) return true;

  const lines = text.split('\n');
  const indentedCodeLines = lines.filter(
    (l) => /^(\t| {4})/.test(l) && /\b(function|class|const|let|var|def|import|return|if|for|while)\b/.test(l)
  );
  return indentedCodeLines.length >= 3;
};

/**
 * isDuplicateAnswer
 * Returns true if answerText is ≥ 85% identical to any of the last 3 answers.
 * Uses a simple normalised-string comparison.
 */
export const isDuplicateAnswer = (answerText = '', answerHistory = []) => {
  const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const norm = normalise(answerText);
  const recent = answerHistory.slice(-3).map((a) => normalise(a.answer || ''));

  for (const prev of recent) {
    if (!prev) continue;
    // Levenshtein ratio approximation: use string length overlap as proxy
    const longer = Math.max(norm.length, prev.length);
    if (longer === 0) continue;
    const distance = levenshteinDistance(norm, prev);
    const similarity = 1 - distance / longer;
    if (similarity >= 0.85) return true;
  }
  return false;
};

/** Simple Levenshtein distance (capped at comparing first 500 chars for performance). */
const levenshteinDistance = (a, b) => {
  const s1 = a.slice(0, 500);
  const s2 = b.slice(0, 500);
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        s1[i - 1] === s2[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

// ── 3. Weighted Threat Scoring ────────────────────────────────────────────────

/**
 * EVENT_WEIGHTS
 * Each cheating event type maps to a suspicion weight (0–10).
 * These weights feed into the `weightedSuspicionScore` on the session.
 */
export const EVENT_WEIGHTS = {
  // Tab / window switching
  TAB_SWITCH_AWAY: 1,
  TAB_SWITCH_BACK: 0,          // paired event, no extra weight
  WINDOW_FOCUS_LOST: 1,
  WINDOW_FOCUS_REGAINED: 0,
  LONG_ABSENCE: 5,             // tab away > 3 min

  // Clipboard / copy-paste
  COPY_ATTEMPT_BLOCKED: 2,
  CUT_ATTEMPT_BLOCKED: 2,
  PASTE_ATTEMPT_BLOCKED: 3,
  CTRL_C_BLOCKED: 2,
  CODE_PASTED_IN_TEXT: 3,

  // Browser navigation
  PAGE_REFRESH_ATTEMPT: 2,
  REFRESH_HOTKEY_BLOCKED: 2,
  BACK_BUTTON_ATTEMPT: 1,
  BACK_NAVIGATION_BLOCKED: 1,
  PRINT_ATTEMPT: 3,

  // DevTools / right-click
  RIGHT_CLICK_BLOCKED: 1,
  DEVTOOLS_ATTEMPT_BLOCKED: 3,
  DEVTOOLS_CONTEXT_MENU_BLOCKED: 3,

  // Multi-person / camera
  MULTIPLE_SPEAKERS_DETECTED: 8,
  MULTIPLE_FACES_DETECTED: 6,
  FACE_NOT_DETECTED: 2,
  GAZE_DEVIATION: 2,

  // Audio / microphone
  MICROPHONE_DISCONNECTED: 1,

  // Answer integrity
  AI_GENERATED_ANSWER_SUSPECTED: 5,
  DUPLICATE_ANSWER_DETECTED: 4,
  ANSWER_TOO_LONG: 2,
  PROMPT_INJECTION_ATTEMPT: 10,
  PROFANITY_DETECTED: 4,

  // Admin / system
  PROTECTION_ENABLED: 0,
  PROTECTION_DISABLED: 0,
  INTERVIEW_AUTO_TERMINATED: 0,
};

/** Thresholds for the weighted suspicion score. */
export const THREAT_THRESHOLDS = {
  WARNING: 8,       // Show on-screen warning toast to student
  SOFT_FLAG: 15,    // Flag session for human review (no auto-terminate)
  TERMINATE: 25,    // Auto-terminate the interview
};

/**
 * addWeightedScore
 * Returns the new weighted suspicion score after adding a single event's weight.
 * Capped at 100 to prevent integer overflow in DB.
 */
export const addWeightedScore = (currentScore = 0, eventType = '') => {
  const weight = EVENT_WEIGHTS[eventType] ?? 1;
  return Math.min(currentScore + weight, 100);
};

/**
 * getThreatLevel
 * Returns 'clean' | 'warning' | 'flag' | 'terminate'
 */
export const getThreatLevel = (score = 0) => {
  if (score >= THREAT_THRESHOLDS.TERMINATE) return 'terminate';
  if (score >= THREAT_THRESHOLDS.SOFT_FLAG) return 'flag';
  if (score >= THREAT_THRESHOLDS.WARNING) return 'warning';
  return 'clean';
};

// ── 4. customPrompt Sanitiser ─────────────────────────────────────────────────

/** Max characters allowed in a customPrompt to prevent LLM token overflow. */
export const MAX_CUSTOM_PROMPT_LENGTH = 3000;

/**
 * sanitizeCustomPrompt
 * Strips jailbreak injection patterns from admin-supplied prompts.
 * Returns the cleaned string.
 */
export const sanitizeCustomPrompt = (prompt = '') => {
  let clean = prompt.slice(0, MAX_CUSTOM_PROMPT_LENGTH);

  // Remove common jailbreak prefix patterns
  clean = clean
    .replace(/#{1,6}\s*(SYSTEM|INSTRUCTION|OVERRIDE|IGNORE|JAILBREAK)[^\n]*/gi, '')
    .replace(/SYSTEM\s*:/gi, '')
    .replace(/<INST>/gi, '')
    .replace(/\[INST\]/gi, '')
    .replace(/\bDAN\b/gi, '')
    .replace(/ignore (your|previous|all|prior) instructions?/gi, '')
    .replace(/act as if you are/gi, '')
    .trim();

  return clean;
};
