import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { InterviewSession } from '../models/InterviewSession.js';
import { log } from '../utils/logger.js';
import { interviewQueue, interviewQueueEvents } from '../queues/interviewQueue.js';
import { generateSttPrompt } from '../config/dsaKeywords.js';
import {
  // Answer integrity
  MIN_ANSWER_WORDS,
  MAX_ANSWER_WORDS,
  countWords,
  truncateToWords,
  isGibberish,
  isLikelyAIGenerated,
  containsPromptInjection,
  containsCodePaste,
  isDuplicateAnswer,
  // Threat scoring
  EVENT_WEIGHTS,
  addWeightedScore,
  getThreatLevel,
  // Sanitisation
  sanitizeCustomPrompt,
  MAX_CUSTOM_PROMPT_LENGTH,
} from '../utils/securityUtils.js';

/**
 * Interview Controller
 *
 * All heavy AI processing (interviewGraph.invoke) is routed through
 * the BullMQ-backed interviewQueue. This allows controlled concurrency
 * (default: 20 concurrent graph invocations) so the LLM/AI service is
 * not overwhelmed under high load (300-500 concurrent students).
 *
 * Edge cases implemented (see ai_interview_edge_cases.md):
 *   Section 1  — Anti-cheating browser behaviour
 *   Section 3  — Audio / STT input integrity
 *   Section 4  — Session lifecycle security
 *   Section 5  — Answer content cheating detection
 *   Section 7  — Rate limiting & abuse prevention
 *   Section 8  — New security events
 *   Section 9  — Weighted threat scoring
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_QUESTIONS_REQUIRED = 5;  // Must match graph.js MIN_QUESTIONS

// ── Helper: enqueue a graph invocation and wait for the result ────────────────
const invokeGraph = async (graphState) => {
    const job = await interviewQueue.add('graph-invoke', { graphState });
    const result = await job.waitUntilFinished(interviewQueueEvents, 120000); // 120s timeout
    return result;
};

// ── Build graph state from DB session ─────────────────────────────────────────
const sessionToState = (session, overrides = {}) => ({
    sessionId: session.sessionId,
    jobRole: session.jobRole,
    interviewType: session.interviewType,
    candidateProfile: session.candidateProfile || {},
    candidateContext: session.candidateContext || null,
    isIntroQuestion: session.isIntroQuestion !== undefined ? session.isIntroQuestion : true,
    difficultyLevel: session.difficultyLevel || 'intermediate',
    maxQuestions: session.maxQuestions || 8,
    questionCount: session.questionCount || 0,
    runningScore: session.runningScore || 5,
    followupCount: session.followupCount || 0,
    questionHistory: session.questionHistory || [],
    answerHistory: session.answerHistory || [],
    coveredTopics: session.coveredTopics || [],
    weakAreas: [],
    cheatingEvents: session.cheatingEvents || [],
    transcript: session.transcript || [],
    // Chapter interview fields (now the default mode)
    interviewMode: session.interviewMode || 'chapter',
    customPrompt: session.customPrompt || null,
    chapterTitle: session.chapterTitle || null,
    // Output fields
    currentQuestion: '',
    transcript_text: '',
    currentAnswer: '',
    evaluation: null,
    audio_url: null,
    is_complete: false,
    silence_detected: false,
    error: null,
    backgroundQuestionCount: session.backgroundQuestionCount || 0,
    offTopicWarningCount: session.offTopicWarningCount || 0,
    silenceViolationCount: session.silenceViolationCount || 0,
    ...overrides,
});

// ── Persist graph output back to DB ──────────────────────────────────────────
const persist = async (session, out) => {
    const update = {};
    if (out.candidateContext !== undefined) update.candidateContext = out.candidateContext;
    if (out.isIntroQuestion !== undefined) update.isIntroQuestion = out.isIntroQuestion;
    if (out.difficultyLevel) update.difficultyLevel = out.difficultyLevel;
    if (out.runningScore !== undefined) update.runningScore = out.runningScore;
    if (out.questionCount !== undefined) update.questionCount = out.questionCount;
    if (out.followupCount !== undefined) update.followupCount = out.followupCount;
    if (out.questionHistory) update.questionHistory = out.questionHistory;
    if (out.answerHistory) update.answerHistory = out.answerHistory;
    if (out.transcript) update.transcript = out.transcript;
    if (out.coveredTopics) update.coveredTopics = out.coveredTopics;
    if (out.backgroundQuestionCount !== undefined) update.backgroundQuestionCount = out.backgroundQuestionCount;
    if (out.offTopicWarningCount !== undefined) update.offTopicWarningCount = out.offTopicWarningCount;
    if (out.silenceViolationCount !== undefined) update.silenceViolationCount = out.silenceViolationCount;
    // ── Bug Fix: persist cheatingEvents from graph-level detections ───────────
    // Events like PROFANITY_DETECTED, parrot echo etc. are set inside graph nodes
    // and must be written back to DB on each response so they survive HTTP boundaries.
    if (out.cheatingEvents && out.cheatingEvents.length > 0) {
        update.cheatingEvents = out.cheatingEvents;
    }

    if (out.is_complete) {
        update.interviewStage = 'FINAL_EVALUATION';
        update.endTime = new Date();
    }

    await InterviewSession.findOneAndUpdate(
        { sessionId: session.sessionId },
        { $set: update },
        { new: true }
    );
};

// ── Helper: safely parse JSON, return null on failure ────────────────────────
const safeJsonParse = (str, label = 'JSON') => {
    if (!str) return null;
    try {
        return typeof str === 'string' ? JSON.parse(str) : str;
    } catch (e) {
        log.warn(`[safeJsonParse] Failed to parse ${label}: ${e.message}`);
        return null;
    }
};

// ── Helper: initialise securityMetrics if missing ────────────────────────────
const ensureSecurityMetrics = (session) => {
    if (!session.securityMetrics) {
        session.securityMetrics = {
            tabSwitchCount: 0, copyAttemptCount: 0, refreshAttemptCount: 0,
            rightClickAttemptCount: 0, devToolsAttemptCount: 0, backNavigationAttempts: 0,
            multiSpeakerCount: 0, multiFaceCount: 0, noFaceCount: 0, gazeDeviationCount: 0,
            aiAnswerSuspicionCount: 0, duplicateAnswerCount: 0, suspiciousAnswerCount: 0,
            promptInjectionCount: 0, printAttemptCount: 0, micDisconnectCount: 0,
            profanityCount: 0,
            totalSuspiciousEvents: 0, weightedSuspicionScore: 0,
            suspicionThreatLevel: 'clean', protectionEnabled: false,
            protectionStartTime: null, lastSuspiciousEventTime: null,
        };
    }
};

// ── Helper: log a cheating event and update metrics ──────────────────────────
/**
 * logCheatingEvent
 * Records an event, updates the relevant counter, increments weightedSuspicionScore,
 * updates suspicionThreatLevel, and returns the new threat level.
 *
 * @param {Object} session - Mongoose session document (mutable)
 * @param {string} event - Event name (must match EVENT_WEIGHTS key)
 * @param {Object} metadata - Extra context to store
 * @returns {string} - Current threat level: 'clean' | 'warning' | 'flag' | 'terminate'
 */
const logCheatingEvent = (session, event, metadata = {}) => {
    ensureSecurityMetrics(session);

    // Append to cheatingEvents array
    session.cheatingEvents = [
        ...(session.cheatingEvents || []),
        { event, timestamp: new Date(), metadata },
    ];

    // Map event to the appropriate counter field
    const COUNTER_MAP = {
        TAB_SWITCH_AWAY: 'tabSwitchCount',
        TAB_SWITCH_BACK: 'tabSwitchCount',
        WINDOW_FOCUS_LOST: 'tabSwitchCount',
        WINDOW_FOCUS_REGAINED: 'tabSwitchCount',
        LONG_ABSENCE: 'tabSwitchCount',
        COPY_ATTEMPT_BLOCKED: 'copyAttemptCount',
        CUT_ATTEMPT_BLOCKED: 'copyAttemptCount',
        PASTE_ATTEMPT_BLOCKED: 'copyAttemptCount',
        CTRL_C_BLOCKED: 'copyAttemptCount',
        CODE_PASTED_IN_TEXT: 'suspiciousAnswerCount',
        PAGE_REFRESH_ATTEMPT: 'refreshAttemptCount',
        REFRESH_HOTKEY_BLOCKED: 'refreshAttemptCount',
        RIGHT_CLICK_BLOCKED: 'rightClickAttemptCount',
        DEVTOOLS_ATTEMPT_BLOCKED: 'devToolsAttemptCount',
        DEVTOOLS_CONTEXT_MENU_BLOCKED: 'devToolsAttemptCount',
        BACK_BUTTON_ATTEMPT: 'backNavigationAttempts',
        BACK_NAVIGATION_BLOCKED: 'backNavigationAttempts',
        PRINT_ATTEMPT: 'printAttemptCount',
        MULTIPLE_SPEAKERS_DETECTED: 'multiSpeakerCount',
        MULTIPLE_FACES_DETECTED: 'multiFaceCount',
        FACE_NOT_DETECTED: 'noFaceCount',
        GAZE_DEVIATION: 'gazeDeviationCount',
        MICROPHONE_DISCONNECTED: 'micDisconnectCount',
        AI_GENERATED_ANSWER_SUSPECTED: 'aiAnswerSuspicionCount',
        DUPLICATE_ANSWER_DETECTED: 'duplicateAnswerCount',
        ANSWER_TOO_LONG: 'suspiciousAnswerCount',
        PROMPT_INJECTION_ATTEMPT: 'promptInjectionCount',
        PROFANITY_DETECTED: 'profanityCount',
    };

    const counterKey = COUNTER_MAP[event];
    if (counterKey && session.securityMetrics[counterKey] !== undefined) {
        session.securityMetrics[counterKey]++;
    }

    // Increment total events (skip admin/system events with weight 0)
    if ((EVENT_WEIGHTS[event] ?? 1) > 0) {
        session.securityMetrics.totalSuspiciousEvents++;
    }

    // Update weighted score
    session.securityMetrics.weightedSuspicionScore = addWeightedScore(
        session.securityMetrics.weightedSuspicionScore,
        event
    );
    session.securityMetrics.lastSuspiciousEventTime = new Date();

    // Recalculate threat level
    const level = getThreatLevel(session.securityMetrics.weightedSuspicionScore);
    session.securityMetrics.suspicionThreatLevel = level;

    log.info(`🚨 Security Event [${event}] | Score: ${session.securityMetrics.weightedSuspicionScore} | Level: ${level}`, metadata);
    return level;
};

// ── Helper: run answer integrity checks before invoking graph ─────────────────
/**
 * checkAnswerIntegrity
 * Runs all answer-level anti-cheat heuristics.
 * Returns { shouldRouteSilence, shouldTerminate, flaggedEvents, cleanedAnswer }
 *
 * @param {string} answer - Raw candidate answer text
 * @param {Object} session - Mongoose session document (mutable, for logging events)
 */
const checkAnswerIntegrity = (answer = '', session) => {
    const flaggedEvents = [];
    let cleanedAnswer = answer;
    let shouldRouteSilence = false;
    let shouldTerminate = false;

    const wc = countWords(answer);

    // ── Edge Case 3.6 / 6.5 / 6.6: Too short or empty → route to silence ──────
    if (wc < MIN_ANSWER_WORDS) {
        log.warn(`[AnswerIntegrity] Answer has only ${wc} words (<${MIN_ANSWER_WORDS}) — routing to silence.`);
        shouldRouteSilence = true;
        return { shouldRouteSilence, shouldTerminate, flaggedEvents, cleanedAnswer };
    }

    // ── Edge Case 3.8: Gibberish detection ──────────────────────────────────────
    if (isGibberish(answer)) {
        log.warn('[AnswerIntegrity] Gibberish detected — routing to silence.');
        shouldRouteSilence = true;
        return { shouldRouteSilence, shouldTerminate, flaggedEvents, cleanedAnswer };
    }

    // ── Edge Case 5.7 / 4.9: Prompt injection attempt ───────────────────────────
    const injectionMatch = containsPromptInjection(answer);
    if (injectionMatch) {
        log.warn(`[AnswerIntegrity] Prompt injection detected: "${injectionMatch}"`);
        const level = logCheatingEvent(session, 'PROMPT_INJECTION_ATTEMPT', { match: injectionMatch });
        flaggedEvents.push('PROMPT_INJECTION_ATTEMPT');
        if (level === 'terminate') shouldTerminate = true;
    }

    // ── Edge Case 3.10 / 7: Answer too long → truncate + flag ───────────────────
    if (wc > MAX_ANSWER_WORDS) {
        log.warn(`[AnswerIntegrity] Answer too long (${wc} words). Truncating to ${MAX_ANSWER_WORDS}.`);
        cleanedAnswer = truncateToWords(answer, MAX_ANSWER_WORDS);
        logCheatingEvent(session, 'ANSWER_TOO_LONG', { originalWordCount: wc });
        flaggedEvents.push('ANSWER_TOO_LONG');
    }

    // ── Edge Case 5.2 / 5.3: AI-generated answer heuristic ─────────────────────
    if (isLikelyAIGenerated(cleanedAnswer)) {
        log.warn('[AnswerIntegrity] Answer may be AI-generated (no fillers, long, structured).');
        logCheatingEvent(session, 'AI_GENERATED_ANSWER_SUSPECTED', { wordCount: wc });
        flaggedEvents.push('AI_GENERATED_ANSWER_SUSPECTED');
    }

    // ── Edge Case 5.5: Code paste in text field ──────────────────────────────────
    if (containsCodePaste(cleanedAnswer)) {
        log.warn('[AnswerIntegrity] Code block paste detected in text answer.');
        logCheatingEvent(session, 'CODE_PASTED_IN_TEXT', { wordCount: wc });
        flaggedEvents.push('CODE_PASTED_IN_TEXT');
    }

    // ── Edge Case 3.8: Duplicate answer ──────────────────────────────────────────
    if (session.answerHistory?.length > 0 && isDuplicateAnswer(cleanedAnswer, session.answerHistory)) {
        log.warn('[AnswerIntegrity] Duplicate answer detected (≥85% similarity to a recent answer).');
        logCheatingEvent(session, 'DUPLICATE_ANSWER_DETECTED', {});
        flaggedEvents.push('DUPLICATE_ANSWER_DETECTED');
    }

    return { shouldRouteSilence, shouldTerminate, flaggedEvents, cleanedAnswer };
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/start
// ═════════════════════════════════════════════════════════════════════════════
export const startInterview = async (req, res) => {
    try {
        const {
            userId, jobRole,
            interviewType = 'technical',
            difficulty = 'intermediate',
            maxQuestions = 8,
            interviewMode = 'generic',
            customPrompt = null,
            lectureId = null,
            chapterTitle = null,
            courseTitle = null,
        } = req.body;

        // ── Edge Case 4.3: userId required ──────────────────────────────────────
        if (!userId || !jobRole) {
            return res.status(400).json({ error: 'userId and jobRole are required' });
        }

        // ── Edge Case 4.8: Validate maxQuestions ────────────────────────────────
        if (maxQuestions < MIN_QUESTIONS_REQUIRED || maxQuestions > 50) {
            return res.status(400).json({
                error: `maxQuestions must be between ${MIN_QUESTIONS_REQUIRED} and 50.`,
            });
        }

        // ── Chapter mode: customPrompt required ─────────────────────────────────
        if (interviewMode === 'chapter' && !customPrompt) {
            return res.status(400).json({ error: 'customPrompt is required for chapter interviews' });
        }

        // ── Edge Case 4.9: Sanitize customPrompt (prevent prompt injection) ──────
        const safePrompt = customPrompt ? sanitizeCustomPrompt(customPrompt) : null;
        if (customPrompt && safePrompt !== customPrompt) {
            log.warn(`[StartInterview] customPrompt was sanitized for userId: ${userId}`);
        }

        // ── Edge Case 7.5: customPrompt length guard (already trimmed by sanitizer, but double-check) ─
        if (safePrompt && safePrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
            return res.status(400).json({ error: `customPrompt must not exceed ${MAX_CUSTOM_PROMPT_LENGTH} characters.` });
        }

        const sessionId = uuidv4();
        const session = await InterviewSession.create({
            sessionId, userId, jobRole, interviewType,
            candidateProfile: { jobRole, userId, interviewType, difficulty },
            difficultyLevel: difficulty,
            maxQuestions,
            isIntroQuestion: true,
            runningScore: 5,
            questionCount: 0,
            followupCount: 0,
            coveredTopics: [],
            questionHistory: [],
            answerHistory: [],
            transcript: [],
            interviewStage: 'INTRODUCTION',
            interviewMode,
            customPrompt: safePrompt,
            lectureId,
            chapterTitle: chapterTitle || jobRole,
            courseTitle,
            offTopicWarningCount: 0,
            silenceViolationCount: 0,
        });

        log.info(`Starting session: ${sessionId} | ${jobRole} | mode: ${interviewMode}`);

        // Queued: mode='start' → generate_question → ask_question → END
        const out = await invokeGraph(sessionToState(session, { mode: 'start' }));
        await persist(session, out);

        return res.status(201).json({
            sessionId,
            firstQuestion: out.currentQuestion,
            audioUrl: out.audio_url,
            phase: 'INTRO',
            interviewMode,
            chapterTitle: chapterTitle || jobRole,
        });
    } catch (err) {
        log.error('startInterview', err);
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/answer (text)
// ═════════════════════════════════════════════════════════════════════════════
export const submitTextAnswer = async (req, res) => {
    try {
        const { sessionId, answerText, codeContext, userId } = req.body;

        if (!sessionId || !answerText) {
            return res.status(400).json({ error: 'sessionId and answerText required' });
        }

        // ── Edge Case 7.4: Safe JSON parse of codeContext ────────────────────────
        const parsedCodeContext = safeJsonParse(codeContext, 'codeContext');
        if (codeContext && parsedCodeContext === null) {
            return res.status(400).json({ error: 'codeContext must be valid JSON' });
        }

        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // ── Edge Case 4.3: Validate userId matches session owner ─────────────────
        if (userId && session.userId && userId !== session.userId.toString()) {
            log.warn(`[Auth] userId mismatch on /answer — expected ${session.userId}, got ${userId}`);
            return res.status(403).json({ error: 'Unauthorized: userId does not match session owner' });
        }

        // ── Edge Case 4.2: Block submissions after interview complete ─────────────
        if (session.interviewStage === 'FINAL_EVALUATION' || session.interviewStage === 'END') {
            return res.status(409).json({ error: 'Interview is already complete. No more answers accepted.' });
        }

        log.info(`📝 Text answer for session: ${sessionId}`);

        // ── Edge Cases 3.6–3.10 / 5.2–5.7: Answer integrity checks ──────────────
        const { shouldRouteSilence, shouldTerminate, flaggedEvents, cleanedAnswer } =
            checkAnswerIntegrity(answerText, session);

        // Persist any flagged events immediately
        if (flaggedEvents.length > 0) {
            await session.save();
        }

        // Edge Case 5.7: Prompt injection → immediate termination
        if (shouldTerminate) {
            session.interviewStage = 'END';
            session.endTime = new Date();
            await session.save();
            return res.status(403).json({
                error: 'Interview terminated due to a policy violation (prompt injection attempt).',
                isComplete: true,
            });
        }

        // Edge Case 3.6 / 3.7 / 3.8: Too short / gibberish → route to silence nudge
        if (shouldRouteSilence) {
            // Increment silence violation count and invoke silence nudge graph path
            const silenceOut = await invokeGraph(sessionToState(session, { mode: 'silence' }));
            await persist(session, silenceOut);
            return res.json({
                nextQuestion: silenceOut.currentQuestion,
                audioUrl: silenceOut.audio_url,
                isComplete: silenceOut.is_complete,
                silenceDetected: true,
            });
        }

        // Invoke graph with the cleaned answer
        const out = await invokeGraph(
            sessionToState(session, {
                mode: 'answer',
                currentAnswer: cleanedAnswer,
                codeContext: parsedCodeContext,
            })
        );

        await persist(session, out);

        return res.json({
            nextQuestion: out.currentQuestion,
            audioUrl: out.audio_url,
            evaluation: out.evaluation,
            isComplete: out.is_complete,
            difficultyLevel: out.difficultyLevel,
            questionNumber: out.questionCount,
            totalQuestions: out.maxQuestions,
            phase: out.isIntroQuestion === false && out.questionCount === 0 ? 'INTRO' : 'TECHNICAL',
            securityFlags: flaggedEvents.length > 0 ? flaggedEvents : undefined,
        });
    } catch (err) {
        log.error('submitTextAnswer', err);
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/audio
// ═════════════════════════════════════════════════════════════════════════════
export const processAudio = async (req, res) => {
    try {
        const { sessionId, userId } = req.body;
        const audioFile = req.file;
        if (!audioFile) return res.status(400).json({ error: 'No audio file provided' });

        // ── Edge Case 7.4: codeContext JSON guard ────────────────────────────────
        const parsedCodeContext = safeJsonParse(req.body.codeContext, 'codeContext');
        if (req.body.codeContext && parsedCodeContext === null) {
            try { fs.unlinkSync(audioFile.path); } catch (_) {}
            return res.status(400).json({ error: 'codeContext must be valid JSON' });
        }

        const session = await InterviewSession.findOne({ sessionId });
        if (!session) {
            try { fs.unlinkSync(audioFile.path); } catch (_) {}
            return res.status(404).json({ error: 'Session not found' });
        }

        // ── Edge Case 4.3: Validate userId matches session owner ─────────────────
        if (userId && session.userId && userId !== session.userId.toString()) {
            log.warn(`[Auth] userId mismatch on /audio — expected ${session.userId}, got ${userId}`);
            try { fs.unlinkSync(audioFile.path); } catch (_) {}
            return res.status(403).json({ error: 'Unauthorized: userId does not match session owner' });
        }

        // ── Edge Case 4.2: Block submissions after interview complete ─────────────
        if (session.interviewStage === 'FINAL_EVALUATION' || session.interviewStage === 'END') {
            try { fs.unlinkSync(audioFile.path); } catch (_) {}
            return res.status(409).json({ error: 'Interview is already complete. No more answers accepted.' });
        }

        // ── Edge Case 6.6: Minimum audio file size (< 1 KB = too short) ──────────
        const fileSizeKb = audioFile.size / 1024;
        if (fileSizeKb < 1) {
            log.warn(`[Audio] File too small (${fileSizeKb.toFixed(2)} KB). Treating as silence.`);
            try { fs.unlinkSync(audioFile.path); } catch (_) {}
            return res.json({ silenceDetected: true, nextQuestion: null, audioUrl: null });
        }

        log.info(`🎙  Audio for session: ${sessionId} (${fileSizeKb.toFixed(1)} KB)`);

        // ── VAD Analysis ─────────────────────────────────────────────────────────
        let transcribedText = '';
        let silenceDetected = false;

        if (audioFile.path && fs.existsSync(audioFile.path)) {
            try {
                const { vadService } = await import('../speech/vad.js');
                const pcm = fs.readFileSync(audioFile.path);
                const hasSpeech = await vadService.isSpeechPresent(pcm);
                vadService.resetState();
                silenceDetected = !hasSpeech;
                log.vadResult(hasSpeech, fileSizeKb);
            } catch (e) {
                log.warn(`VAD skipped: ${e.message}`);
            }
        }

        if (silenceDetected) {
            try { fs.unlinkSync(audioFile.path); } catch (_) {}
            return res.json({ silenceDetected: true, nextQuestion: null, audioUrl: null });
        }

        // ── STT Transcription ────────────────────────────────────────────────────
        try {
            const { sttService } = await import('../speech/stt.js');
            const sttPrompt = generateSttPrompt(session.jobRole || 'developer');
            transcribedText = await sttService.transcribe(audioFile.path, { prompt: sttPrompt });
            log.sttResult(transcribedText);
        } catch (e) {
            log.sttFallback(e.message);
            transcribedText = '';
        }
        try { fs.unlinkSync(audioFile.path); } catch (_) {}

        // ── Edge Case 3.6: Empty STT transcript → silence path (NOT score 0) ─────
        if (!transcribedText || transcribedText.trim() === '' || transcribedText === '[transcription unavailable]') {
            log.warn('[Audio] STT returned empty/unavailable transcript — routing to silence nudge.');
            const silenceOut = await invokeGraph(sessionToState(session, { mode: 'silence' }));
            await persist(session, silenceOut);
            return res.json({
                transcript: '',
                nextQuestion: silenceOut.currentQuestion,
                audioUrl: silenceOut.audio_url,
                isComplete: silenceOut.is_complete,
                silenceDetected: true,
            });
        }

        // ── Edge Cases 3.6–3.10 / 5.x: Answer integrity checks ──────────────────
        const { shouldRouteSilence, shouldTerminate, flaggedEvents, cleanedAnswer } =
            checkAnswerIntegrity(transcribedText, session);

        if (flaggedEvents.length > 0) {
            await session.save();
        }

        // Edge Case 5.7: Prompt injection → terminate
        if (shouldTerminate) {
            session.interviewStage = 'END';
            session.endTime = new Date();
            await session.save();
            return res.status(403).json({
                error: 'Interview terminated due to a policy violation.',
                isComplete: true,
            });
        }

        // Edge Case 3.6 / 3.7 / 3.8: route to silence nudge
        if (shouldRouteSilence) {
            const silenceOut = await invokeGraph(sessionToState(session, { mode: 'silence' }));
            await persist(session, silenceOut);
            return res.json({
                transcript: transcribedText,
                nextQuestion: silenceOut.currentQuestion,
                audioUrl: silenceOut.audio_url,
                isComplete: silenceOut.is_complete,
                silenceDetected: true,
            });
        }

        // ── Invoke graph with cleaned transcribed answer ──────────────────────────
        const out = await invokeGraph(
            sessionToState(session, {
                mode: 'answer',
                currentAnswer: cleanedAnswer,
                codeContext: parsedCodeContext,
            })
        );

        await persist(session, out);

        return res.json({
            transcript: transcribedText,
            nextQuestion: out.currentQuestion,
            audioUrl: out.audio_url,
            evaluation: out.evaluation,
            isComplete: out.is_complete,
            difficultyLevel: out.difficultyLevel,
            questionNumber: out.questionCount,
            totalQuestions: out.maxQuestions,
            phase: 'TECHNICAL',
            securityFlags: flaggedEvents.length > 0 ? flaggedEvents : undefined,
        });
    } catch (err) {
        log.error('processAudio', err);
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/quit
// ═════════════════════════════════════════════════════════════════════════════
export const quitInterview = async (req, res) => {
    try {
        const { sessionId, userId } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // ── Edge Case 4.3: Auth check ─────────────────────────────────────────────
        if (userId && session.userId && userId !== session.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized: userId does not match session owner' });
        }

        const out = await invokeGraph(sessionToState(session, { mode: 'quit' }));
        session.interviewStage = 'END';
        session.endTime = new Date();
        await session.save();

        return res.json({ message: out.currentQuestion, isComplete: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/silence
// ═════════════════════════════════════════════════════════════════════════════
export const handleSilence = async (req, res) => {
    try {
        const { sessionId, userId } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // ── Edge Case 4.3: Auth check ─────────────────────────────────────────────
        if (userId && session.userId && userId !== session.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // ── Edge Case 4.2: Block if already complete ──────────────────────────────
        if (session.interviewStage === 'FINAL_EVALUATION' || session.interviewStage === 'END') {
            return res.status(409).json({ error: 'Interview is already complete.' });
        }

        log.info(`🤫 Silence detected for session: ${sessionId}. Generating nudge...`);

        const out = await invokeGraph(sessionToState(session, { mode: 'silence' }));
        await persist(session, out);

        return res.json({
            nextQuestion: out.currentQuestion,
            audioUrl: out.audio_url,
            isComplete: out.is_complete,
        });
    } catch (err) {
        log.error('handleSilence', err);
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// GET /interview/state/:sessionId
// ═════════════════════════════════════════════════════════════════════════════
export const getSessionState = async (req, res) => {
    try {
        const session = await InterviewSession.findOne({ sessionId: req.params.sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        return res.json(session);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// GET /interview/result/:sessionId
// ═════════════════════════════════════════════════════════════════════════════
export const getInterviewResult = async (req, res) => {
    try {
        const session = await InterviewSession.findOne({ sessionId: req.params.sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        if (!session.evaluationReport) {
            log.info(`Generating final report for: ${req.params.sessionId}`);
            const out = await invokeGraph(sessionToState(session, { mode: 'finish' }));
            session.evaluationReport = out.evaluation;
            session.finalScore = out.evaluation?.overallScore;
            session.finalRecommendation = out.evaluation?.recommendation;
            session.interviewStage = 'END';
            session.endTime = new Date();
            await session.save();
        }

        return res.json(session.evaluationReport);
    } catch (err) {
        log.error('getInterviewResult', err);
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/enable-protection
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Enable interview protection for a session.
 * Call this when the interview officially starts (client-side proctoring begins).
 */
export const enableProtection = async (req, res) => {
    try {
        const { sessionId, protectionConfig } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        ensureSecurityMetrics(session);
        session.securityMetrics.protectionEnabled = true;
        session.securityMetrics.protectionStartTime = new Date();

        logCheatingEvent(session, 'PROTECTION_ENABLED', { config: protectionConfig });

        await session.save();
        log.info(`✅ Interview protection enabled for session: ${sessionId}`);

        return res.json({
            success: true,
            message: 'Interview protection enabled',
            securityMetrics: session.securityMetrics,
        });
    } catch (err) {
        log.error('enableProtection', err);
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/disable-protection
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Disable interview protection for a session.
 * Call this when the interview completes or user quits.
 */
export const disableProtection = async (req, res) => {
    try {
        const { sessionId, reason } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        ensureSecurityMetrics(session);
        session.securityMetrics.protectionEnabled = false;

        logCheatingEvent(session, 'PROTECTION_DISABLED', { reason: reason || 'unspecified' });

        await session.save();
        log.info(`❌ Interview protection disabled for session: ${sessionId} - Reason: ${reason}`);

        return res.json({
            success: true,
            message: 'Interview protection disabled',
            securityMetrics: session.securityMetrics,
        });
    } catch (err) {
        log.error('disableProtection', err);
        return res.status(500).json({ error: err.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════════
// POST /interview/cheating-event
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Log a suspicious/security event during the interview.
 *
 * All events defined in EVENT_WEIGHTS (securityUtils.js) are accepted.
 * New events added beyond the original list:
 *   - LONG_ABSENCE              (tab away >3 min — computed by client)
 *   - PRINT_ATTEMPT             (Ctrl+P / beforeprint)
 *   - MULTIPLE_SPEAKERS_DETECTED
 *   - MULTIPLE_FACES_DETECTED
 *   - FACE_NOT_DETECTED
 *   - GAZE_DEVIATION
 *   - MICROPHONE_DISCONNECTED
 *   - AI_GENERATED_ANSWER_SUSPECTED (also auto-fired by checkAnswerIntegrity)
 *   - DUPLICATE_ANSWER_DETECTED
 *   - ANSWER_TOO_LONG
 *   - PROMPT_INJECTION_ATTEMPT
 */
export const recordCheatingEvent = async (req, res) => {
    try {
        const { sessionId, event, timestamp, metadata } = req.body;
        if (!sessionId || !event) {
            return res.status(400).json({ error: 'sessionId and event are required' });
        }

        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Use the unified logCheatingEvent helper
        const threatLevel = logCheatingEvent(session, event, {
            ...(metadata || {}),
            reportedAt: timestamp || new Date(),
        });

        // ── Edge Case 1.2: LONG_ABSENCE special handling ─────────────────────────
        // Client should compute duration_away and include it in metadata.
        // We treat tab-switches with >3 min absence as high-severity here.
        if (event === 'TAB_SWITCH_BACK' && metadata?.duration_away_seconds > 180) {
            log.warn(`[Security] Long absence detected: ${metadata.duration_away_seconds}s`);
            logCheatingEvent(session, 'LONG_ABSENCE', {
                duration_away_seconds: metadata.duration_away_seconds,
            });
        }

        // ── Edge Case 2.8: Immediate warning on second MULTIPLE_FACES_DETECTED ────
        if (event === 'MULTIPLE_FACES_DETECTED') {
            const faceCount = session.securityMetrics.multiFaceCount;
            if (faceCount >= 3) {
                log.warn(`[Security] Multiple faces (count=${faceCount}) — auto-terminating: ${sessionId}`);
                session.interviewStage = 'END';
                session.endTime = new Date();
                logCheatingEvent(session, 'INTERVIEW_AUTO_TERMINATED', {
                    reason: 'Multiple faces detected repeatedly',
                    faceCount,
                });
            }
        }

        // ── Weighted threshold: auto-terminate on TERMINATE level ─────────────────
        // Edge Case 9: Replace flat threshold with weighted scoring
        const autoTerminated = threatLevel === 'terminate' && session.interviewStage !== 'END';
        if (autoTerminated) {
            log.warn(`⚠️  Auto-terminating interview ${sessionId} — weighted score: ${session.securityMetrics.weightedSuspicionScore}`);
            session.interviewStage = 'END';
            session.endTime = new Date();
            logCheatingEvent(session, 'INTERVIEW_AUTO_TERMINATED', {
                reason: 'Weighted suspicion score exceeded terminate threshold',
                weightedScore: session.securityMetrics.weightedSuspicionScore,
                threatLevel,
            });
        }

        await session.save();

        return res.json({
            success: true,
            autoTerminated,
            threatLevel,
            weightedSuspicionScore: session.securityMetrics.weightedSuspicionScore,
            securityMetrics: session.securityMetrics,
        });
    } catch (err) {
        log.error('recordCheatingEvent', err);
        return res.status(500).json({ error: err.message });
    }
};
