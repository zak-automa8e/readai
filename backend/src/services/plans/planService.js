const supabaseService = require('../supabaseService');

/**
 * Subscription plans with a daily page limit (spec §3, O12). Reads here never count anything;
 * counting happens only through record_page_listen when audio is handed out.
 *
 * The plan rules mirror record_page_listen: an active subscription that has not ended gives its
 * plan; anything else is the free plan. The day is the UTC date.
 */

const FREE_PLAN_ID = 'free';

function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// When today's count starts over: the next UTC midnight
function nextResetUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function activePlanOf(subscription, now = new Date()) {
  if (!subscription || subscription.status !== 'active' || !subscription.plans) return null;
  if (subscription.ends_at && Date.parse(subscription.ends_at) <= now.getTime()) return null;
  return subscription.plans;
}

/**
 * The user's plan and today's usage.
 * @param {string} userId
 * @param {{bookId?: string, voiceHash?: string, now?: Date}} [options] with bookId and voiceHash,
 *   `countedPages` lists the pages of that book already heard in that voice on any day (listening
 *   to them again is free)
 * @returns {Promise<{plan: string, name: string, limit: number, usedToday: number, remainingToday: number, countedPages: Set<number>}>}
 */
async function getPlanUsage(userId, { bookId = null, voiceHash = null, now = new Date() } = {}) {
  const [subscription, usage, heard] = await Promise.all([
    supabaseService.getSubscription(userId),
    supabaseService.getDailyPageUsage(userId, todayUtc(now)),
    bookId && voiceHash ? supabaseService.getHeardPages(userId, bookId, voiceHash) : [],
  ]);
  const plan = activePlanOf(subscription, now) || await supabaseService.getPlan(FREE_PLAN_ID);
  if (!plan) throw new Error('The free plan row is missing from plans');

  const limit = plan.daily_page_limit;
  const usedToday = usage.length;
  return {
    plan: plan.id,
    name: plan.name,
    limit,
    usedToday,
    remainingToday: Math.max(limit - usedToday, 0),
    countedPages: new Set(heard),
  };
}

/**
 * Count pages toward today's limit, in order, stopping at the first page that is not allowed.
 * Pages heard before in this voice (any day) are allowed and not counted again.
 * @param {string} userId
 * @param {string} bookId
 * @param {number[]} pages
 * @param {string} voiceHash
 * @returns {Promise<{allowed: boolean, used: number|null, limit: number|null, plan: string|null, counted: number[]}>}
 */
async function recordPageListens(userId, bookId, pages, voiceHash) {
  const counted = [];
  let last = null;
  for (const page of pages) {
    last = await supabaseService.recordPageListen(userId, bookId, page, voiceHash);
    if (!last.allowed) return { allowed: false, used: last.used, limit: last.limit, plan: last.plan, counted };
    if (last.counted) counted.push(page);
  }
  return { allowed: true, used: last?.used ?? null, limit: last?.limit ?? null, plan: last?.plan ?? null, counted };
}

module.exports = { FREE_PLAN_ID, todayUtc, nextResetUtc, activePlanOf, getPlanUsage, recordPageListens };
