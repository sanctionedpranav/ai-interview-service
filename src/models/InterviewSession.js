import mongoose from 'mongoose';

const InterviewSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  jobRole: { type: String, required: true },
  interviewType: { type: String, default: 'technical' },
  candidateProfile: { type: Object, default: {} },

  // ── Candidate Context (extracted from intro answer) ──────────────────────
  candidateContext: { type: Object, default: null },
  // True until the first answer ("tell me about yourself") is processed
  isIntroQuestion: { type: Boolean, default: true },

  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },

  // ── Dynamic Question Generation State ────────────────────────────────────
  difficultyLevel: {
    type: String,
    enum: ['entry', 'intermediate', 'senior'],
    default: 'intermediate',
  },
  // Running score average used to adapt difficulty (0-10)
  runningScore: { type: Number, default: 5 },
  // Topics already covered to avoid repeating
  coveredTopics: [{ type: String }],
  // Number of consecutive follow-up questions asked in a row
  followupCount: { type: Number, default: 0 },
  // Total technical questions asked (excluding follow-ups and background)
  questionCount: { type: Number, default: 0 },
  // Max questions before forcing final evaluation
  maxQuestions: { type: Number, default: 8 },
  // Number of background Q&A turns completed
  backgroundQuestionCount: { type: Number, default: 0 },

  interviewStage: {
    type: String,
    enum: ['INTRODUCTION', 'BACKGROUND', 'TECHNICAL', 'GENERATE_QUESTION', 'WAIT_FOR_ANSWER', 'EVALUATE_ANSWER', 'FOLLOWUP', 'FINAL_EVALUATION', 'END', 'QUIT'],
    default: 'INTRODUCTION',
  },

  // ── History ───────────────────────────────────────────────────────────────
  questionHistory: [
    {
      question: String,
      topic: String,
      difficulty: String,
      type: { type: String, enum: ['intro', 'background', 'main', 'followup'], default: 'main' },
      expectedConcepts: [{ type: String }],
      timestamp: { type: Date, default: Date.now },
    },
  ],
  answerHistory: [
    {
      question: String,
      answer: String,
      score: Number,
      evaluation: Object,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  transcript: [
    {
      role: { type: String, enum: ['system', 'interviewer', 'candidate'] },
      text: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  cheatingEvents: [
    {
      event: String,
      timestamp: { type: Date, default: Date.now },
      metadata: Object,
    },
  ],

  // ── Chapter Interview Metadata ────────────────────────────────────────────
  // 'generic' = standard job-role interview, 'chapter' = admin-configured chapter interview
  interviewMode: { type: String, enum: ['generic', 'chapter'], default: 'generic' },
  // Admin-supplied prompt describing what topics/questions the AI should focus on
  customPrompt: { type: String, default: null },
  // The lecture._id from the LMS that triggered this chapter interview
  lectureId: { type: String, default: null },
  // Human-readable chapter/lecture title shown in the interview UI and reports
  chapterTitle: { type: String, default: null },
  // The overarching course title for easier categorisation in the admin dashboard
  courseTitle: { type: String, default: null },

  // ── Results ───────────────────────────────────────────────────────────────
  finalScore: { type: Number, default: 0 },
  finalRecommendation: { type: String },
  evaluationReport: { type: Object },
}, { timestamps: true });

export const InterviewSession = mongoose.model('InterviewSession', InterviewSessionSchema);
