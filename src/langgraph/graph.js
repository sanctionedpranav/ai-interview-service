import { StateGraph, END } from '@langchain/langgraph';
import { aiService } from '../ai/aiService.js';
import { prompts } from '../prompts/index.js';

/**
 * Node: Introduction
 */
const introductionNode = async (state) => {
  const response = await aiService.generateCompletion(
    prompts.INTRODUCTION(state.candidateProfile.jobRole, state.candidateProfile)
  );
  return {
    ...state,
    currentStage: 'INTRODUCTION',
    lastOutput: response,
    transcript: [...(state.transcript || []), { role: 'interviewer', text: response.text }]
  };
};

/**
 * Node: Generate Technical Question
 */
const generateQuestionNode = async (state) => {
  const response = await aiService.generateCompletion(
    prompts.GENERATE_QUESTION(state.candidateProfile.jobRole, state.questionHistory, state.difficultyLevel)
  );
  return {
    ...state,
    currentStage: 'GENERATE_QUESTION',
    lastOutput: response,
    questionHistory: [...(state.questionHistory || []), response],
    transcript: [...(state.transcript || []), { role: 'interviewer', text: response.question }]
  };
};

/**
 * Node: Final Evaluation
 */
const finalEvaluationNode = async (state) => {
  const evaluation = await aiService.generateCompletion(
    prompts.FINAL_EVALUATION(state.answerHistory, state.transcript, state.cheatingEvents)
  );
  return {
    ...state,
    currentStage: 'FINAL_EVALUATION',
    lastOutput: evaluation,
  };
};

/**
 * Create the LangGraph — simplified to avoid reachability errors.
 * The evaluate_answer loop is handled imperatively in the controller.
 */
const createGraph = () => {
  const workflow = new StateGraph({
    channels: {
      sessionId: { value: (left, right) => right ?? left, default: () => null },
      candidateProfile: { value: (left, right) => right ?? left, default: () => ({}) },
      questionHistory: { value: (left, right) => right ?? left, default: () => [] },
      answerHistory: { value: (left, right) => right ?? left, default: () => [] },
      transcript: { value: (left, right) => right ?? left, default: () => [] },
      difficultyLevel: { value: (left, right) => right ?? left, default: () => 'intermediate' },
      cheatingEvents: { value: (left, right) => right ?? left, default: () => [] },
      elapsedTime: { value: (left, right) => right ?? left, default: () => 0 },
      currentStage: { value: (left, right) => right ?? left, default: () => 'INTRODUCTION' },
      lastOutput: { value: (left, right) => right ?? left, default: () => null },
    }
  });

  workflow.addNode('introduction', introductionNode);
  workflow.addNode('generate_question', generateQuestionNode);
  workflow.addNode('final_evaluation', finalEvaluationNode);

  workflow.setEntryPoint('introduction');

  workflow.addEdge('introduction', 'generate_question');
  workflow.addEdge('generate_question', END);
  workflow.addEdge('final_evaluation', END);

  return workflow.compile();
};

export const interviewGraph = createGraph();
