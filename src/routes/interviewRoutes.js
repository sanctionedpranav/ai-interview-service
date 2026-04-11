import express from 'express';
import multer from 'multer';
import { 
  startInterview, 
  processAudio,
  submitTextAnswer,
  quitInterview,
  handleSilence,
  recordCheatingEvent,
  enableProtection,
  disableProtection,
  getSessionState, 
  getInterviewResult 
} from '../controllers/interviewController.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/start', startInterview);
router.post('/audio', upload.single('audio'), processAudio);
router.post('/answer', submitTextAnswer);
router.post('/silence', handleSilence);
router.post('/quit', quitInterview);
router.post('/enable-protection', enableProtection);
router.post('/disable-protection', disableProtection);
router.post('/cheating-event', recordCheatingEvent);
router.get('/state/:sessionId', getSessionState);
router.get('/result/:sessionId', getInterviewResult);

export default router;
