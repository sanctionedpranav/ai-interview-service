import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 5005,
  mongodbUri: process.env.MONGODB_URI,
  groqApiKey: process.env.GROQ_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  nodeEnv: process.env.NODE_ENV || 'development',
};
