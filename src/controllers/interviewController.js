import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { InterviewSession } from '../models/InterviewSession.js';
import { log } from '../utils/logger.js';
import { interviewQueue, interviewQueueEvents } from '../queues/interviewQueue.js';
import { generateSttPrompt } from '../config/dsaKeywords.js';

/**
 * Interview Controller
 *
 * All heavy AI processing (interviewGraph.invoke) is now routed through
 * the BullMQ-backed interviewQueue. This allows controlled concurrency
 * (default: 20 concurrent graph invocations) so the LLM/AI service is
 * not overwhelmed under high load (300-500 concurrent students).
 *
 * Graph modes:
 *   'start'  → generate_question (Q0: intro) → ask_question → END
 *   'answer' → evaluate_answer → (followup | generate_question | end_interview) → ask_question → END
 *   'finish' → end_interview → ask_question → END
 *   'quit'   → quit_confirmation → END
 */

// Helper: enqueue a graph invocation and wait for the result
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
    // Chapter interview fields
    interviewMode: session.interviewMode || 'generic',
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

// ── POST /interview/start ─────────────────────────────────────────────────────
export const startInterview = async (req, res) => {
    try {
        const {
            userId, jobRole,
            interviewType = 'technical',
            difficulty = 'intermediate',
            maxQuestions = 8,
            // Chapter interview fields (optional)
            interviewMode = 'generic',
            customPrompt = null,
            lectureId = null,
            chapterTitle = null,
            courseTitle = null,
        } = req.body;

        if (!userId || !jobRole) {
            return res.status(400).json({ error: 'userId and jobRole are required' });
        }

        // For chapter interviews, require a customPrompt
        if (interviewMode === 'chapter' && !customPrompt) {
            return res.status(400).json({ error: 'customPrompt is required for chapter interviews' });
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
            // Chapter interview metadata
            interviewMode,
            customPrompt,
            lectureId,
            chapterTitle: chapterTitle || jobRole,
            courseTitle,
            offTopicWarningCount: 0,
            silenceViolationCount: 0,
        });

        log.info(`Starting session: ${sessionId} | ${jobRole} | mode: ${interviewMode}`);

        // Queued: mode='start' → generate_question (Q0) → ask_question → END
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

// ── POST /interview/answer (text) ─────────────────────────────────────────────
export const submitTextAnswer = async (req, res) => {
    try {
        const { sessionId, answerText, codeContext } = req.body;
        if (!sessionId || !answerText) {
            return res.status(400).json({ error: 'sessionId and answerText required' });
        }

        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        log.info(`📝 Answer for session: ${sessionId}`);

        // Queued: mode='answer' → evaluate_answer → route → ask_question → END
        const out = await invokeGraph(
            sessionToState(session, {
                mode: 'answer',
                currentAnswer: answerText,
                codeContext: codeContext ? JSON.parse(codeContext) : null,
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
        });
    } catch (err) {
        log.error('submitTextAnswer', err);
        return res.status(500).json({ error: err.message });
    }
};

// ── POST /interview/audio ─────────────────────────────────────────────────────
export const processAudio = async (req, res) => {
    try {
        const { sessionId } = req.body;
        const audioFile = req.file;
        if (!audioFile) return res.status(400).json({ error: 'No audio file provided' });

        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        log.info(`🎙  Audio for session: ${sessionId}`);

        // Run VAD + STT synchronously (these are fast; only graph invoke is slow)
        let transcribedText = '';
        let silenceDetected = false;

        if (audioFile.path && fs.existsSync(audioFile.path)) {
            try {
                const { vadService } = await import('../speech/vad.js');
                const pcm = fs.readFileSync(audioFile.path);
                const hasSpeech = await vadService.isSpeechPresent(pcm);
                vadService.resetState();
                silenceDetected = !hasSpeech;
                const kb = fs.statSync(audioFile.path).size / 1024;
                log.vadResult(hasSpeech, kb);
            } catch (e) {
                log.warn(`VAD skipped: ${e.message}`);
            }
        }

        if (silenceDetected) {
            return res.json({ silenceDetected: true, nextQuestion: null, audioUrl: null });
        }

        try {
            const { sttService } = await import('../speech/stt.js');
            
            // Biasing the Whisper STT with DSA keywords to improve recognition of algorithm and data structure terms
            const sttPrompt = generateSttPrompt(session.jobRole || 'developer');
            
            transcribedText = await sttService.transcribe(audioFile.path, { prompt: sttPrompt });
            
            log.sttResult(transcribedText);
        } catch (e) {
            log.sttFallback(e.message);
            transcribedText = '[transcription unavailable]';
        }
        try { fs.unlinkSync(audioFile.path); } catch (_) {}

        // Queued: mode='answer' with the transcribed text
        const out = await invokeGraph(
            sessionToState(session, {
                mode: 'answer',
                currentAnswer: transcribedText,
                codeContext: req.body.codeContext ? JSON.parse(req.body.codeContext) : null,
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
        });
    } catch (err) {
        log.error('processAudio', err);
        return res.status(500).json({ error: err.message });
    }
};

// ── POST /interview/quit ──────────────────────────────────────────────────────
export const quitInterview = async (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Queued: mode='quit' 
        const out = await invokeGraph(sessionToState(session, { mode: 'quit' }));
        session.interviewStage = 'END';
        session.endTime = new Date();
        await session.save();

        return res.json({ message: out.currentQuestion, isComplete: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ── POST /interview/silence ───────────────────────────────────────────────────
export const handleSilence = async (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        log.info(`🤫 Silence detected for session: ${sessionId}. Generating nudge...`);

        // Queued: mode='silence'
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

// ── GET /interview/state/:sessionId ──────────────────────────────────────────
export const getSessionState = async (req, res) => {
    try {
        const session = await InterviewSession.findOne({ sessionId: req.params.sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        return res.json(session);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ── GET /interview/result/:sessionId ─────────────────────────────────────────
export const getInterviewResult = async (req, res) => {
    try {
        const session = await InterviewSession.findOne({ sessionId: req.params.sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        if (!session.evaluationReport) {
            log.info(`Generating final report for: ${req.params.sessionId}`);
            // Queued: mode='finish'
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

// ── POST /interview/enable-protection ────────────────────────────────────────
/**
 * Enable interview protection for a session
 * Call this when the interview officially starts
 */
export const enableProtection = async (req, res) => {
    try {
        const { sessionId, protectionConfig } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Initialize/update security metrics
        if (!session.securityMetrics) {
            session.securityMetrics = {
                tabSwitchCount: 0,
                copyAttemptCount: 0,
                refreshAttemptCount: 0,
                rightClickAttemptCount: 0,
                devToolsAttemptCount: 0,
                backNavigationAttempts: 0,
                totalSuspiciousEvents: 0,
                protectionEnabled: true,
                protectionStartTime: new Date(),
                lastSuspiciousEventTime: null,
            };
        } else {
            session.securityMetrics.protectionEnabled = true;
            session.securityMetrics.protectionStartTime = new Date();
        }

        session.cheatingEvents.push({
            event: 'PROTECTION_ENABLED',
            timestamp: new Date(),
            metadata: { config: protectionConfig },
        });

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

// ── POST /interview/disable-protection ────────────────────────────────────────
/**
 * Disable interview protection for a session
 * Call this when the interview completes or user quits
 */
export const disableProtection = async (req, res) => {
    try {
        const { sessionId, reason } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        if (session.securityMetrics) {
            session.securityMetrics.protectionEnabled = false;
        }

        session.cheatingEvents.push({
            event: 'PROTECTION_DISABLED',
            timestamp: new Date(),
            metadata: { reason: reason || 'unspecified' },
        });

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

// ── POST /interview/cheating-event ────────────────────────────────────────────
/**
 * Log a suspicious/security event during interview
 * 
 * Supported events:
 * - PAGE_REFRESH_ATTEMPT, REFRESH_HOTKEY_BLOCKED
 * - BACK_BUTTON_ATTEMPT, BACK_NAVIGATION_BLOCKED
 * - COPY_ATTEMPT_BLOCKED, CUT_ATTEMPT_BLOCKED, PASTE_ATTEMPT_BLOCKED, CTRL_C_BLOCKED
 * - RIGHT_CLICK_BLOCKED
 * - TAB_SWITCH_AWAY, TAB_SWITCH_BACK, WINDOW_FOCUS_LOST, WINDOW_FOCUS_REGAINED
 * - DEVTOOLS_ATTEMPT_BLOCKED, DEVTOOLS_CONTEXT_MENU_BLOCKED
 */
export const recordCheatingEvent = async (req, res) => {
    try {
        const { sessionId, event, timestamp, metadata } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Initialize security metrics if not present
        if (!session.securityMetrics) {
            session.securityMetrics = {
                tabSwitchCount: 0,
                copyAttemptCount: 0,
                refreshAttemptCount: 0,
                rightClickAttemptCount: 0,
                devToolsAttemptCount: 0,
                backNavigationAttempts: 0,
                totalSuspiciousEvents: 0,
                protectionEnabled: true,
                protectionStartTime: new Date(),
                lastSuspiciousEventTime: null,
            };
        }

        // Add event to cheatingEvents array
        session.cheatingEvents = [...(session.cheatingEvents || []), { event, timestamp: timestamp || new Date(), metadata }];

        // Update security metrics based on event type
        const eventTypeMapping = {
            'TAB_SWITCH_AWAY': 'tabSwitchCount',
            'TAB_SWITCH_BACK': 'tabSwitchCount',
            'WINDOW_FOCUS_LOST': 'tabSwitchCount',
            'WINDOW_FOCUS_REGAINED': 'tabSwitchCount',
            'COPY_ATTEMPT_BLOCKED': 'copyAttemptCount',
            'CUT_ATTEMPT_BLOCKED': 'copyAttemptCount',
            'PASTE_ATTEMPT_BLOCKED': 'copyAttemptCount',
            'CTRL_C_BLOCKED': 'copyAttemptCount',
            'PAGE_REFRESH_ATTEMPT': 'refreshAttemptCount',
            'REFRESH_HOTKEY_BLOCKED': 'refreshAttemptCount',
            'RIGHT_CLICK_BLOCKED': 'rightClickAttemptCount',
            'DEVTOOLS_ATTEMPT_BLOCKED': 'devToolsAttemptCount',
            'DEVTOOLS_CONTEXT_MENU_BLOCKED': 'devToolsAttemptCount',
            'BACK_BUTTON_ATTEMPT': 'backNavigationAttempts',
            'BACK_NAVIGATION_BLOCKED': 'backNavigationAttempts',
        };

        // Increment relevant metric
        const metricKey = eventTypeMapping[event];
        if (metricKey && session.securityMetrics[metricKey] !== undefined) {
            session.securityMetrics[metricKey]++;
        }

        // Update total suspicious events count
        session.securityMetrics.totalSuspiciousEvents++;
        session.securityMetrics.lastSuspiciousEventTime = new Date();

        // Log the event
        log.info(`🚨 Security Event [${event}] for session ${sessionId}`, metadata);

        // Check if we should auto-terminate (multiple suspicious events)
        const shouldAutoTerminate =
            session.securityMetrics.totalSuspiciousEvents > 10 ||
            session.securityMetrics.tabSwitchCount > 5 ||
            session.securityMetrics.copyAttemptCount > 3;

        if (shouldAutoTerminate && session.interviewStage !== 'END') {
            log.warn(`⚠️ Auto-terminating interview ${sessionId} due to excessive suspicious activity`);
            session.interviewStage = 'END';
            session.endTime = new Date();
            session.cheatingEvents.push({
                event: 'INTERVIEW_AUTO_TERMINATED',
                timestamp: new Date(),
                metadata: { reason: 'Excessive suspicious activity', totalEvents: session.securityMetrics.totalSuspiciousEvents },
            });
        }

        await session.save();
        return res.json({ 
            success: true,
            autoTerminated: shouldAutoTerminate,
            securityMetrics: session.securityMetrics,
        });
    } catch (err) {
        log.error('recordCheatingEvent', err);
        return res.status(500).json({ error: err.message });
    }
};
