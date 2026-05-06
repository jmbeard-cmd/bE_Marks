// src/utils/startup-scheduler.ts

import { isAppBusy, subscribeToAppActivity } from './app-activity';

type StartupJobPriority = 'soon' | 'idle';

type StartupJob = {
  id: string;
  label: string;
  priority?: StartupJobPriority;
  run: () => Promise<void>;
};

type QueuedStartupJob = StartupJob & {
  notBefore: number;
};

let queue: QueuedStartupJob[] = [];
let running = false;
let started = false;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;

const SOON_DELAY_MS = 2500;
const IDLE_DELAY_MS = 10000;
const BETWEEN_JOBS_DELAY_MS = 2500;
const RESUME_AFTER_ACTIVITY_MS = 1800;

function scheduleNext(delayMs: number) {
  if (nextTimer) {
    clearTimeout(nextTimer);
  }

  nextTimer = setTimeout(() => {
    void processQueue();
  }, delayMs);
}

function sortQueue() {
  queue.sort((a, b) => {
    if (a.notBefore !== b.notBefore) {
      return a.notBefore - b.notBefore;
    }

    const aPriority = a.priority === 'soon' ? 0 : 1;
    const bPriority = b.priority === 'soon' ? 0 : 1;

    return aPriority - bPriority;
  });
}

async function processQueue() {
  if (running) return;

  if (isAppBusy()) {
    console.log('[startup-scheduler] app busy, waiting');
    return;
  }

  sortQueue();

  const now = Date.now();
  const nextJob = queue[0];

  if (!nextJob) return;

  if (nextJob.notBefore > now) {
    scheduleNext(nextJob.notBefore - now);
    return;
  }

  const job = queue.shift();
  if (!job) return;

  running = true;

  try {
    if (isAppBusy()) {
      console.log('[startup-scheduler] paused before running:', job.label);
      queue.unshift(job);
      return;
    }

    console.log('[startup-scheduler] running:', job.label);
    await job.run();
    console.log('[startup-scheduler] complete:', job.label);
  } catch (error) {
    console.warn('[startup-scheduler] job failed:', job.label, error);
  } finally {
    running = false;
  }

  if (queue.length > 0) {
    scheduleNext(BETWEEN_JOBS_DELAY_MS);
  }
}

export function enqueueStartupJob(job: StartupJob) {
  const exists = queue.some((item) => item.id === job.id);

  if (exists) {
    console.log('[startup-scheduler] duplicate skipped:', job.label);
    return;
  }

  const delayMs = job.priority === 'soon' ? SOON_DELAY_MS : IDLE_DELAY_MS;

  queue.push({
    ...job,
    notBefore: Date.now() + delayMs,
  });

  sortQueue();

  console.log(
    '[startup-scheduler] queued:',
    job.label,
    'delay:',
    delayMs
  );

  scheduleNext(delayMs);
}

export function startStartupScheduler() {
  if (started) return;
  started = true;

  subscribeToAppActivity(() => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
    }

    if (isAppBusy()) {
      console.log('[startup-scheduler] activity active, holding jobs');
      return;
    }

    resumeTimer = setTimeout(() => {
      void processQueue();
    }, RESUME_AFTER_ACTIVITY_MS);
  });

  scheduleNext(3000);
}

export function clearStartupJobs() {
  queue = [];

  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }

  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }

  running = false;
}