/**
 * AI Interview LangGraph
 *
 * Graph structure (matches user spec):
 *
 *   START
 *     │
 *     ▼
 *   [mode=start]  introduction → generate_question (Q1: "Tell me about yourself")
 *   [mode=answer] evaluate_answer → ...
 *   [mode=finish] end_interview
 *   [mode=quit]   quit_confirmation
 *
 *   Main loop (per HTTP request):
 *
 *   generate_question
 *       │
 *       ▼
 *   ask_question  ─────────────────────────── END (returns to HTTP)
 *       │ (next request brings back answer)
 *       ▼
 *   evaluate_answer
 *       │
 *       ├── followup_question → ask_question → END
 *       ├── generate_question (loop)
 *       ├── end_interview → ask_question → END
 *       └── quit_confirmation → END
 *
 * Note: wait_for_answer is the HTTP boundary — the graph pauses at END
 * and the next POST /answer call re-enters at evaluate_answer.
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import fs from 'fs';
import { aiService } from '../ai/aiService.js';
import { prompts } from '../prompts/index.js';
import { chapterPrompts } from '../prompts/chapterInterview.js';
import { log } from '../utils/logger.js';

// ── State ──────────────────────────────────────────────────────────────────────
const merge = (left, right) => right ?? left;

const STATE_CHANNELS = {
  // Control
  mode: { value: merge, default: () => 'start' },
  // 'start' | 'answer' | 'finish' | 'quit' | 'silence'

  sessionId: { value: merge, default: () => null },
  jobRole: { value: merge, default: () => '' },
  interviewType: { value: merge, default: () => 'technical' },
  candidateProfile: { value: merge, default: () => ({}) },

  // Candidate context — built up from their intro answer
  candidateContext: { value: merge, default: () => null },

  // Answer being processed (set by controller before invoking)
  currentAnswer: { value: merge, default: () => '' },
  audioPath: { value: merge, default: () => null },
  codeContext: { value: merge, default: () => null }, // Added for HackerRank code evaluation

  // Adaptive state
  difficultyLevel: { value: merge, default: () => 'intermediate' },
  maxQuestions: { value: merge, default: () => 8 },
  questionCount: { value: merge, default: () => 0 },
  runningScore: { value: merge, default: () => 5 },
  followupCount: { value: merge, default: () => 0 },
  isIntroQuestion: { value: merge, default: () => true }, // true for Q0 (tell me about yourself)

  // History
  questionHistory: { value: merge, default: () => [] },
  answerHistory: { value: merge, default: () => [] },
  coveredTopics: { value: merge, default: () => [] },
  weakAreas: { value: merge, default: () => [] },
  cheatingEvents: { value: merge, default: () => [] },
  transcript: { value: merge, default: () => [] },

  // Off-topic violation tracking
  // 0 = no violations yet, 1 = warning issued, 2+ = terminate
  offTopicWarningCount: { value: merge, default: () => 0 },

  // outputs
  currentQuestion: { value: merge, default: () => '' },
  transcript_text: { value: merge, default: () => '' },
  evaluation: { value: merge, default: () => null },
  audio_url: { value: merge, default: () => null },
  is_complete: { value: merge, default: () => false },
  silence_detected: { value: merge, default: () => false },
  error: { value: merge, default: () => null },
  backgroundQuestionCount: { value: merge, default: () => 0 },
  // Chapter interview state
  interviewMode: { value: merge, default: () => 'generic' },
  customPrompt: { value: merge, default: () => null },
  chapterTitle: { value: merge, default: () => null },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const adaptDifficulty = (current, score) => {
  if (score >= 7.5) return current === 'entry' ? 'intermediate' : current === 'intermediate' ? 'senior' : current;
  if (score <= 4.5) return current === 'senior' ? 'intermediate' : current === 'intermediate' ? 'entry' : current;
  return current;
};

const updateScore = (prev, newScore, count) =>
  count <= 2 ? (prev + newScore) / 2 : prev * 0.7 + newScore * 0.3;


// ── NODE: ask_question ─────────────────────────────────────────────────────────
// Speaks the current question via Piper TTS (or leaves it for browser TTS).
const askQuestionNode = async (state) => {
  if (!state.currentQuestion) return state;
  let audioUrl = null;
  try {
    const { ttsService } = await import('../speech/tts.js');
    if (ttsService.isAvailable()) {
      // NON-BLOCKING: Trigger TTS in background but return immediately with the predictable URL
      audioUrl = await ttsService.speak(state.currentQuestion, state.sessionId, { background: true });
    }
  } catch (e) { log.warn(`TTS failed: ${e.message}`); }
  return { ...state, audio_url: audioUrl };
};

// ── NODE: evaluate_answer ──────────────────────────────────────────────────────
const evaluateAnswerNode = async (state) => {
  const answer = state.transcript_text || state.currentAnswer || '';
  const lastQ = state.questionHistory.slice(-1)[0];
  log.node('evaluate_answer', `"${answer.slice(0, 60)}..."`);

  if (!answer) {
    log.warn('Empty answer — skipping evaluation');
    return { ...state, evaluation: { score: 5, needsFollowup: false } };
  }

  // ── CHAPTER INTERVIEW MODE ────────────────────────────────────────
  if (state.interviewMode === 'chapter') {
    const chapterTitle = state.chapterTitle || state.jobRole;
    const adminPrompt = state.customPrompt || `Questions about ${chapterTitle}`;
    const nextNum = state.questionCount + 1;

    // Skip background discovery for chapter mode — go straight to chapter evaluation
    if (state.isIntroQuestion) {
      const repeatPattern = /\b(repeat|say that again|didn'?t understand|didn'?t get|rephrase|what (was|were|did you) (you |the )?ask|could you repeat|please repeat|say it again|come again|pardon|huh\??)\b/i;
      if (repeatPattern.test(answer.trim())) {
        log.info(`Chapter Intro Question - Repeat Request detected`);
        const repeatedQ = lastQ?.question || `Can you tell me more about ${chapterTitle}?`;
        return {
          ...state,
          currentQuestion: `Oh, yeah sure! I was asking: ${repeatedQ}`,
          transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: `Oh, yeah sure! I was asking: ${repeatedQ}` }],
        };
      }

      // Even the first "intro" answer goes through chapter evaluation
      const result = await aiService.generateCompletion(
        chapterPrompts.CHAPTER_CONSOLIDATED_INTERACTION({
          chapterTitle,
          adminPrompt,
          lastQuestion: lastQ?.question || '',
          candidateAnswer: answer,
          expectedConcepts: lastQ?.expectedConcepts || [],
          difficulty: state.difficultyLevel,
          coveredTopics: state.coveredTopics,
          questionNumber: 1,
          totalQuestions: state.maxQuestions,
        })
      );

      if (result?.evaluation?.isQuit) return { ...state, mode: 'quit', is_complete: true };

      // ── OFF-TOPIC DETECTION ───────────────────────────────────────────────────────
      if (result?.evaluation?.isOffTopic) {
        const severity = result.evaluation.offTopicSeverity;
        const warningCount = state.offTopicWarningCount || 0;
        if (severity === 'terminate' || warningCount >= 1) {
          log.warn(`Chapter Off-topic termination: ${state.sessionId}`);
          const msg = result.nextQuestion || 'Session ended due to repeated off-topic responses.';
          return { ...state, currentQuestion: msg, offTopicWarningCount: warningCount + 1, is_complete: true, mode: 'quit', transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: msg }] };
        }
        log.warn(`Chapter Off-topic warning #${warningCount + 1}: ${state.sessionId}`);
        const msg = result.nextQuestion || `Please stay focused on ${chapterTitle}.`;
        return { ...state, currentQuestion: msg, offTopicWarningCount: warningCount + 1, transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: msg }] };
      }

      const evalResult = result?.evaluation || { score: 7, feedback: 'Acknowledged.' };
      const nextQ = result?.nextQuestion || `Can you tell me more about ${chapterTitle}?`;
      const nextTopic = result?.nextTopic || 'Concept';

      return {
        ...state,
        evaluation: evalResult,
        currentQuestion: nextQ,
        questionCount: 1,
        isIntroQuestion: false,
        backgroundQuestionCount: 0,
        coveredTopics: [...state.coveredTopics, nextTopic],
        answerHistory: [...state.answerHistory, { question: lastQ?.question, answer, score: evalResult.score || 7, evaluation: evalResult, type: 'technical' }],
        questionHistory: [...state.questionHistory, { question: nextQ, topic: nextTopic, type: 'main', expectedConcepts: result?.nextExpectedConcepts || [], difficulty: state.difficultyLevel }],
        transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: nextQ }],
        is_complete: !!(result?.is_complete || 1 >= state.maxQuestions),
      };
    }

    // Phase 2+ technical answers for chapter mode
    log.info(`Chapter interaction Q${nextNum}...`);
    const consolidated = await aiService.generateCompletion(
      chapterPrompts.CHAPTER_CONSOLIDATED_INTERACTION({
        chapterTitle,
        adminPrompt,
        lastQuestion: lastQ?.question || '',
        candidateAnswer: answer,
        expectedConcepts: lastQ?.expectedConcepts || [],
        difficulty: state.difficultyLevel,
        coveredTopics: state.coveredTopics,
        questionNumber: nextNum,
        totalQuestions: state.maxQuestions,
      })
    );

    if (consolidated?.evaluation?.isQuit) return { ...state, mode: 'quit', is_complete: true };

    // ── OFF-TOPIC DETECTION ───────────────────────────────────────────────────────
    if (consolidated?.evaluation?.isOffTopic) {
      const severity = consolidated.evaluation.offTopicSeverity;
      const warningCount = state.offTopicWarningCount || 0;
      if (severity === 'terminate' || warningCount >= 1) {
        log.warn(`Chapter Off-topic termination: ${state.sessionId}`);
        const msg = consolidated.nextQuestion || 'Session ended due to repeated off-topic responses.';
        return { ...state, currentQuestion: msg, offTopicWarningCount: warningCount + 1, is_complete: true, mode: 'quit', transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: msg }] };
      }
      log.warn(`Chapter Off-topic warning #${warningCount + 1}: ${state.sessionId}`);
      const msg = consolidated.nextQuestion || `Please stay focused on ${chapterTitle}.`;
      return { ...state, currentQuestion: msg, offTopicWarningCount: warningCount + 1, transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: msg }] };
    }

    if (consolidated?.evaluation?.isRepeatRequest) {
      log.info(`Chapter interaction Q${nextNum} - Repeat Request detected`);
      // Use the LLM's naturally rephrased question
      const repeatedQ = consolidated.nextQuestion || lastQ?.question || `Can you tell me more about ${chapterTitle}?`;
      return {
        ...state,
        // Do NOT advance questionCount, coveredTopics, answerHistory, or questionHistory
        currentQuestion: repeatedQ,
        transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: repeatedQ }],
      };
    }

    const evalResult = consolidated?.evaluation || { score: 7, feedback: 'Acknowledged.' };
    const newScore = updateScore(state.runningScore, evalResult.score || 7, nextNum);
    const newDifficulty = adaptDifficulty(state.difficultyLevel, newScore);
    const nextQ = consolidated?.nextQuestion || `Let's continue with ${chapterTitle}.`;
    const nextTopic = consolidated?.nextTopic || `Topic-${nextNum}`;

    return {
      ...state,
      evaluation: evalResult,
      runningScore: newScore,
      difficultyLevel: newDifficulty,
      currentQuestion: nextQ,
      questionCount: nextNum,
      coveredTopics: [...state.coveredTopics, nextTopic],
      answerHistory: [...state.answerHistory, { question: lastQ?.question, answer, score: evalResult.score || 7, evaluation: evalResult, type: 'technical' }],
      questionHistory: [...state.questionHistory, { question: nextQ, topic: nextTopic, type: 'main', expectedConcepts: consolidated?.nextExpectedConcepts || [], difficulty: newDifficulty }],
      transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: nextQ }],
      is_complete: !!(consolidated?.is_complete || nextNum >= state.maxQuestions),
    };
  }

  // ── GENERIC INTERVIEW MODE (unchanged) ─────────────────────────────
  // Phase 1: Processing Intro Question (Tell me about yourself)
  if (state.isIntroQuestion) {
    const repeatPattern = /\b(repeat|say that again|didn'?t understand|didn'?t get|rephrase|what (was|were|did you) (you |the )?ask|could you repeat|please repeat|say it again|come again|pardon|huh\??)\b/i;
    if (repeatPattern.test(answer.trim())) {
      log.info(`Intro Question - Repeat Request detected`);
      const repeatedQ = lastQ?.question || "I was asking, could you tell me a bit about your technical background?";
      return {
        ...state,
        currentQuestion: `Oh, sure. I said: ${repeatedQ}`,
        transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: `Oh, sure. I said: ${repeatedQ}` }],
      };
    }

    log.info('Processing Intro Answer...');
    const ctx = await aiService.generateCompletion(
      prompts.EXTRACT_CANDIDATE_CONTEXT(state.jobRole, answer)
    );
    return {
      ...state,
      candidateContext: ctx,
      isIntroQuestion: false,
      backgroundQuestionCount: 1,
      answerHistory: [...state.answerHistory, { question: lastQ?.question, answer, score: 7, type: 'intro', feedback: "Personal introduction" }],
      transcript: [...state.transcript, { role: 'candidate', text: answer }],
    };
  }

  // Phase 1.5: Processing Background Discovery Follow-ups
  if (state.backgroundQuestionCount > 0 && state.backgroundQuestionCount < 3) {
    log.info(`Processing Background Follow-up ${state.backgroundQuestionCount}...`);

    // Detect repeat requests BEFORE advancing the counter
    const repeatPattern = /\b(repeat|say that again|didn'?t understand|didn'?t get|rephrase|what (was|were|did you) (you |the )?ask|could you repeat|please repeat|say it again|come again|pardon|huh\??)\b/i;
    if (repeatPattern.test(answer.trim())) {
      log.info(`Background Follow-up - Repeat Request detected`);
      const repeatedQ = lastQ?.question || 'Could you answer the previous question?';
      return {
        ...state,
        // Do NOT advance backgroundQuestionCount or push to answerHistory
        currentQuestion: `Oh, sure. Basically I was asking: ${repeatedQ}`,
        transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: `Oh, sure. Basically I was asking: ${repeatedQ}` }],
      };
    }

    // Note: We don't score these technically, just build context
    return {
      ...state,
      backgroundQuestionCount: state.backgroundQuestionCount + 1,
      answerHistory: [...state.answerHistory, { question: lastQ?.question, answer, score: 7, type: 'background' }],
      transcript: [...state.transcript, { role: 'candidate', text: answer }],
    };

  }

  // Phase 2: Consolidated Technical Interaction (Evaluation + Next Q)
  const nextNum = state.questionCount + 1;

  log.info(`Running consolidated interaction for Q${nextNum}...`);
  const consolidated = await aiService.generateCompletion(
    prompts.CONSOLIDATED_INTERACTION({
      jobRole: state.jobRole,
      lastQuestion: lastQ?.question || '',
      candidateAnswer: answer,
      expectedConcepts: lastQ?.expectedConcepts || [],
      difficulty: state.difficultyLevel,
      coveredTopics: state.coveredTopics,
      questionNumber: nextNum,
      totalQuestions: state.maxQuestions,
      candidateContext: state.candidateContext,
      codeContext: state.codeContext,
    })
  );

  if (consolidated?.evaluation?.isQuit) {
    return { ...state, mode: 'quit', is_complete: true };
  }

  // ── OFF-TOPIC DETECTION ───────────────────────────────────────────────────────
  if (consolidated?.evaluation?.isOffTopic) {
    const severity = consolidated.evaluation.offTopicSeverity;
    const warningCount = state.offTopicWarningCount || 0;

    if (severity === 'terminate' || warningCount >= 1) {
      // Second offense → terminate immediately
      log.warn(`Off-topic termination for session: ${state.sessionId}`);
      const terminationMsg = consolidated.nextQuestion || 'This interview has been ended due to repeated off-topic responses.';
      return {
        ...state,
        currentQuestion: terminationMsg,
        offTopicWarningCount: warningCount + 1,
        is_complete: true,
        mode: 'quit',
        transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: terminationMsg }],
      };
    }

    // First offense → issue warning, re-ask the same question
    log.warn(`Off-topic warning #${warningCount + 1} for session: ${state.sessionId}`);
    const warningMsg = consolidated.nextQuestion || `Please stay focused on the ${state.jobRole} interview topics.`;
    return {
      ...state,
      currentQuestion: warningMsg,
      offTopicWarningCount: warningCount + 1,
      // Do NOT advance questionCount, coveredTopics, or history
      transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: warningMsg }],
    };
  }

  if (consolidated?.evaluation?.isRepeatRequest) {
    log.info(`Generic interaction Q${nextNum} - Repeat Request detected`);
    // Trust LLM's rephrased question
    const repeatedQ = consolidated.nextQuestion || lastQ?.question || 'Could you answer the previous question?';
    return {
      ...state,
      // Do NOT advance questionCount, coveredTopics, answerHistory, or questionHistory
      currentQuestion: repeatedQ,
      transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: repeatedQ }],
    };
  }

  const evalResult = consolidated?.evaluation || { score: 7, feedback: "Acknowledged." };
  const newScore = updateScore(state.runningScore, evalResult.score || 7, nextNum);
  const newDifficulty = adaptDifficulty(state.difficultyLevel, newScore);
  const nextQ = consolidated?.nextQuestion || "Shall we move on to the next topic?";
  // Always record whatever topic the LLM said — never collapse duplicates to 'Fundamentals'.
  // The prompt enforces diversity; the graph just records it faithfully.
  const nextTopic = consolidated?.nextTopic || `Topic-${nextNum}`;

  log.evaluateResult(evalResult.score || 7, evalResult.rating || "Good", evalResult.needsFollowup, newDifficulty);

  return {
    ...state,
    evaluation: evalResult,
    runningScore: newScore,
    difficultyLevel: newDifficulty,
    currentQuestion: nextQ,
    questionCount: nextNum,
    coveredTopics: [...state.coveredTopics, nextTopic],
    answerHistory: [...state.answerHistory, {
      question: lastQ?.question,
      answer,
      score: evalResult.score || 7,
      evaluation: evalResult,
      type: lastQ?.type || 'technical'
    }],
    questionHistory: [...state.questionHistory, {
      question: nextQ,
      topic: nextTopic,
      type: evalResult.needsFollowup ? 'followup' : 'main',
      expectedConcepts: consolidated?.nextExpectedConcepts || [],
      difficulty: newDifficulty
    }],
    transcript: [
      ...state.transcript,
      { role: 'candidate', text: answer },
      { role: 'interviewer', text: nextQ }
    ],
    is_complete: !!(consolidated?.is_complete || nextNum >= state.maxQuestions),
  };
};

// ── NODE: generate_question ───────────────────────────────────────────────────
const generateQuestionNode = async (state) => {
  // ── CHAPTER INTERVIEW MODE ────────────────────────────────────────
  if (state.interviewMode === 'chapter') {
    const chapterTitle = state.chapterTitle || state.jobRole;
    const adminPrompt = state.customPrompt || `Ask questions about ${chapterTitle}`;

    // First question: use chapter introduction prompt
    if (state.isIntroQuestion) {
      const intro = await aiService.generateCompletion(
        chapterPrompts.CHAPTER_INTRODUCTION(chapterTitle, adminPrompt)
      );
      const text = intro?.text || `Hi! Let's review ${chapterTitle}. To start, can you explain the core concepts?`;
      return {
        ...state,
        currentQuestion: text,
        questionHistory: [{ question: text, topic: 'Introduction', type: 'intro' }],
        transcript: [...state.transcript, { role: 'interviewer', text }],
      };
    }

    // Subsequent questions: use chapter generate prompt
    const q = await aiService.generateCompletion(
      chapterPrompts.CHAPTER_GENERATE_QUESTION(
        chapterTitle, adminPrompt, state.coveredTopics,
        state.questionCount, state.maxQuestions, state.difficultyLevel
      )
    );
    const text = q?.text || `Can you tell me more about a key concept in ${chapterTitle}?`;
    return {
      ...state,
      currentQuestion: text,
      questionCount: state.questionCount + 1,
      backgroundQuestionCount: 0,
      coveredTopics: [...state.coveredTopics, q?.topic || 'Concept'],
      questionHistory: [...state.questionHistory, {
        question: text,
        topic: q?.topic || 'Concept',
        type: 'main',
        expectedConcepts: q?.expectedConcepts || [],
        difficulty: state.difficultyLevel
      }],
      transcript: [...state.transcript, { role: 'interviewer', text }],
    };
  }

  // ── GENERIC INTERVIEW MODE (unchanged) ─────────────────────────────
  if (state.isIntroQuestion) {
    const intro = await aiService.generateCompletion(prompts.INTRODUCTION(state.jobRole, state.candidateProfile));
    const text = intro?.text || "Hi! I'm your interviewer today. Tell me a bit about yourself.";
    return {
      ...state,
      currentQuestion: text,
      questionHistory: [{ question: text, topic: 'Introduction', type: 'intro' }],
      transcript: [...state.transcript, { role: 'interviewer', text: text }],
    };
  }

  // Discovery Phase (Recruiter Follow-ups)
  if (state.backgroundQuestionCount >= 1 && state.backgroundQuestionCount < 3) {
    const bgQ = await aiService.generateCompletion(
      prompts.BACKGROUND_QUESTION(state.jobRole, state.candidateContext, state.answerHistory.slice(-1)[0]?.answer, state.backgroundQuestionCount)
    );
    const text = bgQ?.text || "Can you tell me more about that?";
    return {
      ...state,
      currentQuestion: text,
      questionHistory: [...state.questionHistory, { question: text, topic: 'Disovery', type: 'background' }],
      transcript: [...state.transcript, { role: 'interviewer', text: text }],
    };
  }

  // First Technical Question (Transition)
  log.info('Generating first technical question with transition...');
  const trans = await aiService.generateCompletion(prompts.TRANSITION_TO_TECHNICAL(state.jobRole, state.candidateContext));
  const q = await aiService.generateCompletion(
    prompts.GENERATE_QUESTION(state.jobRole, state.coveredTopics, state.weakAreas, state.difficultyLevel, state.questionHistory, 1, state.maxQuestions, state.candidateContext)
  );

  const transText = (trans?.text || "Got it. Let's move to technical questions.").trim();
  const qText = (q?.question || q?.nextQuestion || "Can you tell me about your tech stack?").trim();
  const fullQ = `${transText} ${qText}`;

  return {
    ...state,
    currentQuestion: fullQ,
    questionCount: 1,
    backgroundQuestionCount: 0, // Exit discovery phase
    coveredTopics: [...state.coveredTopics, q?.topic || 'Fundamentals'],
    questionHistory: [...state.questionHistory, {
      question: fullQ,
      topic: q?.topic || 'Fundamentals',
      type: 'main',
      expectedConcepts: q?.expectedConcepts || [],
      difficulty: state.difficultyLevel
    }],
    transcript: [...state.transcript, { role: 'interviewer', text: fullQ }],
  };
};

// ── NODE: end_interview ────────────────────────────────────────────────────────
const endInterviewNode = async (state) => {
  let report;
  if (state.interviewMode === 'chapter') {
    const chapterTitle = state.chapterTitle || state.jobRole;
    const adminPrompt = state.customPrompt || `Chapter review of ${chapterTitle}`;
    report = await aiService.generateCompletion(
      chapterPrompts.CHAPTER_FINAL_EVALUATION(chapterTitle, adminPrompt, state.answerHistory.filter(a => a.type === 'technical'))
    );
  } else {
    report = await aiService.generateCompletion(
      prompts.FINAL_EVALUATION(state.jobRole, state.interviewType, state.answerHistory.filter(a => a.type === 'technical'), state.cheatingEvents, state.difficultyLevel)
    );
  }
  const closingText = state.interviewMode === 'chapter'
    ? `Great work! I've completed your chapter assessment for ${state.chapterTitle || state.jobRole}. Your report is ready.`
    : `Thank you so much! I've prepared your evaluation report.`;
  return {
    ...state,
    evaluation: report,
    currentQuestion: closingText,
    is_complete: true,
    transcript: [...state.transcript, { role: 'interviewer', text: closingText }],
  };
};

// ── NODE: quit_confirmation ────────────────────────────────────────────────────
const quitConfirmationNode = async (state) => {
  const msg = `Interview ended as requested. Results saved.`;
  return { ...state, currentQuestion: msg, is_complete: true, transcript: [...state.transcript, { role: 'interviewer', text: msg }] };
};

// ── NODE: silence_nudge ────────────────────────────────────────────────────────
const silenceNudgeNode = async (state) => {
  const lastQ = state.questionHistory.slice(-1)[0]?.question || "How are things going on your end?";
  log.node('silence_nudge', `Nudging after 30s silence...`);

  let nudge;
  if (state.interviewMode === 'chapter') {
    nudge = await aiService.generateCompletion(
      chapterPrompts.CHAPTER_SILENCE_NUDGE(state.chapterTitle || state.jobRole, lastQ)
    );
  } else {
    nudge = await aiService.generateCompletion(
      prompts.SILENCE_NUDGE(state.jobRole, lastQ, state.candidateContext)
    );
  }

  const text = nudge?.text || "No rush, take your time... just let me know if you need any clarification on the question.";

  return {
    ...state,
    currentQuestion: text,
    transcript: [...state.transcript, { role: 'interviewer', text: text, is_nudge: true }],
  };
};

// ── Routing ────────────────────────────────────────────────────────────────────
const routeAfterEvaluate = (state) => {
  // Chapter mode: no background discovery phase, always go straight to next Q or end
  if (state.interviewMode === 'chapter') {
    if (state.questionCount >= state.maxQuestions || state.is_complete) return 'end_interview';
    return 'ask_question';
  }

  // Generic mode: stay in discovery phase if background count is active
  if (state.backgroundQuestionCount > 0 && state.backgroundQuestionCount < 4) return 'generate_question';
  
  if (state.questionCount === 0 && !state.isIntroQuestion) return 'generate_question';
  if (state.questionCount >= state.maxQuestions) return 'end_interview';
  return 'ask_question';
};

const createGraph = () => {
  const workflow = new StateGraph({ channels: STATE_CHANNELS });
  workflow.addNode('generate_question', generateQuestionNode);
  workflow.addNode('ask_question', askQuestionNode);
  workflow.addNode('evaluate_answer', evaluateAnswerNode);
  workflow.addNode('end_interview', endInterviewNode);
  workflow.addNode('quit_confirmation', quitConfirmationNode);
  workflow.addNode('silence_nudge', silenceNudgeNode);

  workflow.addConditionalEdges(START, (state) => {
    if (state.mode === 'start') return 'generate_question';
    if (state.mode === 'finish') return 'end_interview';
    if (state.mode === 'quit') return 'quit_confirmation';
    if (state.mode === 'silence') return 'silence_nudge';
    return 'evaluate_answer';
  }, { 
    generate_question: 'generate_question', 
    evaluate_answer: 'evaluate_answer', 
    end_interview: 'end_interview', 
    quit_confirmation: 'quit_confirmation',
    silence_nudge: 'silence_nudge'
  });

  workflow.addEdge('generate_question', 'ask_question');
  workflow.addEdge('ask_question', END);
  workflow.addConditionalEdges('evaluate_answer', routeAfterEvaluate, {
    generate_question: 'generate_question',
    end_interview: 'end_interview',
    ask_question: 'ask_question'
  });
  workflow.addEdge('end_interview', 'ask_question');
  workflow.addEdge('quit_confirmation', END);
  workflow.addEdge('silence_nudge', 'ask_question');

  return workflow.compile();
};

export const interviewGraph = createGraph();
