import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Set up env for Piper
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_ENV = 'development';
// Need to set dotenv if Gemini is needed, but let's see if piper works without it

import { ttsService } from './src/speech/tts.js';

async function testTTS() {
    console.log("Checking TTS availability...");
    const available = ttsService.isAvailable();
    console.log(`TTS Available: ${available}`);
    
    if (available) {
        console.log("Attempting synthesis...");
        try {
            const url = await ttsService.speak("Hello! This is a test of the Piper text to speech engine.", "test-session-123");
            console.log(`Synthesis successful! Audio available at: ${url}`);
            
            // Check if file exists
            const outputPath = path.join(process.cwd(), 'public', url);
            if (fs.existsSync(outputPath)) {
                console.log(`Verified file exists: ${outputPath}`);
                const stats = fs.statSync(outputPath);
                console.log(`File size: ${stats.size} bytes`);
            } else {
                console.error("URL returned but file not found on disk!");
            }
        } catch (e) {
            console.error("Synthesis failed:", e);
        }
    }
}

testTTS();
