import { v4 as uuidv4 } from 'uuid';
import { InterviewSession } from '../models/InterviewSession.js';
import { aiService } from '../ai/aiService.js';
import { prompts } from '../prompts/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Determine the next difficulty level based on running score (0-10 scale).
 * - Score > 7.5 → escalate to harder
 * - Score < 4.5 → drop to easier
 * - Otherwise → maintain current
 */
const adaptDifficulty = (currentDifficulty, runningScore) => {
  if (runningScore >= 7.5) {
    if (currentDifficulty === 'entry') return 'intermediate';
    if (currentDifficulty === 'intermediate') return 'senior';
  }
  if (runningScore <= 4.5) {
    if (currentDifficulty === 'senior') return 'intermediate';
    if (currentDifficulty === 'intermediate') return 'entry';
  }
  return currentDifficulty;
};

/**
 * Update running score as a rolling weighted average.
 * More recent scores carry slightly more weight.
 */
const updateRunningScore = (currentAvg, newScore, totalAnswers) => {
  // Weighted: 70% historical + 30% new score after 3+ answers
  if (totalAnswers <= 2) return (currentAvg + newScore) / 2;
  return (currentAvg * 0.7) + (newScore * 0.3);
};

/**
 * Extract covered topics from question history.
 */
const getCoveredTopics = (questionHistory) =>
  questionHistory.map(q => q.topic).filter(Boolean);

/**
 * Get weak areas from answer history (topics where score < 5).
 */
const getWeakAreas = (answerHistory, questionHistory) => {
  const weak = [];
  answerHistory.forEach((a, i) => {
    if (a.score && a.score < 5 && questionHistory[i]?.topic) {
      weak.push(questionHistory[i].topic);
    }
  });
  return [...new Set(weak)]; // deduplicate
};

/**
 * Run TTS (Piper if available) and return audioUrl or null.
 */
const generateTTS = async (text, sessionId) => {
  try {
    const { ttsService } = await import('../speech/tts.js');
    if (ttsService.isAvailable()) {
      const url = await ttsService.speak(text, sessionId);
      return url;
    }
  } catch (e) {
    console.warn('TTS skipped:', e.message);
  }
  return null;
};

// ── START INTERVIEW ────────────────────────────────────────────────────────────
export const startInterview = async (req, res) => {
  try {
    const { userId, jobRole, interviewType = 'technical', difficulty = 'intermediate', maxQuestions = 8 } = req.body;

    if (!userId || !jobRole) {
      return res.status(400).json({ error: 'userId and jobRole are required' });
    }

    const sessionId = uuidv4();
    const candidateProfile = { jobRole, userId, interviewType, difficulty };

    // Generate AI introduction
    const introResponse = await aiService.generateCompletion(
      prompts.INTRODUCTION(jobRole, candidateProfile)
    );

    // Generate the first technical question right away so it's ready
    const firstQ = await aiService.generateCompletion(
      prompts.GENERATE_QUESTION(jobRole, [], [], difficulty, [], 1, maxQuestions)
    );

    // Persist session
    const session = await InterviewSession.create({
      sessionId,
      userId,
      jobRole,
      interviewType,
      candidateProfile,
      difficultyLevel: difficulty,
      maxQuestions,
      runningScore: 5,
      coveredTopics: [],
      followupCount: 0,
      questionCount: 0,
      interviewStage: 'INTRODUCTION',
      transcript: [
        { role: 'interviewer', text: introResponse.text },
      ],
      questionHistory: [],
      answerHistory: [],
    });

    // TTS for introduction
    const audioUrl = await generateTTS(introResponse.text, sessionId);

    return res.status(201).json({
      sessionId,
      firstQuestion: introResponse.text,
      audioUrl,
    });
  } catch (error) {
    console.error('Start Interview Error:', error.message);
    return res.status(500).json({ error: 'Failed to start interview: ' + error.message });
  }
};

// ── CORE ANSWER PROCESSING (shared by text + audio paths) ─────────────────────
const processAnswer = async (session, answerText) => {
  const coveredTopics = getCoveredTopics(session.questionHistory);
  const weakAreas = getWeakAreas(session.answerHistory, session.questionHistory);

  const lastQuestion = session.questionHistory.slice(-1)[0];
  const questionText = lastQuestion?.question || 'Please introduce yourself briefly.';
  const expectedConcepts = lastQuestion?.expectedConcepts || [];
  const difficulty = session.difficultyLevel;

  // ── Step A: Evaluate the answer ───────────────────────────────────────────
  const evaluation = await aiService.generateCompletion(
    prompts.EVALUATE_ANSWER(questionText, answerText, expectedConcepts, difficulty)
  );
  const score = evaluation.score ?? 5;

  // ── Step B: Update running score and adapt difficulty ────────────────────
  const totalAnswers = session.answerHistory.length + 1;
  const newRunningScore = updateRunningScore(session.runningScore, score, totalAnswers);
  const newDifficulty = adaptDifficulty(difficulty, newRunningScore);

  // ── Step C: Decide next action ────────────────────────────────────────────
  const isSessionComplete = session.questionCount >= session.maxQuestions;
  let nextQuestion = null;
  let questionType = 'main';
  let newTopic = null;

  if (isSessionComplete) {
    // End the interview
    nextQuestion = "That concludes our interview. Thank you for your time and thoughtful answers! I'll now prepare your evaluation report.";
  } else if (evaluation.needsFollowup && session.followupCount < 2) {
    // Ask a follow-up to probe the weak area
    const followup = await aiService.generateCompletion(
      prompts.FOLLOWUP_QUESTION(questionText, answerText, evaluation)
    );
    nextQuestion = followup.question;
    newTopic = followup.topic;
    questionType = 'followup';
  } else {
    // Generate a fresh adaptive question
    const newQuestionNum = session.questionCount + 1;
    const nextQ = await aiService.generateCompletion(
      prompts.GENERATE_QUESTION(
        session.jobRole,
        coveredTopics,
        weakAreas,
        newDifficulty,
        session.questionHistory,
        newQuestionNum,
        session.maxQuestions,
      )
    );
    nextQuestion = nextQ.question;
    newTopic = nextQ.topic;
    questionType = 'main';

    // Push next question to history
    session.questionHistory.push({
      question: nextQ.question,
      topic: nextQ.topic,
      difficulty: newDifficulty,
      type: 'main',
      expectedConcepts: nextQ.expectedConcepts,
    });
  }

  // ── Step D: Persist updates ───────────────────────────────────────────────
  // Record the answer
  session.answerHistory.push({
    question: questionText,
    answer: answerText,
    score,
    evaluation,
    timestamp: new Date(),
  });

  // Update transcript
  session.transcript.push({ role: 'candidate', text: answerText });
  session.transcript.push({ role: 'interviewer', text: nextQuestion });

  // Update session state
  session.runningScore = newRunningScore;
  session.difficultyLevel = newDifficulty;
  session.interviewStage = isSessionComplete ? 'FINAL_EVALUATION' : 'WAIT_FOR_ANSWER';

  if (questionType === 'followup') {
    session.followupCount = (session.followupCount || 0) + 1;
    if (newTopic) {
      session.questionHistory.push({
        question: nextQuestion,
        topic: newTopic,
        difficulty: newDifficulty,
        type: 'followup',
      });
    }
  } else if (!isSessionComplete) {
    session.followupCount = 0;
    session.questionCount = (session.questionCount || 0) + 1;
    if (newTopic) session.coveredTopics.addToSet(newTopic);
  }

  await session.save();

  return {
    transcript: answerText,
    evaluation,
    nextQuestion,
    isComplete: isSessionComplete,
    difficultyLevel: newDifficulty,
    questionNumber: session.questionCount,
    totalQuestions: session.maxQuestions,
    questionType,
  };
};

// ── PROCESS AUDIO (VAD → STT → AI → TTS) ─────────────────────────────────────
export const processAudio = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const audioFile = req.file;

    if (!audioFile) return res.status(400).json({ error: 'No audio provided' });

    const session = await InterviewSession.findOne({ sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // ── Step 1: Silero VAD ─────────────────────────────────────────────────
    let hasSpeech = true;
    try {
      const { vadService } = await import('../speech/vad.js');
      const { readFileSync } = await import('fs');
      const pcmBuffer = readFileSync(audioFile.path);
      hasSpeech = await vadService.isSpeechPresent(pcmBuffer);
      vadService.resetState();
    } catch (vadErr) {
      console.warn('VAD skipped:', vadErr.message);
    }

    if (!hasSpeech) {
      const { unlink } = await import('fs/promises');
      try { await unlink(audioFile.path); } catch (_) {}
      return res.json({ silenceDetected: true, nextQuestion: null, audioUrl: null });
    }

    // ── Step 2: Whisper STT ────────────────────────────────────────────────
    let answerText = '';
    try {
      const { sttService } = await import('../speech/stt.js');
      answerText = await sttService.transcribe(audioFile.path);
    } catch (sttErr) {
      console.warn('STT failed:', sttErr.message);
      answerText = '[transcription unavailable]';
    }

    // Cleanup temp audio file
    const { unlink } = await import('fs/promises');
    try { await unlink(audioFile.path); } catch (_) {}

    // ── Step 3: Process with AI engine ────────────────────────────────────
    const result = await processAnswer(session, answerText);

    // ── Step 4: Piper TTS ─────────────────────────────────────────────────
    result.audioUrl = await generateTTS(result.nextQuestion, sessionId);

    return res.json(result);
  } catch (error) {
    console.error('Process Audio Error:', error.message);
    return res.status(500).json({ error: 'Failed to process audio: ' + error.message });
  }
};

// ── SUBMIT TEXT ANSWER ─────────────────────────────────────────────────────────
export const submitTextAnswer = async (req, res) => {
  try {
    const { sessionId, answerText } = req.body;

    if (!sessionId || !answerText) {
      return res.status(400).json({ error: 'sessionId and answerText are required' });
    }

    const session = await InterviewSession.findOne({ sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const result = await processAnswer(session, answerText);

    // TTS for the next question
    result.audioUrl = await generateTTS(result.nextQuestion, sessionId);

    return res.json(result);
  } catch (error) {
    console.error('Submit Answer Error:', error.message);
    return res.status(500).json({ error: 'Failed to process answer: ' + error.message });
  }
};

// ── RECORD CHEATING EVENT ─────────────────────────────────────────────────────
export const recordCheatingEvent = async (req, res) => {
  try {
    const { sessionId, event, timestamp, metadata } = req.body;
    const session = await InterviewSession.findOne({ sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.cheatingEvents = session.cheatingEvents || [];
    session.cheatingEvents.push({ event, timestamp: timestamp || new Date(), metadata });
    await session.save();

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to record event' });
  }
};

// ── GET SESSION STATE ─────────────────────────────────────────────────────────
export const getSessionState = async (req, res) => {
  try {
    const session = await InterviewSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(session);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch state' });
  }
};

// ── GET FINAL INTERVIEW RESULT ────────────────────────────────────────────────
export const getInterviewResult = async (req, res) => {
  try {
    const session = await InterviewSession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (!session.evaluationReport) {
      const result = await aiService.generateCompletion(
        prompts.FINAL_EVALUATION(
          session.jobRole,
          session.interviewType,
          session.answerHistory || [],
          session.cheatingEvents || [],
          session.difficultyLevel,
        )
      );
      session.evaluationReport = result;
      session.finalScore = result.overallScore;
      session.finalRecommendation = result.recommendation;
      session.interviewStage = 'END';
      session.endTime = new Date();
      await session.save();
    }

    return res.json(session.evaluationReport);
  } catch (error) {
    console.error('Get Result Error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch result: ' + error.message });
  }
};
