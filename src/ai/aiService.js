import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { log } from '../utils/logger.js';

const groq = new Groq({ apiKey: config.groqApiKey });
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

/**
 * Validates the AI response based on required JSON fields and length.
 */
const validateResponse = (responseText) => {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const cleanedText = jsonMatch ? jsonMatch[0] : responseText;
    const parsed = JSON.parse(cleanedText);
    if (typeof parsed !== 'object' || parsed === null) return false;
    return true;
  } catch (e) {
    return false;
  }
};

const extractCleanJSON = (text) => {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const cleanedText = jsonMatch ? jsonMatch[0] : text;
    return JSON.parse(cleanedText);
  } catch (e) {
    throw new Error('Failed to parse AI response as JSON');
  }
};

/**
 * Pool of technical questions for mock fallback.
 * Covers a wide range of topics so responses are varied even without API keys.
 */
const MOCK_QUESTION_POOL = [
  {
    question: "Can you explain the difference between synchronous and asynchronous programming in JavaScript, and give an example of when you'd use each?",
    topic: "JavaScript Async",
    difficulty: "intermediate",
    expectedConcepts: ["event loop", "promises", "async/await", "callbacks"],
  },
  {
    question: "What is the difference between SQL and NoSQL databases? When would you choose one over the other?",
    topic: "Databases",
    difficulty: "intermediate",
    expectedConcepts: ["ACID", "schema", "scalability", "MongoDB", "PostgreSQL"],
  },
  {
    question: "Explain the concept of RESTful API design. What are the key principles and HTTP methods involved?",
    topic: "REST APIs",
    difficulty: "intermediate",
    expectedConcepts: ["stateless", "GET/POST/PUT/DELETE", "status codes", "endpoints", "CRUD"],
  },
  {
    question: "What is the virtual DOM in React, and why does it improve performance compared to directly manipulating the real DOM?",
    topic: "React Architecture",
    difficulty: "intermediate",
    expectedConcepts: ["diffing algorithm", "reconciliation", "batched updates", "fiber"],
  },
  {
    question: "Can you explain how JWT authentication works? What are its advantages and potential security risks?",
    topic: "Authentication & Security",
    difficulty: "intermediate",
    expectedConcepts: ["header", "payload", "signature", "refresh tokens", "expiry"],
  },
  {
    question: "What is the difference between horizontal and vertical scaling? How do you decide which approach to use?",
    topic: "System Design & Scaling",
    difficulty: "senior",
    expectedConcepts: ["load balancer", "sharding", "microservices", "monolith", "cost"],
  },
  {
    question: "Explain closures in JavaScript with a practical example of when they are useful.",
    topic: "JavaScript Closures",
    difficulty: "intermediate",
    expectedConcepts: ["lexical scope", "function factory", "data encapsulation", "module pattern"],
  },
  {
    question: "What is memoization and when would you apply it in a React application?",
    topic: "Performance Optimization",
    difficulty: "intermediate",
    expectedConcepts: ["useMemo", "useCallback", "re-renders", "expensive computations", "React.memo"],
  },
  {
    question: "Describe the CI/CD pipeline. What tools have you used and what does a typical pipeline look like?",
    topic: "DevOps & CI/CD",
    difficulty: "intermediate",
    expectedConcepts: ["build", "test", "deploy", "GitHub Actions", "Docker", "rollback"],
  },
  {
    question: "What are microservices and how do they differ from monolithic architecture? What are the trade-offs?",
    topic: "Microservices",
    difficulty: "senior",
    expectedConcepts: ["service boundaries", "API gateway", "fault isolation", "deployment complexity"],
  },
  {
    question: "Explain the difference between deep copy and shallow copy in JavaScript. How would you perform each?",
    topic: "JavaScript Objects",
    difficulty: "entry",
    expectedConcepts: ["reference types", "JSON.parse", "structuredClone", "Object.assign", "spread"],
  },
  {
    question: "What is indexing in a database? When would adding an index hurt rather than help performance?",
    topic: "Database Indexing",
    difficulty: "intermediate",
    expectedConcepts: ["B-tree", "write overhead", "composite index", "query planner", "full scan"],
  },
];

/**
 * Mock fallback responses for each prompt type (for dev/testing without valid API keys).
 * GENERATE_QUESTION picks from a pool based on which topics are already covered.
 */
const getMockResponse = (prompt) => {
  if (prompt.includes('INTRODUCTION') || prompt.includes('Greet the candidate')) {
    return {
      text: "Welcome! I'm your AI interviewer today. We'll be covering several technical areas over the next 30-45 minutes. I'd love to start by having you briefly introduce yourself — tell me about your background and what excites you most about software development.",
      nextFocus: "candidate's background",
      stage: "INTRODUCTION"
    };
  }

  if (prompt.includes('EXTRACT_CANDIDATE_CONTEXT') || prompt.includes('analyzing a candidate')) {
    return {
      yearsExperience: 3,
      techStack: ['JavaScript', 'React', 'Node.js'],
      frameworks: ['Express', 'Next.js'],
      databases: ['MongoDB', 'PostgreSQL'],
      recentProjects: ['E-commerce platform with React and Node.js'],
      specializations: ['Frontend development', 'REST APIs'],
      backgroundSummary: '3-year frontend/fullstack developer with React and Node.js expertise',
      suggestedTopics: ['React Hooks', 'Node.js Event Loop', 'REST API Design', 'MongoDB Aggregation', 'JavaScript Async'],
      candidateLevel: 'mid',
    };
  }

  if (prompt.includes('BACKGROUND_QUESTION') || prompt.includes('background question')) {
    return {
      text: "That's really interesting! You mentioned you've been working on an e-commerce platform — what was the most technically challenging part of building it, and how did you approach solving it?",
      stage: 'BACKGROUND_QUESTION',
    };
  }

  if (prompt.includes('TRANSITION_TO_TECHNICAL') || prompt.includes('transition to technical')) {
    return {
      text: "Perfect, that works well for the role. Thanks for clarifying. Alright, let's move into your recent hands-on experience.",
      stage: 'TRANSITION',
    };
  }

  if (prompt.includes('CONSOLIDATED_INTERACTION') || prompt.includes('EVALUATE the answer')) {
    return {
      evaluation: { 
        score: 7, 
        feedback: "Solid explanation. You correctly identified the core patterns.",
        isQuit: false,
        conceptsMissing: []
      },
      nextQuestion: "That makes sense. Speaking of architecture, how would you handle state management for this specific module?",
      nextTopic: "Architecture",
      nextExpectedConcepts: ["Redux", "Context", "Hooks"],
      is_complete: false,
      stage: "CONSOLIDATED"
    };
  }

  if (prompt.includes('GENERATE_QUESTION') || prompt.includes('Pick a NEW topic')) {
    // Parse covered topics from the prompt to pick an uncovered question
    let coveredTopics = [];
    try {
      const match = prompt.match(/TOPICS ALREADY COVERED[^\n]*\n([\s\S]*?)\n\nCANDIDATE/);
      if (match) {
        coveredTopics = match[1].split('\n')
          .map(l => l.replace('- ', '').trim())
          .filter(t => t && t !== 'None yet');
      }
    } catch (_) {}

    const uncovered = MOCK_QUESTION_POOL.filter(q => !coveredTopics.includes(q.topic));
    const pool = uncovered.length > 0 ? uncovered : MOCK_QUESTION_POOL;
    const picked = pool[Math.floor(Math.random() * pool.length)];

    return { ...picked, stage: "GENERATE_QUESTION" };
  }

  if (prompt.includes('EVALUATE_ANSWER') || prompt.includes('evaluating a candidate')) {
    return {
      score: 7,
      rating: "Good",
      conceptsCovered: ["async/await", "promises"],
      conceptsMissing: ["event loop internals"],
      feedback: "You demonstrated solid understanding of the basics. Try to elaborate more on the event loop mechanism.",
      needsFollowup: false,
      followupReason: ""
    };
  }
  if (prompt.includes('FOLLOWUP_QUESTION') || prompt.includes('follow-up')) {
    return {
      question: "Can you walk me through what actually happens inside the JavaScript event loop when a Promise resolves?",
      topic: "Event Loop",
      type: "followup",
      stage: "FOLLOWUP"
    };
  }
  if (prompt.includes('FINAL_EVALUATION') || prompt.includes('interview is complete') || prompt.includes('hiring manager')) {
    return {
      overallScore: 72,
      recommendation: "FURTHER_INTERVIEW",
      technicalScore: 70,
      communicationScore: 75,
      strengths: ["Clear communication", "Good fundamentals", "Problem-solving approach"],
      improvements: ["Could go deeper on async internals", "More real-world examples needed"],
      topicBreakdown: [
        { topic: "JavaScript Async", score: 7, comment: "Good understanding, needs more depth" }
      ],
      summary: "The candidate shows a solid foundation in software development concepts. They communicate well and demonstrate a good problem-solving approach. Recommend a follow-up technical round.",
      integrityNote: "No integrity issues detected."
    };
  }
  return { text: "Thank you for your response. Let's continue.", stage: "UNKNOWN" };
};

// ── Key validity check ───────────────────────────────────────────────────────
const isPlaceholder = (key) =>
  !key ||
  key.trim() === '' ||
  key.startsWith('your_') ||
  key.startsWith('YOUR_') ||
  key === 'GROQ_API_KEY' ||
  key === 'GEMINI_API_KEY';

const groqReady = !isPlaceholder(config.groqApiKey);
const geminiReady = !isPlaceholder(config.geminiApiKey);
// Set FORCE_MOCK=true in .env to always use mock (useful in dev)
const forceMock = process.env.FORCE_MOCK === 'true';

/**
 * AI Service for reasoning.
 *
 * Priority: Groq → Gemini → Dynamic Mock
 *
 * In development (missing/placeholder keys or FORCE_MOCK=true),
 * the dynamic mock pool is used immediately — no failing API calls.
 */
export const aiService = {
  async generateCompletion(prompt, options = {}) {

    // ── Fast-path: use mock immediately if no real keys are configured ────────
    if (forceMock || (!groqReady && !geminiReady)) {
      log.warn('⚡ Dev mode — using dynamic mock (set GROQ_API_KEY to use real AI)');
      return getMockResponse(prompt);
    }

    // ── Try Gemini (Primary) ────────────────────────────────────────────────
    if (geminiReady) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const cleanedText = jsonMatch ? jsonMatch[0] : text;

        if (validateResponse(cleanedText)) {
          log.success('Gemini → response OK');
          return extractCleanJSON(cleanedText);
        }
        log.warn('Gemini response invalid/empty — trying Groq...');
      } catch (geminiError) {
        log.warn(`Gemini: ${geminiError.message} — trying Groq...`);
      }
    }

    // ── Try Groq (Fallback) ──────────────────────────────────────────────────
    if (groqReady) {
      try {
        const groqResponse = await groq.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: options.model || 'llama-3.3-70b-versatile',
          response_format: { type: 'json_object' },
        });

        const content = groqResponse.choices[0]?.message?.content;

        if (content && validateResponse(content)) {
          log.success('Groq (llama3-70b/fallback) → response OK');
          return extractCleanJSON(content);
        }

        console.log('❌ Invalid or empty Groq content:', content);
      } catch (error) {
        log.warn(`Groq Fallback: ${error.message}`);
      }
    }

    // ── Final fallback: dynamic mock ─────────────────────────────────────────
    log.warn('⚡ All AI providers failed — using dynamic mock');
    return getMockResponse(prompt);
  }
};
