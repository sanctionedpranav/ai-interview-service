/**
 * AI Interview Processing Queue
 *
 * Wraps interviewGraph.invoke() in a BullMQ worker so that concurrent
 * requests are processed with controlled concurrency (default: 20).
 * This prevents the AI/LLM service from being overwhelmed and avoids
 * timeout/rate-limit errors under high load (300-500 concurrent users).
 *
 * Architecture:
 *   HTTP Request → Queue Job → Worker (concurrency=20) → interviewGraph.invoke()
 *
 * The controller enqueues a job, then waits for its result using
 * job.waitUntilFinished(queueEvents). This keeps HTTP responses synchronous
 * from the client's perspective while server-side processing is throttled.
 */
import { Queue, Worker, QueueEvents } from 'bullmq';
import { interviewGraph } from '../langgraph/graph.js';
import { log } from '../utils/logger.js';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const connection = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null, // Required for BullMQ workers
};

const QUEUE_NAME = 'ai-interview-processing';
const CONCURRENCY = parseInt(process.env.AI_INTERVIEW_CONCURRENCY) || 20;

// ── Queue ─────────────────────────────────────────────────────────────────────
export const interviewQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 2,
        backoff: {
            type: 'exponential',
            delay: 3000,
        },
        removeOnComplete: true,
        removeOnFail: { age: 3600 }, // Keep failed jobs for 1 hour
    },
});

// ── QueueEvents (for waitUntilFinished) ───────────────────────────────────────
export const interviewQueueEvents = new QueueEvents(QUEUE_NAME, { connection });

// ── Worker ────────────────────────────────────────────────────────────────────
const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        const { graphState } = job.data;
        log.info(`[Queue] Processing job ${job.id} | mode=${graphState.mode} | session=${graphState.sessionId}`);

        const result = await interviewGraph.invoke(graphState);
        return result;
    },
    {
        connection,
        concurrency: CONCURRENCY,
    }
);

worker.on('completed', (job) => {
    log.info(`[Queue] ✅ Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
    log.error(`[Queue] ❌ Job ${job.id} failed after ${job.attemptsMade} attempt(s): ${err.message}`);
});

worker.on('error', (err) => {
    log.error('[Queue] Worker error:', err.message);
});

log.success(`[Queue] ai-interview-processing worker started (concurrency=${CONCURRENCY})`);

export default interviewQueue;
