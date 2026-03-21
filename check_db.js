
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const schema = new mongoose.Schema({ sessionId: String, createdAt: Date }, { strict: false });
const Session = mongoose.model('InterviewSession', schema);

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const recent = await Session.find().sort({ createdAt: -1 }).limit(5);
  console.log('RECENT_SESSIONS:', JSON.stringify(recent));
  process.exit(0);
}
check();
