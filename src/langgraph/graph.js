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

  // Outputs
  currentQuestion: { value: merge, default: () => '' },
  transcript_text: { value: merge, default: () => '' },
  evaluation: { value: merge, default: () => null },
  audio_url: { value: merge, default: () => null },
  is_complete: { value: merge, default: () => false },
  silence_detected: { value: merge, default: () => false },
  error: { value: merge, default: () => null },
  backgroundQuestionCount: { value: merge, default: () => 0 },
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

  // Phase 1: Processing Intro Question (Tell me about yourself)
  if (state.isIntroQuestion) {
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
// Only for Q0 (Start) and Q1 (Transition)
const generateQuestionNode = async (state) => {
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
  const report = await aiService.generateCompletion(prompts.FINAL_EVALUATION(state.jobRole, state.interviewType, state.answerHistory.filter(a => a.type === 'technical'), state.cheatingEvents, state.difficultyLevel));
  const closingText = `Thank you so much! I've prepared your evaluation report.`;
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
  
  const nudge = await aiService.generateCompletion(
    prompts.SILENCE_NUDGE(state.jobRole, lastQ, state.candidateContext)
  );

  const text = nudge?.text || "No rush, take your time... just let me know if you need any clarification on the question.";
  
  return {
    ...state,
    currentQuestion: text,
    transcript: [...state.transcript, { role: 'interviewer', text: text, is_nudge: true }],
  };
};

// ── Routing ───────────────────────────────────────────────────────────────────
const routeAfterEvaluate = (state) => {
  // Stay in discovery phase if background count is active
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
