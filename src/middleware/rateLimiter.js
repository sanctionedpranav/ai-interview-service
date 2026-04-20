/**
 * rateLimiter.js
 *
 * express-rate-limit middleware configurations for the AI Interview service.
 *
 * Endpoints protected:
 *   POST /interview/start        — 3 new sessions per userId per hour
 *   POST /interview/answer       — 10 requests per sessionId per minute
 *   POST /interview/audio        — 10 requests per sessionId per minute
 *   POST /cheating-event         — 60 events per sessionId per minute (high-frequency client calls)
 */

import rateLimit from 'express-rate-limit';

/**
 * keyGenerator helper: uses sessionId from body when available, falls back to IP.
 * This prevents session-level flooding even behind a shared proxy.
 */
const sessionOrIpKey = (req) =>
  (req.body && (req.body.sessionId || req.body.userId)) || req.ip;

// ── /interview/start ──────────────────────────────────────────────────────────
// Prevent users from mass-creating sessions (e.g. bot scripts or exam fraud).
export const startLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 starts per userId per hour (relaxed from 3 to handle legitimate retries)
  keyGenerator: (req) => (req.body?.userId) || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many interview sessions created. Please wait before starting a new one.',
    retryAfter: '1 hour',
  },
  skip: (req) => !req.body?.userId, // Let missing-userId be caught by the controller validator
});

// ── /interview/answer & /interview/audio ──────────────────────────────────────
// Prevent flooding the evaluate_answer graph node via automated scripts.
export const answerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: sessionOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many answer submissions. Please slow down.',
    retryAfter: '1 minute',
  },
});

// ── /interview/cheating-event ──────────────────────────────────────────────────
// The client fires these events frequently (focus/blur, etc.), so the limit is higher.
export const cheatingEventLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  keyGenerator: sessionOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many security events reported. Rate limit exceeded.',
  },
});

// ── /interview/silence ─────────────────────────────────────────────────────────
// Silence is triggered by the client every ~30s at most — still cap in case of loops.
export const silenceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: sessionOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many silence events. Please wait.',
  },
});
