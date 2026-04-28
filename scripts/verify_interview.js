import { interviewGraph } from '../src/langgraph/graph.js';
import { aiService } from '../src/ai/aiService.js';
import { log } from '../src/utils/logger.js';

// Mock AI Service to simulate specific interview stages
let callCount = 0;
aiService.generateCompletion = async (prompt) => {
    callCount++;
    console.log(`\n--- LLM CALL #${callCount} ---`);
    
    // Check if rollingHistory is passed
    if (prompt.includes('RECENT TECHNICAL CONVERSATION')) {
        console.log('✅ Rolling History found in prompt!');
    }

    if (callCount === 1) {
        // Intro response
        return {
            text: "Great! Tell me about yourself.",
            is_complete: false
        };
    }
    
    if (callCount >= 6) {
        // AI wants to end
        return {
            evaluation: { score: 8, feedback: "Good effort." },
            nextQuestion: "That's it for today!",
            is_complete: true
        };
    }

    return {
        evaluation: { score: 7, feedback: "Keep going." },
        nextQuestion: `Question ${callCount}?`,
        is_complete: false
    };
};

// Mock the evaluation generator for feedback summary
aiService.generateEvaluation = async () => {
    return {
        summary: "You did a fantastic job today. Your technical foundation is strong, especially in JavaScript. Keep practicing system design!",
        overallScore: 85
    };
};

async function runTest() {
    console.log('🚀 Starting Interview Verification Test...');
    
    let state = {
        mode: 'start',
        jobRole: 'Full Stack Developer',
        maxQuestions: 5,
        questionCount: 0,
        answerHistory: [],
        questionHistory: []
    };

    // 1. Start Interview
    console.log('\nSTEP 1: Starting');
    state = await interviewGraph.invoke(state);
    console.log('Current Question:', state.currentQuestion);

    // 2. Loop through 5 questions
    for (let i = 1; i <= 6; i++) {
        console.log(`\nSTEP ${i + 1}: Answering Question ${i}`);
        state.mode = 'answer';
        state.currentAnswer = "I have experience with React and Node.js.";
        state = await interviewGraph.invoke(state);
        console.log('Count:', state.questionCount, '/', state.maxQuestions);
        console.log('Next Question:', state.currentQuestion);
        console.log('Is Complete:', state.is_complete);
        
        if (state.is_complete) break;
    }

    // 3. Verify Final Feedback
    console.log('\nSTEP FINAL: Checking Feedback');
    if (state.currentQuestion.includes('fantastic job')) {
        console.log('✅ SUCCESS: Final feedback summary received!');
    } else {
        console.log('❌ FAIL: Final feedback summary missing. Got:', state.currentQuestion);
    }
    
    console.log('\nDone.');
    process.exit(0);
}

runTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
