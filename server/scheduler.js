/**
 * The work nobody triggers.
 *
 * Reading the mailbox, sending what is due, reconciling the calendars, retiring
 * finished stays. Four jobs on four intervals, each of which has to survive the
 * things that actually happen to a small server: a poll that takes longer than its
 * own interval, Google being down for ten minutes, a deploy in the middle of a run.
 *
 * So the rules are:
 *
 *   never overlapping   a job already running is not started again. The next tick
 *                       is skipped, counted, and that is all — because two Gmail
 *                       polls at once is the one way to get past the de-duplication
 *                       and send a guest two guides.
 *   backoff on failure  consecutive failures double the wait, up to an hour. A
 *                       mailbox that is down does not need to be asked every minute,
 *                       and the logs stay readable.
 *   nothing is lost     a failed run changes nothing. The mailbox keeps its
 *                       messages, the deliveries keep their due date, and the next
 *                       successful run does the work.
 *   it says what it did `state()` is what `/api/health` and the Staff app read: last
 *                       run, last success, last error, consecutive failures, whether
 *                       it is running right now.
 *
 * The clock is injected so the tests can run a day in a millisecond.
 */

const MAX_BACKOFF_TICKS = 8;

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {number} intervalMinutes   0 disables the job
 * @property {() => Promise<any>} run
 * @property {boolean} [enabled]        false means deliberately off, not broken
 * @property {string} [requires]        why it is off, when it is
 */

export function createScheduler({ jobs = [], logger = console } = {}) {
  const registry = new Map();

  for (const job of jobs) {
    registry.set(job.id, {
      ...job,
      enabled: job.enabled !== false && Number(job.intervalMinutes) > 0,
      running: false,
      timer: null,
      runs: 0,
      failures: 0,
      consecutiveFailures: 0,
      skipped: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastResult: null,
      backoffTicks: 0,
    });
  }

  /**
   * Run one job now, unless it is already running.
   *
   * Returns what happened rather than throwing: a scheduled job that throws takes
   * the interval with it, and a job failing is an ordinary Tuesday.
   */
  async function runJob(id, { force = false } = {}) {
    const job = registry.get(id);
    if (!job) return { ok: false, reason: 'unknown-job' };
    if (job.running) {
      job.skipped += 1;
      return { ok: false, reason: 'already-running', skipped: job.skipped };
    }
    if (!force && job.backoffTicks > 0) {
      job.backoffTicks -= 1;
      return { ok: false, reason: 'backing-off', remaining: job.backoffTicks };
    }

    job.running = true;
    job.lastRunAt = new Date().toISOString();
    try {
      const result = await job.run();
      job.runs += 1;
      job.consecutiveFailures = 0;
      job.backoffTicks = 0;
      job.lastSuccessAt = new Date().toISOString();
      job.lastError = null;
      job.lastResult = summarise(result);
      return { ok: true, result };
    } catch (error) {
      job.failures += 1;
      job.consecutiveFailures += 1;
      job.lastError = String(error?.message ?? error).slice(0, 300);
      // 1, 2, 4, 8 … ticks, capped. The first failure is often a blip.
      job.backoffTicks = Math.min(MAX_BACKOFF_TICKS, 2 ** (job.consecutiveFailures - 1));
      logger.warn?.(`[schedule] ${id} failed (${job.consecutiveFailures}×): ${job.lastError}`);
      return { ok: false, reason: 'failed', error: job.lastError };
    } finally {
      job.running = false;
    }
  }

  function start() {
    for (const job of registry.values()) {
      if (!job.enabled || job.timer) continue;
      const every = Math.max(1, Number(job.intervalMinutes)) * 60_000;
      job.timer = setInterval(() => { runJob(job.id).catch(() => {}); }, every);
      job.timer.unref?.();
    }
    return state();
  }

  function stop() {
    for (const job of registry.values()) {
      if (job.timer) clearInterval(job.timer);
      job.timer = null;
    }
  }

  /** What the health screen reads. No functions, no timers, nothing circular. */
  function state() {
    return [...registry.values()].map((job) => ({
      id: job.id,
      enabled: job.enabled,
      intervalMinutes: Number(job.intervalMinutes) || 0,
      requires: job.requires ?? null,
      running: job.running,
      runs: job.runs,
      failures: job.failures,
      consecutiveFailures: job.consecutiveFailures,
      skippedBecauseRunning: job.skipped,
      backingOff: job.backoffTicks > 0,
      lastRunAt: job.lastRunAt,
      lastSuccessAt: job.lastSuccessAt,
      lastError: job.lastError,
      lastResult: job.lastResult,
      status: statusOf(job),
    }));
  }

  return { start, stop, runJob, state, has: (id) => registry.has(id) };
}

function statusOf(job) {
  if (!job.enabled) return 'disabled';
  if (job.running) return 'running';
  if (job.consecutiveFailures > 0) return 'failing';
  if (job.lastSuccessAt) return 'operational';
  return 'idle';
}

/** Keep a short, readable trace of the last run rather than a whole payload. */
function summarise(result) {
  if (result == null || typeof result !== 'object') return result ?? null;
  const out = {};
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.length;
  }
  return out;
}
