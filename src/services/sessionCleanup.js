/**
 * Session Cleanup Service (M12)
 *
 * Runs periodically to expire abandoned interview sessions.
 * A session is considered "abandoned" if:
 *  - It has been in INTRODUCTION stage for > 30 minutes (user never started)
 *  - It has been in any active stage for > 3 hours without ending (crash / tab close)
 *
 * This is intentionally lightweight — no LLM calls, just a DB write.
 */

import { InterviewSession } from '../models/InterviewSession.js';
import { log } from '../utils/logger.js';

const ABANDONED_THRESHOLD_MS  = 30 * 60 * 1000;  // 30 min — never started
const STALE_ACTIVE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours — started but never ended

export const runSessionCleanup = async () => {
    try {
        const now = new Date();

        // 1. Sessions still in INTRODUCTION that are older than 30 minutes
        const abandonedCutoff = new Date(now - ABANDONED_THRESHOLD_MS);
        const abandoned = await InterviewSession.updateMany(
            {
                interviewStage: 'INTRODUCTION',
                createdAt: { $lt: abandonedCutoff },
            },
            {
                $set: {
                    interviewStage: 'END',
                    endTime: now,
                    'metadata.closeReason': 'abandoned_before_start',
                },
            }
        );

        // 2. Sessions that started but never ended within 3 hours
        const staleCutoff = new Date(now - STALE_ACTIVE_THRESHOLD_MS);
        const stale = await InterviewSession.updateMany(
            {
                interviewStage: { $in: ['INTRODUCTION', 'TECHNICAL', 'FINAL_EVALUATION'] },
                endTime: { $exists: false },
                createdAt: { $lt: staleCutoff },
            },
            {
                $set: {
                    interviewStage: 'END',
                    endTime: now,
                    'metadata.closeReason': 'expired_ttl',
                },
            }
        );

        if (abandoned.modifiedCount > 0 || stale.modifiedCount > 0) {
            log.info(`🧹 Session cleanup: ${abandoned.modifiedCount} abandoned, ${stale.modifiedCount} stale sessions expired.`);
        }
    } catch (err) {
        log.error('Session cleanup failed:', err.message);
    }
};
