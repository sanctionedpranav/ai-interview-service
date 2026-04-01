import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { InterviewSession } from '../models/InterviewSession.js';
import { log } from '../utils/logger.js';
import { interviewQueue, interviewQueueEvents } from '../queues/interviewQueue.js';

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
    if (out.candidateContext !== undefined) session.candidateContext = out.candidateContext;
    if (out.isIntroQuestion !== undefined) session.isIntroQuestion = out.isIntroQuestion;
    if (out.difficultyLevel) session.difficultyLevel = out.difficultyLevel;
    if (out.runningScore !== undefined) session.runningScore = out.runningScore;
    if (out.questionCount !== undefined) session.questionCount = out.questionCount;
    if (out.followupCount !== undefined) session.followupCount = out.followupCount;
    if (out.questionHistory) session.questionHistory = out.questionHistory;
    if (out.answerHistory) session.answerHistory = out.answerHistory;
    if (out.transcript) session.transcript = out.transcript;
    if (out.coveredTopics) session.coveredTopics = out.coveredTopics;
    if (out.backgroundQuestionCount !== undefined) session.backgroundQuestionCount = out.backgroundQuestionCount;
    if (out.offTopicWarningCount !== undefined) session.offTopicWarningCount = out.offTopicWarningCount;
    if (out.silenceViolationCount !== undefined) session.silenceViolationCount = out.silenceViolationCount;
    if (out.is_complete) {
        session.interviewStage = 'FINAL_EVALUATION';
        session.endTime = new Date();
    }
    await session.save();
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
            
            // Biasing the Whisper STT with a technical prompt to reduce hallucination and fix jargon/accent recognition
            const sttPrompt = `Technical software engineering interview for ${session.jobRole || 'developer'}. Topics: programming, system design, frontend, backend, API, React, Node.js, Javascript, databases, scalability, cloud, AWS, UI, UX, algorithms, data structures. Includes candidate answering questions naturally.`;
            
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

// ── POST /interview/cheating-event ────────────────────────────────────────────
export const recordCheatingEvent = async (req, res) => {
    try {
        const { sessionId, event, timestamp, metadata } = req.body;
        const session = await InterviewSession.findOne({ sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        session.cheatingEvents = [...(session.cheatingEvents || []), { event, timestamp: timestamp || new Date(), metadata }];
        await session.save();
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
