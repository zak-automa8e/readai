const planService = require('../services/plans/planService');
const supabaseService = require('../services/supabaseService');
const logger = require('../utils/logger');

const planController = {
  /**
   * GET /api/plan → { plan, name, limit, usedToday, remainingToday, resetsAt, plans }
   * Read only: nothing is counted here. `resetsAt` is the next UTC midnight (the day of
   * record_page_listen); `plans` lists the plans on offer.
   */
  async getPlan(req, res) {
    try {
      const now = new Date();
      const [usage, plans] = await Promise.all([
        planService.getPlanUsage(req.user.id, { now }),
        supabaseService.listPlans(),
      ]);
      const { plan, name, limit, usedToday, remainingToday } = usage;
      return res.json({
        plan,
        name,
        limit,
        usedToday,
        remainingToday,
        resetsAt: planService.nextResetUtc(now).toISOString(),
        plans: plans.map((row) => ({
          id: row.id,
          name: row.name,
          dailyPageLimit: row.daily_page_limit,
          priceCents: row.price_cents,
          currency: row.currency,
        })),
      });
    } catch (error) {
      logger.error('Error in getPlan:', error);
      return res.status(500).json({ error: 'PLAN_FAILED', message: 'Failed to read your plan.' });
    }
  },
};

module.exports = planController;
