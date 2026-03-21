import { ttsService } from './src/speech/tts.js';
import { log } from './src/utils/logger.js';

async function testTTS() {
  const text = "Hi there! I'm happy to help you with your interview today. Let's start with a simple question: What is React?";
  console.time('TTS Generation');
  try {
    const url = await ttsService.speak(text, 'test-session');
    console.timeEnd('TTS Generation');
    console.log('Audio URL:', url);
  } catch (err) {
    console.error('TTS Failed:', err);
  }
}

testTTS();
