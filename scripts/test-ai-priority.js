import { aiService } from '../src/ai/aiService.js';
import { log } from '../src/utils/logger.js';

async function runTest() {
  console.log('--- Starting LLM Priority Test ---');
  
  const prompt = "INTRODUCTION: Greet the candidate for a Software Engineer role.";
  
  try {
    console.log('\n1. Testing with current configuration (Gemini Primary)...');
    const response = await aiService.generateCompletion(prompt);
    console.log('Response stage:', response.stage);
  } catch (error) {
    console.error('Test failed:', error);
  }

  // To truly test fallback without changing env, we'd need to mock.
  // But we can check the logs from the previous successful run.
}

runTest();
