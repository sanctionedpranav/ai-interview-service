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
  getInterviewResult,
} from '../controllers/interviewController.js';
import {
  startLimiter,
  answerLimiter,
  cheatingEventLimiter,
  silenceLimiter,
} from '../middleware/rateLimiter.js';

const router = express.Router();

// Max audio file size: 5 MB (prevents large pre-recorded files & upload abuse — Edge Case 7.3)
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Edge Case 3.11: reject non-audio MIME types
    if (!file.mimetype.startsWith('audio/')) {
      return cb(new Error('Only audio files are accepted'), false);
    }
    cb(null, true);
  },
});

// Multer error handler for invalid file type / size
const audioUpload = (req, res, next) => {
  upload.single('audio')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Audio file too large. Maximum size is 5 MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

// ── Routes ────────────────────────────────────────────────────────────────────
router.post('/start', startLimiter, startInterview);
router.post('/audio', answerLimiter, audioUpload, processAudio);
router.post('/answer', answerLimiter, submitTextAnswer);
router.post('/silence', silenceLimiter, handleSilence);
router.post('/quit', quitInterview);
router.post('/enable-protection', enableProtection);
router.post('/disable-protection', disableProtection);
router.post('/cheating-event', cheatingEventLimiter, recordCheatingEvent);
router.get('/state/:sessionId', getSessionState);
router.get('/result/:sessionId', getInterviewResult);

export default router;
