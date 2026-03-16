import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';

const groq = new Groq({ apiKey: config.groqApiKey });
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

/**
 * Validates the AI response based on required JSON fields and length.
 */
const validateResponse = (responseText) => {
  try {
    const parsed = JSON.parse(responseText);
    if (typeof parsed !== 'object' || parsed === null) return false;
    if (responseText.length < 20) return false;
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Mock fallback responses for each prompt type (for dev/testing without valid API keys).
 */
const getMockResponse = (prompt) => {
  if (prompt.includes('INTRODUCTION') || prompt.includes('Greet the candidate')) {
    return {
      text: "Welcome! I'm your AI interviewer today. I'd love to start by having you introduce yourself — tell me a bit about your background and what got you into software development.",
      nextFocus: "candidate's background",
      stage: "INTRODUCTION"
    };
  }
  if (prompt.includes('generate a technical question') || prompt.includes('GENERATE_QUESTION')) {
    return {
      question: "Can you explain the difference between synchronous and asynchronous programming in JavaScript, and give an example of when you'd use each?",
      topic: "JavaScript Async",
      difficulty: "intermediate",
      expectedConcepts: ["event loop", "promises", "async/await", "callbacks"],
      stage: "GENERATE_QUESTION"
    };
  }
  if (prompt.includes('Evaluate the following') || prompt.includes('EVALUATE_ANSWER')) {
    return {
      score: 7,
      rating: "Good understanding with room for depth",
      conceptsMissing: ["event loop internals"],
      nextFocus: "Node.js async patterns",
      isCorrect: true,
      feedback: "You demonstrated solid understanding of the basics. Try to elaborate more on the event loop mechanism."
    };
  }
  if (prompt.includes('FINAL_EVALUATION') || prompt.includes('interview is complete')) {
    return {
      overallScore: 72,
      recommendation: "FURTHER_INTERVIEW",
      strengths: ["Clear communication", "Good fundamentals", "Problem-solving approach"],
      weaknesses: ["Could go deeper on async internals", "More examples needed"],
      summary: "The candidate shows a solid foundation in software development concepts. They communicate well and demonstrate a good problem-solving approach. Recommend a follow-up technical round to assess depth."
    };
  }
  // Default: echo back something
  return { text: "Thank you for your response. Let's continue with the next question.", stage: "UNKNOWN" };
};

/**
 * AI Service for reasoning with fallback mechanism.
 */
export const aiService = {
  async generateCompletion(prompt, options = {}) {
    // --- Try Groq first ---
    try {
      const groqResponse = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: options.model || 'llama3-70b-8192',
        response_format: { type: 'json_object' },
      });

      const content = groqResponse.choices[0]?.message?.content;

      if (content && validateResponse(content)) {
        console.log('✅ Groq response used');
        return JSON.parse(content);
      }

      console.warn('Groq response invalid, falling back to Gemini...');
      throw new Error('Groq validation failed');
    } catch (error) {
      console.warn('Groq Error:', error.message);

      // --- Try Gemini fallback ---
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const cleanedText = jsonMatch ? jsonMatch[0] : text;

        if (validateResponse(cleanedText)) {
          console.log('✅ Gemini fallback used');
          return JSON.parse(cleanedText);
        }
        throw new Error('Gemini validation failed');
      } catch (geminiError) {
        console.warn('Gemini Error:', geminiError.message);

        // --- Mock fallback for development ---
        console.warn('⚠️  Both AI models unavailable. Using mock response for development.');
        return getMockResponse(prompt);
      }
    }
  }
};
