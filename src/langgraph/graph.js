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
  // Silence tracking
  silenceViolationCount: { value: merge, default: () => 0 },

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

// Minimum number of questions the AI must ask before the interview can end.
// This is a hard floor — even if the LLM returns is_complete=true earlier,
// we ignore it until this many answers have been recorded.
const MIN_QUESTIONS = 5;


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
    return { ...state, evaluation: { score: 0, needsFollowup: false } };
  }

  // ── CHAPTER INTERVIEW MODE ────────────────────────────────────────
  if (state.interviewMode === 'chapter') {
    const adminPrompt = state.customPrompt || "Technical assessment strictly based on provided instructions.";
    const nextNum = state.questionCount + 1;

    // Skip background discovery for chapter mode — go straight to evaluation
    if (state.isIntroQuestion) {
      const repeatPattern = /\b(repeat|say that again|didn'?t understand|didn'?t get|rephrase|what (was|were|did you) (you |the )?ask|could you repeat|please repeat|say it again|come again|pardon|huh\??)\b/i;
      if (repeatPattern.test(answer.trim())) {
        log.info(`Chapter Intro Question - Repeat Request detected`);
        const repeatedQ = lastQ?.question || "Can you share your thoughts on the topic discussed?";
        return {
          ...state,
          currentQuestion: `Oh, yeah sure! I was asking: ${repeatedQ}`,
          transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: `Oh, yeah sure! I was asking: ${repeatedQ}` }],
        };
      }

      // ── M3: SKIP DETECTION ON FIRST QUESTION ──────────────────────────────────
      // If the student says "I don't know" or "skip" on the very first question,
      // generate a fresh question instead of scoring a blank/gibberish answer.
      const skipPattern = /\b(i don'?t know|skip|pass|next question|another question|move on|no clue|idk|no idea|didn'?t study|forgot|don'?t understand|don'?t get it|question please|never heard of|not sure|uncertain)\b/i;
      if (skipPattern.test(answer.trim())) {
        log.info(`[SkipDetection] Skip on chapter intro question. Generating a fresh starting question.`);
        try {
          const freshQ = await aiService.generateCompletion(
            chapterPrompts.CHAPTER_GENERATE_QUESTION(
              adminPrompt, state.coveredTopics, 1, state.maxQuestions, state.difficultyLevel
            )
          );
          const nextQ = freshQ?.text || "No worries! Let's try a different angle based on the instructions.";
          const nextTopic = freshQ?.topic || 'Introduction';
          return {
            ...state,
            currentQuestion: nextQ,
            questionCount: 1,
            isIntroQuestion: false,
            coveredTopics: [...state.coveredTopics, nextTopic],
            answerHistory: [...state.answerHistory, { question: lastQ?.question, answer, score: 0, type: 'technical', isSkip: true }],
            questionHistory: [...state.questionHistory, { question: nextQ, topic: nextTopic, type: 'main', expectedConcepts: freshQ?.expectedConcepts || [], difficulty: state.difficultyLevel }],
            transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: nextQ }],
          };
        } catch (e) {
          log.error(`M3 intro skip generation failed: ${e.message}`);
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      // Even the first "intro" answer goes through chapter evaluation
      const result = await aiService.generateCompletion(
        chapterPrompts.CHAPTER_CONSOLIDATED_INTERACTION({
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
        const msg = result.nextQuestion || "Let's try to stay focused on the technical topic.";
        return { ...state, currentQuestion: msg, offTopicWarningCount: warningCount + 1, transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: msg }] };
      }

      // ── STRESS DETECTION ──────────────────────────────────────────────────────────
      if (result?.evaluation?.isStressed) {
        log.info(`Chapter Intro - Stress detected. Routing to recovery.`);
        const recovery = await aiService.generateCompletion(chapterPrompts.CHAPTER_EMOTIONAL_RECOVERY(adminPrompt, lastQ?.question));
        const recoveryMsg = recovery?.text || "Hey, no pressure at all. Let's start with something very basic to get into the flow.";
        return {
          ...state,
          currentQuestion: recoveryMsg,
          transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: recoveryMsg }],
        };
      }

      const evalResult = result?.evaluation || { score: 7, feedback: 'Acknowledged.' };
      const nextQ = result?.nextQuestion || "Moving on, can you tell me more about the next concept?";
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
        // is_complete only when we've hit the hard minimum AND the LLM agrees
        is_complete: !!(result?.is_complete && state.maxQuestions >= MIN_QUESTIONS),
      };
    }

    // Phase 2+ technical answers for chapter mode
    log.info(`Chapter interaction Q${nextNum}...`);
    const consolidated = await aiService.generateCompletion(
      chapterPrompts.CHAPTER_CONSOLIDATED_INTERACTION({
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
      const msg = consolidated.nextQuestion || "Let's focus back on the technical topic.";
      return { ...state, currentQuestion: msg, offTopicWarningCount: warningCount + 1, transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: msg }] };
    }

    // ── STRESS DETECTION ──────────────────────────────────────────────────────────
    if (consolidated?.evaluation?.isStressed) {
      log.info(`Chapter Interaction - Stress detected. Routing to recovery.`);
      const recovery = await aiService.generateCompletion(chapterPrompts.CHAPTER_EMOTIONAL_RECOVERY(adminPrompt, lastQ?.question));
      const recoveryMsg = recovery?.text || "No worries, let's take a step back and look at a simpler concept first.";
      return {
        ...state,
        currentQuestion: recoveryMsg,
        transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: recoveryMsg }],
      };
    }

    if (consolidated?.evaluation?.isRepeatRequest) {
      log.info(`Chapter interaction Q${nextNum} - Repeat Request detected`);
      // Use the LLM's naturally rephrased question
      const repeatedQ = consolidated.nextQuestion || lastQ?.question || "Can you share your thoughts on the topic discussed?";
      return {
        ...state,
        // Do NOT advance questionCount, coveredTopics, answerHistory, or questionHistory
        currentQuestion: repeatedQ,
        transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: repeatedQ }],
      };
    }

    const evalResult = consolidated?.evaluation || { score: 7, feedback: 'Acknowledged.' };

    // ── SKIP DETECTION & FORCED ADVANCEMENT ──────────────────────────────────
    const skipPattern = /\b(i don'?t know|skip|pass|next question|another question|move on|no clue|idk|no idea|didn'?t study|forgot|don'?t understand|don'?t get it|question please|never heard of|not sure|uncertain)\b/i;
    const isManualSkip = skipPattern.test(answer.trim());
    
    // Safety list of general topics for the chapter to use if AI fails
    const SAFETY_TOPICS = [
      "the core purpose and why it matters in production",
      "the most common mistake junior developers make with it",
      "how it handles performance when things get scaled up",
      "a specific real-world debugging scenario you've faced",
      "the main trade-offs compared to alternative approaches",
      "how you'd explain it to a non-technical stakeholder"
    ];

    if (evalResult.isSkip || isManualSkip) {
      log.info(`[SkipDetection] Mandatory skip requested (LLM=${!!evalResult.isSkip}, Regex=${isManualSkip}). Forcing new topic.`);
      try {
        const rescue = await aiService.generateCompletion(
          chapterPrompts.CHAPTER_GENERATE_QUESTION(
            adminPrompt, state.coveredTopics,
            nextNum, state.maxQuestions, state.difficultyLevel
          )
        );
        let nextQ = rescue?.text;
        let nextTopic = rescue?.topic;

        // If rescue failed to get a new question, use a safety topic
        if (!nextQ) {
            const safetyTopic = SAFETY_TOPICS[nextNum % SAFETY_TOPICS.length];
            nextQ = `Alright, let's pivot slightly. I'd like to hear about ${safetyTopic}.`;
            nextTopic = "Safety Pivot";
        }

        return {
          ...state,
          evaluation: { ...evalResult, score: 0, isSkip: true, feedback: 'Student skipped or was confused by the question.' },
          currentQuestion: nextQ,
          questionCount: nextNum,
          coveredTopics: [...state.coveredTopics, nextTopic],
          answerHistory: [...state.answerHistory, { question: lastQ?.question, answer, score: 0, type: 'technical', isSkip: true }],
          questionHistory: [...state.questionHistory, { question: nextQ, topic: nextTopic, type: 'main', expectedConcepts: rescue?.expectedConcepts || [], difficulty: state.difficultyLevel }],
          transcript: [...state.transcript, { role: 'candidate', text: answer }, { role: 'interviewer', text: nextQ }],
        };
      } catch (e) {
        log.error(`Forced skip generation failed: ${e.message}`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── FOLLOW-UP LOOP PREVENTION ─────────────────────────────────────────────
    // Guard 1: If the student scored >= 6, they answered well enough — do NOT loop
    // them on the same topic regardless of what the LLM decided.
    // STT transcriptions often sound short/vague even when the answer is correct.
    if ((evalResult.score || 7) >= 6 && evalResult.needsFollowup) {
      log.info(`[FollowupGuard] Score ${evalResult.score} >= 6 — overriding needsFollowup=true to advance topic.`);
      evalResult.needsFollowup = false;
    }

    // Guard 2: Cap follow-ups per topic at 1. If this topic already appears in
    // coveredTopics, it means we already did one follow-up — force advancement.
    const lastCoveredTopic = state.coveredTopics[state.coveredTopics.length - 1] || '';
    const secondToLastTopic = state.coveredTopics[state.coveredTopics.length - 2] || '';
    const potentialNextTopic = consolidated?.nextTopic || '';
    const isRepeatTopic =
      potentialNextTopic &&
      (potentialNextTopic.toLowerCase() === lastCoveredTopic.toLowerCase() ||
       potentialNextTopic.toLowerCase() === secondToLastTopic.toLowerCase());
    if (evalResult.needsFollowup && isRepeatTopic) {
      log.info(`[FollowupGuard] Topic "${potentialNextTopic}" already in coveredTopics — forcing topic advancement.`);
      evalResult.needsFollowup = false;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const newScore = updateScore(state.runningScore, evalResult.score || 7, nextNum);
    const newDifficulty = adaptDifficulty(state.difficultyLevel, newScore);
    
    let nextQ = consolidated?.nextQuestion;
    let nextTopic = consolidated?.nextTopic;

    // ── RESCUE MECHANISM: If the LLM failed to provide a question, don't just loop. ──
    if (!nextQ) {
      log.warn(`[Rescue] No nextQuestion in consolidated response for Q${nextNum}. Generating a fresh one.`);
      try {
        const rescue = await aiService.generateCompletion(
          chapterPrompts.CHAPTER_GENERATE_QUESTION(
            adminPrompt, state.coveredTopics,
            nextNum, state.maxQuestions, state.difficultyLevel
          )
        );
        nextQ = rescue?.text;
        nextTopic = rescue?.topic;
      } catch (e) { log.error(`Rescue generation failed: ${e.message}`); }
    }

    // Final fallback if even the rescue failed - NEVER repeat the exact last question
    if (!nextQ || nextQ === lastQ?.question) {
      const cleanLastQ = lastQ?.question?.replace(/^Let's stick with the last point: /i, '') || '';
      const safetyPivot = `Actually, let's take a step back and look at the core logic here. How would you define its main purpose for a production application?`;
      nextQ = nextQ === lastQ?.question || !cleanLastQ ? safetyPivot : `Let's stick with the last point: ${cleanLastQ}`;
    }
    nextTopic = nextTopic || lastQ?.topic || `Topic-${nextNum}`;

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
      // Complete only when the LLM agrees AND the hard minimum is met
      is_complete: !!(consolidated?.is_complete && nextNum >= MIN_QUESTIONS),
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
    // Merge toneHint from extraction into candidateContext for downstream prompts
    const enrichedCtx = ctx ? { ...ctx, toneHint: ctx.toneHint || 'confident_and_technical' } : null;
    log.info(`📋 Candidate context extracted. Tone: ${enrichedCtx?.toneHint}, Level: ${enrichedCtx?.candidateLevel}`);
    return {
      ...state,
      candidateContext: enrichedCtx,
      isIntroQuestion: false,
      backgroundQuestionCount: 1,
      answerHistory: [...state.answerHistory, { question: lastQ?.question, answer, score: 7, type: 'intro', feedback: 'Personal introduction' }],
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
    const blabberingMsg = `Listen, we're here to review the role of ${state.jobRole}. Random answers and blabbering aren't going to help you pass. Let's get back to it: ${lastQ?.question || 'Tell me about your tech stack.'}`;
    const warningMsg = consolidated.nextQuestion || blabberingMsg;
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

  let evalResult = consolidated?.evaluation || { score: 7, feedback: 'Acknowledged.' };

  // ── FOLLOW-UP LOOP PREVENTION ─────────────────────────────────────────────
  // Guard 1: Score >= 6 means the student understood — do NOT loop them.
  if ((evalResult.score || 7) >= 6 && evalResult.needsFollowup) {
    log.info(`[FollowupGuard] Score ${evalResult.score} >= 6 — overriding needsFollowup to advance topic.`);
    evalResult.needsFollowup = false;
  }
  // Guard 2: If LLM wants to revisit an already-covered topic, force advancement.
  const _lastTopic = state.coveredTopics[state.coveredTopics.length - 1] || '';
  const _prevTopic = state.coveredTopics[state.coveredTopics.length - 2] || '';
  const _nextTopicRaw = consolidated?.nextTopic || '';
  if (evalResult.needsFollowup && _nextTopicRaw &&
      (_nextTopicRaw.toLowerCase() === _lastTopic.toLowerCase() ||
       _nextTopicRaw.toLowerCase() === _prevTopic.toLowerCase())) {
    log.info(`[FollowupGuard] Topic "${_nextTopicRaw}" already covered — forcing topic advancement.`);
    evalResult.needsFollowup = false;
  }
  // ─────────────────────────────────────────────────────────────────────────

  const newScore = updateScore(state.runningScore, evalResult.score || 7, nextNum);
  const newDifficulty = adaptDifficulty(state.difficultyLevel, newScore);
  let nextQ = consolidated?.nextQuestion || 'Shall we move on to the next topic?';
  const nextTopic = consolidated?.nextTopic || `Topic-${nextNum}`;

  log.evaluateResult(evalResult.score || 7, evalResult.rating || 'Good', evalResult.needsFollowup, newDifficulty);

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
    is_complete: !!(consolidated?.is_complete && nextNum >= MIN_QUESTIONS),
  };
};

// ── NODE: generate_question ───────────────────────────────────────────────────
const generateQuestionNode = async (state) => {
  // ── CHAPTER INTERVIEW MODE ────────────────────────────────────────
  if (state.interviewMode === 'chapter') {
    const adminPrompt = state.customPrompt || "Technical assessment strictly based on provided instructions.";

    // First question: use chapter introduction prompt
    if (state.isIntroQuestion) {
      const intro = await aiService.generateCompletion(
        chapterPrompts.CHAPTER_INTRODUCTION(adminPrompt)
      );
      const text = intro?.text || "Hi! Let's get started with the assessment. To begin, can you share your thoughts on the topic at hand?";
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
        adminPrompt, state.coveredTopics,
        state.questionCount, state.maxQuestions, state.difficultyLevel
      )
    );
    const text = q?.text || "Can you tell me more about a key concept within the scope of our instructions?";
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
        difficulty: state.difficultyLevel,
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
    const adminPrompt = state.customPrompt || "Technical assessment.";
    report = await aiService.generateCompletion(
      chapterPrompts.CHAPTER_FINAL_EVALUATION(adminPrompt, state.answerHistory)
    );
  } else {
    report = await aiService.generateCompletion(
      prompts.FINAL_EVALUATION(state.jobRole, state.interviewType, state.answerHistory.filter(a => a.type === 'technical'), state.cheatingEvents, state.difficultyLevel)
    );
  }
  const closingText = state.interviewMode === 'chapter'
    ? `Alright, that wraps up your chapter review! You've done well working through all the questions. I'm generating your full assessment report now — hang tight for just a moment.`
    : `That's a wrap! Thank you so much for going through the interview. You answered all ${state.maxQuestions} questions — I'm putting together your evaluation report right now.`;
  // If the previous node already set a closing message (ai-driven wrap up), preserve it
  // otherwise use the standard closing text.
  const finalQuestion = state.is_complete && state.currentQuestion ? state.currentQuestion : closingText;

  return {
    ...state,
    evaluation: report,
    currentQuestion: finalQuestion,
    is_complete: true,
    transcript: [...state.transcript, { role: 'interviewer', text: finalQuestion }],
  };
};

// ── NODE: quit_confirmation ────────────────────────────────────────────────────
const quitConfirmationNode = async (state) => {
  const msg = `Interview ended as requested. Results saved.`;
  return { ...state, currentQuestion: msg, is_complete: true, transcript: [...state.transcript, { role: 'interviewer', text: msg }] };
};

// ── NODE: silence_nudge ────────────────────────────────────────────────────────
const silenceNudgeNode = async (state) => {
  const newSilentCount = state.silenceViolationCount + 1;
  const lastQ = state.questionHistory.slice(-1)[0]?.question || "How are things going on your end?";
  log.node('silence_nudge', `Nudging after 30s silence... Violation ${newSilentCount}`);

  if (newSilentCount >= 3) {
      log.info(`Silence limits exceeded (${newSilentCount}), terminating interview session.`);
      const termMsg = "I haven't heard from you in a while, so I'm going to wrap up the interview here. Thanks for your time.";
      return {
          ...state,
          silenceViolationCount: newSilentCount,
          currentQuestion: termMsg,
          is_complete: true,
          transcript: [...state.transcript, { role: 'interviewer', text: termMsg }]
      };
  }

  let nudge;
  if (state.interviewMode === 'chapter') {
    const adminPrompt = state.customPrompt || "Technical assessment.";
    nudge = await aiService.generateCompletion(
      chapterPrompts.CHAPTER_SILENCE_NUDGE(adminPrompt, lastQ)
    );
  } else {
    nudge = await aiService.generateCompletion(
      prompts.SILENCE_NUDGE(state.jobRole, lastQ, state.candidateContext)
    );
  }

  const text = nudge?.text || "No rush, take your time... just let me know if you need any clarification on the question.";

  return {
    ...state,
    silenceViolationCount: newSilentCount,
    currentQuestion: text,
    transcript: [...state.transcript, { role: 'interviewer', text: text, is_nudge: true }],
  };
};

// ── Routing ────────────────────────────────────────────────────────────────────
const routeAfterEvaluate = (state) => {
  // Hard minimum guard: never end before MIN_QUESTIONS answers have been collected,
  // regardless of what the LLM returned for is_complete.
  const answeredCount = state.answerHistory?.filter(a => a.type === 'technical').length || state.questionCount || 0;
  const belowMinimum = answeredCount < MIN_QUESTIONS;

  // Route to end only when is_complete AND we've met the hard minimum
  if (state.is_complete && !belowMinimum) {
    return 'end_interview';
  }

  // Also end if we've significantly exceeded maxQuestions to prevent infinite loops, 
  // but give the AI a 3-question "grace period" to wrap up naturally.
  if (state.questionCount >= (state.maxQuestions + 3) && !belowMinimum) {
    return 'end_interview';
  }

  // Chapter mode: no background discovery phase, always go straight to next Q
  if (state.interviewMode === 'chapter') {
    return 'ask_question';
  }

  // Generic mode: stay in discovery phase if background count is active
  if (state.backgroundQuestionCount > 0 && state.backgroundQuestionCount < 4) return 'generate_question';

  if (state.questionCount === 0 && !state.isIntroQuestion) return 'generate_question';

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
