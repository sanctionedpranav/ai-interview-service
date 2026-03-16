import express from 'express';
import multer from 'multer';
import { 
  startInterview, 
  processAudio,
  submitTextAnswer,
  recordCheatingEvent, 
  getSessionState, 
  getInterviewResult 
} from '../controllers/interviewController.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/start', startInterview);
router.post('/audio', upload.single('audio'), processAudio);
router.post('/answer', submitTextAnswer);
router.post('/cheating-event', recordCheatingEvent);
router.get('/state/:sessionId', getSessionState);
router.get('/result/:sessionId', getInterviewResult);

export default router;
