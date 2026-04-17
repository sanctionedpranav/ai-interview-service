import Groq from 'groq-sdk';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { log } from '../utils/logger.js';

// ── Key validity check ───────────────────────────────────────────────────────
const isPlaceholder = (key) =>
  !key ||
  key.trim() === '' ||
  key.startsWith('your_') ||
  key.startsWith('YOUR_') ||
  key === 'GROQ_API_KEY' ||
  key === 'GEMINI_API_KEY';

// Lazily initialized clients to prevent top-level crashes if keys are missing
let groq = null;
const getGroqClient = () => {
  if (!groq && !isPlaceholder(config.groqApiKey)) {
    groq = new Groq({ apiKey: config.groqApiKey });
  }
  return groq;
};

export const genAI = !isPlaceholder(config.geminiApiKey) ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

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
    // ── Dynamic mock: parse the candidate's actual answer from the prompt string ──
    // The prompt template embeds the answer as: CANDIDATE'S ANSWER: "..."
    let candidateAnswer = '';
    try {
      const answerMatch = prompt.match(/CANDIDATE'S ANSWER:\s*"([^"]*)"/i)
        || prompt.match(/candidate(?:'s)? answer[:\s]+"([^"]+)"/i);
      if (answerMatch) candidateAnswer = answerMatch[1].toLowerCase();
    } catch (_) { }

    // Tech stack detection — scan the answer for known technologies
    const TECH_MAP = {
      techStack: [
        'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'php', 'ruby',
        'golang', 'go', 'rust', 'swift', 'kotlin', 'dart', 'scala', 'perl',
        'html', 'css', 'sql', 'bash', 'shell',
      ],
      frameworks: [
        'react', 'angular', 'vue', 'next.js', 'nextjs', 'nuxt', 'svelte',
        'express', 'fastapi', 'flask', 'django', 'spring', 'laravel', 'rails',
        'nestjs', 'nest.js', 'fastify', 'hapi', 'koa', 'fiber',
        'react native', 'flutter', 'electron',
      ],
      databases: [
        'mongodb', 'postgresql', 'postgres', 'mysql', 'sqlite', 'redis',
        'elasticsearch', 'dynamodb', 'firestore', 'cassandra', 'supabase',
        'mssql', 'oracle', 'mariadb', 'couchdb', 'neo4j',
      ],
    };

    const found = { techStack: [], frameworks: [], databases: [] };
    for (const [category, keywords] of Object.entries(TECH_MAP)) {
      for (const kw of keywords) {
        if (candidateAnswer.includes(kw)) {
          // Normalise display name
          const display = kw === 'nextjs' ? 'Next.js'
            : kw === 'nestjs' ? 'NestJS'
              : kw === 'nodejs' ? 'Node.js'
                : kw.charAt(0).toUpperCase() + kw.slice(1);
          if (!found[category].includes(display)) found[category].push(display);
        }
      }
    }

    // Also pick up Node.js separately (common spoken as "node")
    if (candidateAnswer.includes('node') && !found.techStack.includes('Node.js')) {
      found.frameworks.push('Node.js');
    }

    // Years of experience — look for patterns like "3 years", "2+ years", "year experience"
    let yearsExperience = null;
    const yearsMatch = candidateAnswer.match(/(\d+)\s*(?:\+\s*)?years?(?:\s+of)?\s+exp/i)
      || candidateAnswer.match(/(\d+)\s*\+?\s*years?/i);
    if (yearsMatch) yearsExperience = parseInt(yearsMatch[1], 10);

    // Candidate level heuristic
    let candidateLevel = 'mid';
    if (yearsExperience !== null) {
      if (yearsExperience <= 1) candidateLevel = 'junior';
      else if (yearsExperience >= 5) candidateLevel = 'senior';
    } else if (/senior|lead|architect|principal|staff/i.test(candidateAnswer)) {
      candidateLevel = 'senior';
    } else if (/junior|fresher|student|intern|graduate|entry/i.test(candidateAnswer)) {
      candidateLevel = 'junior';
    }

    // Extract job role from the prompt for suggestedTopics
    let jobRole = 'developer';
    const roleMatch = prompt.match(/TARGET ROLE:\s*"([^"]+)"/i);
    if (roleMatch) jobRole = roleMatch[1];

    // Build a plain-English background summary from what we parsed
    const allTech = [...found.techStack, ...found.frameworks, ...found.databases];
    const techSummary = allTech.length > 0 ? allTech.slice(0, 4).join(', ') : jobRole;
    const expLabel = yearsExperience ? `${yearsExperience}-year` : candidateLevel;
    const backgroundSummary = `${expLabel} ${candidateLevel} developer with experience in ${techSummary}`;

    // Suggest topics based on detected tech — fall back to generic role topics
    const topicMap = {
      'React': 'React Hooks & State', 'Vue': 'Vue Reactivity', 'Angular': 'Angular Dependency Injection',
      'Node.js': 'Node.js Event Loop', 'Express': 'Express Middleware', 'NestJS': 'NestJS Architecture',
      'Python': 'Python Async (asyncio)', 'Django': 'Django ORM', 'FastAPI': 'FastAPI Dependency Injection',
      'MongoDB': 'MongoDB Aggregation Pipeline', 'PostgreSQL': 'PostgreSQL Indexing & Query Planning',
      'Redis': 'Redis Caching Patterns', 'TypeScript': 'TypeScript Generics & Types',
      'Docker': 'Docker Containerization', 'Kubernetes': 'Kubernetes Orchestration',
      'Java': 'Java Spring Boot', 'Spring': 'Spring Boot REST',
      'JavaScript': 'JavaScript Async/Await & Promises',
    };
    const suggestedTopics = allTech
      .map(t => topicMap[t])
      .filter(Boolean)
      .slice(0, 5);
    if (suggestedTopics.length < 3) {
      suggestedTopics.push(`${jobRole} Fundamentals`, 'REST API Design', 'System Design Basics');
    }

    // Detect tone hint for downstream prompts
    let toneHint = 'confident_and_technical';
    if (/sorry|not sure|nervous|anxious|blank|struggle|difficult/i.test(candidateAnswer)) {
      toneHint = 'nervous_but_capable';
    } else if (allTech.length === 0 || candidateAnswer.length < 40) {
      toneHint = 'vague_needs_probing';
    } else if (/electrician|chef|doctor|nurse|teacher|mechanic|driver|non.?it|non.?tech/i.test(candidateAnswer)) {
      toneHint = 'non_technical_background';
    }

    return {
      yearsExperience,
      techStack: found.techStack,
      frameworks: found.frameworks,
      databases: found.databases,
      recentProjects: [],  // Can't reliably infer from text alone without the LLM
      specializations: [],
      backgroundSummary,
      suggestedTopics,
      candidateLevel,
      roleAlignmentNote: null,
      toneHint,
    };
  }

  if (prompt.includes('BACKGROUND_QUESTION') || prompt.includes('background question')) {
    // Parse last answer and candidate context from the prompt
    let lastAnswer = '';
    let jobRole = 'the role';
    try {
      const answerMatch = prompt.match(/Last Response:\s*"([^"]+)"/i)
        || prompt.match(/WHAT THEY JUST SAID:\s*"([^"]+)"/i)
        || prompt.match(/candidateAnswer[^"]*"([^"]+)"/i);
      if (answerMatch) lastAnswer = answerMatch[1];

      const roleMatch = prompt.match(/assessing for\s*\\?"([^"\\]+)\\?"/i)
        || prompt.match(/jobRole[^"]*"([^"]+)"/i);
      if (roleMatch) jobRole = roleMatch[1];
    } catch (_) { }

    // Extract a meaningful topic from their answer to ask about
    const topicHooks = [
      { pattern: /api/i, question: `So when you were building that API layer — how did you handle authentication? Like, were you doing JWT or sessions?` },
      { pattern: /database|db/i, question: `Interesting — when you picked that database, what made you go with it over the alternatives?` },
      { pattern: /frontend|ui|react|vue|angular/i, question: `Got it. On the frontend side — how did you manage state? Like was there a pattern you followed or did you figure it out as you went?` },
      { pattern: /backend|server|node|express/i, question: `Right. And on the server side — how did you handle errors? Like if something failed in the middle of a request, what happened?` },
      { pattern: /team|collaborate|work with/i, question: `Interesting. When you were working with that team, how did you handle disagreements about technical decisions?` },
      { pattern: /deploy|production|devops|ci\/cd|docker/i, question: `Got it. And how was the deployment handled? Was that something you were involved in, or did another team manage it?` },
      { pattern: /learn|picked up|taught myself|self.?taught/i, question: `That's a solid path. What's the hardest thing you had to learn on the job there — something that wasn't in any tutorial?` },
    ];

    let dynamicQuestion = null;
    if (lastAnswer) {
      for (const hook of topicHooks) {
        if (hook.pattern.test(lastAnswer)) {
          dynamicQuestion = hook.question;
          break;
        }
      }
    }

    // Fall back to a generic open question about their work if nothing matched
    const fallbackQuestion = lastAnswer
      ? `Right. Out of everything you just described, what was the single trickiest part to get right — and what did you do to solve it?`
      : `That's good context. What kind of ${jobRole} work have you been focused on most recently?`;

    return {
      text: dynamicQuestion || fallbackQuestion,
      stage: 'BACKGROUND_QUESTION',
    };
  }

  if (prompt.includes('TRANSITION_TO_TECHNICAL') || prompt.includes('transition to technical')) {
    // Parse candidate context from the prompt to make the transition natural
    let tech = '';
    let jobRole = 'the role';
    try {
      const bgMatch = prompt.match(/backgroundSummary[^"]*"([^"]+)"/i)
        || prompt.match(/CANDIDATE BACKGROUND[^:]*:\s*([^\n]+)/i);
      if (bgMatch) tech = bgMatch[1];

      const roleMatch = prompt.match(/assessing for\s*\\?"([^"\\]+)\\?"/i)
        || prompt.match(/"jobRole"[^"]*"([^"]+)"/i);
      if (roleMatch) jobRole = roleMatch[1];
    } catch (_) { }

    const transitions = [
      `Right, that all makes sense for the ${jobRole} side. So — let's talk about some real scenarios. How do you typically think about performance when you're building something new?`,
      `Gotcha — solid background for this. Let me throw a scenario at you: say your app is suddenly getting 10x the traffic it normally does. What do you look at first?`,
      `Makes sense. Alright, let's get into some hands-on stuff. If you had to build an API endpoint from scratch for this role, how would you structure it?`,
      `Good to know. Here's a real one — imagine a bug just hit production and users are affected right now. Walk me through how you'd debug it.`,
    ];
    const picked = transitions[Math.floor(Math.random() * transitions.length)];

    return { text: picked, stage: 'TRANSITION' };
  }

  if (prompt.includes('CONSOLIDATED_INTERACTION') || prompt.includes('EVALUATE the answer')) {
    // Parse last question, last answer, covered topics, and job role from the prompt
    let lastQuestion = '';
    let candidateAnswer = '';
    let coveredTopics = [];
    let jobRole = 'developer';
    let questionNumber = 1;
    let totalQuestions = 8;

    try {
      const qMatch = prompt.match(/LAST QUESTION(?:\s*ASKED)?[:\s]*"([^"]+)"/i);
      if (qMatch) lastQuestion = qMatch[1];

      const aMatch = prompt.match(/(?:STUDENT'S|CANDIDATE'S)\s*ACTUAL ANSWER[:\s]*"([^"]+)"/i)
        || prompt.match(/CANDIDATE'S ANSWER[:\s]*"([^"]+)"/i);
      if (aMatch) candidateAnswer = aMatch[1];

      const roleMatch = prompt.match(/JOB ROLE[:\s]*"([^"]+)"/i)
        || prompt.match(/assessing for\s*\\?"([^"\\]+)\\?"/i);
      if (roleMatch) jobRole = roleMatch[1];

      const numMatch = prompt.match(/QUESTION[:\s]*(\d+)\s*of\s*(\d+)/i);
      if (numMatch) { questionNumber = parseInt(numMatch[1]); totalQuestions = parseInt(numMatch[2]); }

      // Parse covered topics list from numbered list like "  1. React Hooks\n  2. ..."
      const topicsBlock = prompt.match(/TOPICS ALREADY COVERED[^\n]*\n([\s\S]*?)(?:\n\n|\n═)/);
      if (topicsBlock) {
        coveredTopics = topicsBlock[1]
          .split('\n')
          .map(l => l.replace(/^\s*\d+\.\s*/, '').trim())
          .filter(t => t && t !== '(none yet)');
      }
    } catch (_) { }

    // Detect special cases from the answer
    const candidateTrimmed = candidateAnswer.trim().toLowerCase();
    const lastQTrimmed = lastQuestion.trim().toLowerCase();
    const isSkip = /^(i don'?t know|skip|pass|no idea|not sure|idk|no clue)$/i.test(candidateTrimmed);
    const isRepeat = /^\s*(repeat|rephrase|say that again|didn'?t understand|didn'?t get|could you repeat|what did you ask|come again|pardon|huh|repeat the question|can you repeat|repeat that)\s*[?!.]?$/i.test(candidateTrimmed);
    const isQuit = /\b(quit|stop|end this|i want to stop|end the interview|end the session|and the session|and the interview)\b/i.test(candidateTrimmed);
    const isEcho = candidateTrimmed.length > 15 && lastQTrimmed.length > 15 && (candidateTrimmed === lastQTrimmed || candidateTrimmed.startsWith(lastQTrimmed) || lastQTrimmed.startsWith(candidateTrimmed));

    if (isQuit) {
      return {
        evaluation: { score: 0, isQuit: true, isRepeatRequest: false, isOffTopic: false, offTopicSeverity: null, isStressed: false, feedback: 'Candidate quit.', conceptsMissing: [], needsFollowup: false },
        nextQuestion: `No worries at all. Thanks for joining, good luck with everything!`,
        nextTopic: 'N/A',
        nextExpectedConcepts: [],
        is_complete: true,
      };
    }

    if (isEcho) {
      return {
        evaluation: { score: 0, isQuit: false, isRepeatRequest: true, isOffTopic: false, offTopicSeverity: null, isStressed: false, feedback: 'Audio echo detected.', conceptsMissing: [], needsFollowup: false },
        nextQuestion: `I think your microphone might have just picked up my voice from your speakers! Could you repeat your answer?`,
        nextTopic: coveredTopics.slice(-1)[0] || 'Fundamentals',
        nextExpectedConcepts: [],
        is_complete: false,
      };
    }

    if (isRepeat) {
      return {
        evaluation: { score: 0, isQuit: false, isRepeatRequest: true, isOffTopic: false, offTopicSeverity: null, isStressed: false, feedback: 'Repeat requested.', conceptsMissing: [], needsFollowup: false },
        nextQuestion: `Oh yeah, my bad — let me try that differently. ${lastQuestion ? `Instead of asking "${lastQuestion}", let me put it this way: what's your general understanding of that concept and how you'd approach it in a real project?` : 'Can you walk me through how you would approach that in a real project?'}`,
        nextTopic: coveredTopics.slice(-1)[0] || 'Fundamentals',
        nextExpectedConcepts: [],
        is_complete: false,
      };
    }

    if (isSkip) {
      // Pick a new topic not yet covered from the pool
      const uncovered = MOCK_QUESTION_POOL.filter(q => !coveredTopics.includes(q.topic));
      const next = uncovered.length > 0 ? uncovered[Math.floor(Math.random() * uncovered.length)] : MOCK_QUESTION_POOL[0];
      return {
        evaluation: { score: 0, isQuit: false, isRepeatRequest: false, isOffTopic: false, offTopicSeverity: null, isStressed: false, feedback: 'Candidate skipped.', conceptsMissing: [], needsFollowup: false },
        nextQuestion: `No worries, everyone gets stuck on that one. ${next.question}`,
        nextTopic: next.topic,
        nextExpectedConcepts: next.expectedConcepts,
        is_complete: false,
      };
    }

    // Normal answer — pick a follow-up from the pool avoiding covered topics
    const uncovered = MOCK_QUESTION_POOL.filter(q => !coveredTopics.includes(q.topic));
    const nextQ = uncovered.length > 0 ? uncovered[Math.floor(Math.random() * uncovered.length)] : MOCK_QUESTION_POOL[Math.floor(Math.random() * MOCK_QUESTION_POOL.length)];
    const isComplete = questionNumber >= totalQuestions;

    // Build a contextual reaction from the candidate's actual answer
    const answerSnippet = candidateAnswer ? `"${candidateAnswer.slice(0, 60).trim()}${candidateAnswer.length > 60 ? '...' : ''}"` : 'that';
    const reactions = [
      `Right, yeah — I hear you on ${answerSnippet}. Let's keep going.`,
      `Gotcha. Okay, building on what you said — ${nextQ.question}`,
      `Makes sense. Alright, different angle — ${nextQ.question}`,
      `Yeah, that tracks. So here's a related one — ${nextQ.question}`,
    ];
    const reactionText = reactions[Math.floor(Math.random() * reactions.length)];

    return {
      evaluation: {
        score: 7,
        isQuit: false,
        isRepeatRequest: false,
        isOffTopic: false,
        offTopicSeverity: null,
        isStressed: false,
        feedback: `Answer noted. Covered topic: ${nextQ.topic}.`,
        conceptsMissing: [],
        needsFollowup: false,
      },
      nextQuestion: isComplete
        ? `Nice, that wraps it up — thanks for going through all of that with me!`
        : reactionText.includes('Let\'s keep going') ? `${reactionText} ${nextQ.question}` : reactionText,
      nextTopic: nextQ.topic,
      nextExpectedConcepts: nextQ.expectedConcepts,
      is_complete: isComplete,
    };
  }

  if (prompt.includes('GENERATE_QUESTION') || prompt.includes('Pick a NEW topic')) {
    // Parse covered topics from the prompt to pick an uncovered question
    let coveredTopics = [];
    try {
      const topicsBlock = prompt.match(/TOPICS ALREADY COVERED[^\n]*\n([\s\S]*?)(?:\n\n|\n[A-Z])/);
      if (topicsBlock) {
        coveredTopics = topicsBlock[1]
          .split('\n')
          .map(l => l.replace(/^\s*\d+\.\s*/, '').trim())
          .filter(t => t && t !== 'None yet' && t !== '(none yet)');
      }
    } catch (_) { }

    const uncovered = MOCK_QUESTION_POOL.filter(q => !coveredTopics.includes(q.topic));
    const pool = uncovered.length > 0 ? uncovered : MOCK_QUESTION_POOL;
    const picked = pool[Math.floor(Math.random() * pool.length)];

    return { ...picked, text: picked.question, stage: 'GENERATE_QUESTION' };
  }

  if (prompt.includes('EVALUATE_ANSWER') || prompt.includes('evaluating a candidate')) {
    return {
      score: 7,
      rating: 'Good',
      conceptsCovered: [],
      conceptsMissing: [],
      feedback: 'Answer noted.',
      needsFollowup: false,
      followupReason: '',
    };
  }

  if (prompt.includes('FOLLOWUP_QUESTION') || prompt.includes('follow-up')) {
    const uncovered = MOCK_QUESTION_POOL.filter(q => !prompt.includes(q.topic));
    const picked = uncovered.length > 0 ? uncovered[0] : MOCK_QUESTION_POOL[0];
    return {
      question: picked.question,
      topic: picked.topic,
      type: 'followup',
      stage: 'FOLLOWUP',
    };
  }

  if (prompt.includes('FINAL_EVALUATION') || prompt.includes('interview is complete') || prompt.includes('hiring manager')) {
    // Parse job role and covered topics to build a slightly contextual report
    let jobRole = 'developer';
    let coveredTopics = [];
    try {
      const roleMatch = prompt.match(/ROLE(?:\s*BEING ASSESSED)?[:\s]*([^\n(]+)/i);
      if (roleMatch) jobRole = roleMatch[1].trim().replace(/\(.*\)/, '').trim();

      const topicsBlock = prompt.match(/TOPICS ALREADY COVERED[^\n]*\n([\s\S]*?)(?:\n\n|\n[A-Z])/);
      if (topicsBlock) {
        coveredTopics = topicsBlock[1]
          .split('\n')
          .map(l => l.replace(/^\s*\d+\.\s*/, '').trim())
          .filter(t => t && t !== '(none yet)');
      }
    } catch (_) { }

    const topicBreakdown = coveredTopics.slice(0, 5).map(t => ({
      topic: t,
      score: Math.floor(Math.random() * 4) + 5, // 5–9
      comment: 'Assessed during the session.',
    }));

    return {
      overallScore: 68,
      recommendation: 'FURTHER_INTERVIEW',
      hiringJustification: `Candidate demonstrated reasonable understanding of ${jobRole} concepts but would benefit from a deeper technical round to confirm production-level experience.`,
      technicalScore: 65,
      communicationScore: 72,
      problemSolvingScore: 67,
      strengths: [`Showed familiarity with core ${jobRole} concepts`, 'Communicated ideas clearly'],
      weaknesses: ['Some answers lacked depth on edge cases', 'Did not demonstrate advanced architecture knowledge'],
      improvements: [`Study advanced ${jobRole} patterns`, 'Practice explaining trade-offs out loud'],
      topicBreakdown: topicBreakdown.length > 0 ? topicBreakdown : [{ topic: `${jobRole} Fundamentals`, score: 7, comment: 'General assessment.' }],
      categories: {
        roleAlignment: `The candidate's background aligns reasonably with the ${jobRole} requirements.`,
        technicalCompetencies: 'Demonstrated working knowledge of core concepts; deeper verification recommended.',
        communication: 'Explained concepts in understandable terms.',
        problemSolving: 'Showed structured thinking when approaching questions.',
      },
      summary: `The candidate showed a reasonable grasp of ${jobRole} fundamentals during this session. Communication was clear and they worked through questions with some structure. Recommend a follow-up technical round for deeper verification.`,
      integrityNote: 'No integrity issues detected.',
    };
  }

  return { text: "Got it. Let's keep going.", nextQuestion: "Got it. Let's keep going.", stage: 'UNKNOWN' };
};



const groqReady = !isPlaceholder(config.groqApiKey);
const geminiReady = !isPlaceholder(config.geminiApiKey);

/**
 * AI Service for reasoning.
 *
 * Priority: Gemini (Primary) → Groq (Fallback) → Dynamic Mock (last resort only)
 *
 * Dev and production behave identically — real AI providers are always tried first.
 * The mock is ONLY used if both Gemini and Groq fail or are unconfigured.
 */
export const aiService = {
  async generateCompletion(prompt, options = {}) {

    // ── Try Gemini (Primary - Cost-Effective 2.5 Flash) ──────────────────────
    if (geminiReady && genAI) {
      try {
        const result = await genAI.models.generateContent({
          model: 'gemini-2.5-flash-lite',
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const text = result.text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const cleanedText = jsonMatch ? jsonMatch[0] : text;

        if (validateResponse(cleanedText)) {
          log.success('Gemini 2.5 Flash (Primary) → response OK');
          return extractCleanJSON(cleanedText);
        }
        log.warn('Gemini response invalid/empty — trying Groq fallback...');
      } catch (geminiError) {
        log.warn(`Gemini Error: ${geminiError.message} — trying Groq fallback...`);
      }
    }

    // ── Try Groq (Fallback) ───────────────────────────────────────────────────
    if (groqReady) {
      try {
        const client = getGroqClient();
        if (!client) throw new Error('Groq client not initialized');

        const groqResponse = await client.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: options.model || 'llama-3.3-70b-versatile',
          response_format: { type: 'json_object' },
        });

        const content = groqResponse.choices[0]?.message?.content;

        if (content && validateResponse(content)) {
          log.success('Groq Llama 3.3 70B (Fallback) → response OK');
          return extractCleanJSON(content);
        }

        log.warn('Invalid or empty Groq content — falling back to mock');
      } catch (error) {
        log.warn(`Groq Fallback Error: ${error.message}`);
      }
    }

    // ── Last resort: dynamic mock (only if no API keys are configured) ────────
    log.warn('⚡ No AI providers available — using dynamic mock. Set GEMINI_API_KEY or GROQ_API_KEY.');
    return getMockResponse(prompt);
  }
};
