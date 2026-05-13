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
let schedulerVersion = 0;

let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeActivity: (() => void) | null = null;

const SOON_DELAY_MS = 2500;
const IDLE_DELAY_MS = 10000;
const BETWEEN_JOBS_DELAY_MS = 1800;
const RESUME_AFTER_ACTIVITY_MS = 1800;

function getDelayForPriority(priority?: StartupJobPriority) {
  return priority === 'soon' ? SOON_DELAY_MS : IDLE_DELAY_MS;
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

function clearResumeTimer() {
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

function clearNextTimer() {
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
}

function runWhenIdle(callback: () => void) {
  const requestIdle =
    typeof globalThis !== 'undefined'
      ? (globalThis as any).requestIdleCallback
      : undefined;

  if (typeof requestIdle === 'function') {
    requestIdle(() => callback(), { timeout: 2500 });
    return;
  }

  setTimeout(callback, 0);
}

function scheduleProcess(delayMs: number) {
  clearNextTimer();

  nextTimer = setTimeout(() => {
    nextTimer = null;

    runWhenIdle(() => {
      void processQueue(schedulerVersion);
    });
  }, Math.max(0, delayMs));
}

function scheduleNextQueuedJob() {
  if (running) return;

  sortQueue();

  const nextJob = queue[0];

  if (!nextJob) return;

  const delayMs = Math.max(0, nextJob.notBefore - Date.now());

  scheduleProcess(delayMs);
}

async function yieldToUI() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function processQueue(versionAtStart: number) {
  if (running) return;
  if (versionAtStart !== schedulerVersion) return;

  if (isAppBusy()) {
    scheduleProcess(RESUME_AFTER_ACTIVITY_MS);
    return;
  }

  sortQueue();

  const now = Date.now();
  const nextJob = queue[0];

  if (!nextJob) return;

  if (nextJob.notBefore > now) {
    scheduleNextQueuedJob();
    return;
  }

  const job = queue.shift();

  if (!job) return;

  running = true;

  try {
    if (isAppBusy()) {
      queue.unshift(job);
      return;
    }

    console.log('[startup-scheduler] running:', job.label);

    await yieldToUI();

    if (versionAtStart !== schedulerVersion) return;

    await job.run();

    if (versionAtStart !== schedulerVersion) return;

    await yieldToUI();

    console.log('[startup-scheduler] complete:', job.label);
  } catch (error) {
    console.warn('[startup-scheduler] job failed:', job.label, error);
  } finally {
    running = false;
  }

  if (versionAtStart !== schedulerVersion) return;

  if (queue.length > 0) {
    sortQueue();

    const delayUntilNextJob = Math.max(
      BETWEEN_JOBS_DELAY_MS,
      queue[0].notBefore - Date.now()
    );

    scheduleProcess(delayUntilNextJob);
  }
}

export function enqueueStartupJob(job: StartupJob) {
  const delayMs = getDelayForPriority(job.priority);
  const notBefore = Date.now() + delayMs;

  const existingIndex = queue.findIndex(item => item.id === job.id);

  if (existingIndex >= 0) {
    queue[existingIndex] = {
      ...job,
      notBefore: Math.min(queue[existingIndex].notBefore, notBefore),
    };

    scheduleNextQueuedJob();
    return;
  }

  queue.push({
    ...job,
    notBefore,
  });

  sortQueue();
  scheduleNextQueuedJob();
}

export function startStartupScheduler() {
  if (started) {
    scheduleNextQueuedJob();
    return;
  }

  started = true;

  const possibleUnsubscribe = subscribeToAppActivity(() => {
    clearResumeTimer();

    if (isAppBusy()) {
      return;
    }

    resumeTimer = setTimeout(() => {
      resumeTimer = null;

      runWhenIdle(() => {
        void processQueue(schedulerVersion);
      });
    }, RESUME_AFTER_ACTIVITY_MS);
  });

  if (typeof possibleUnsubscribe === 'function') {
    unsubscribeActivity = possibleUnsubscribe;
  }

  scheduleProcess(3000);
}

export function clearStartupJobs() {
  schedulerVersion += 1;
  queue = [];

  clearResumeTimer();
  clearNextTimer();

  if (unsubscribeActivity) {
    unsubscribeActivity();
    unsubscribeActivity = null;
  }

  running = false;
  started = false;
}