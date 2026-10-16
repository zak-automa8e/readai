const planService = require('../services/plans/planService');
const logger = require('../utils/logger');

const planController = {
  /**
   * GET /api/plan → { plan, name, limit, usedToday, remainingToday }
   * Read only: nothing is counted here.
   */
  async getPlan(req, res) {
    try {
      const { plan, name, limit, usedToday, remainingToday } = await planService.getPlanUsage(req.user.id);
      return res.json({ plan, name, limit, usedToday, remainingToday });
    } catch (error) {
      logger.error('Error in getPlan:', error);
      return res.status(500).json({ error: 'PLAN_FAILED', message: 'Failed to read your plan.' });
    }
  },
};

module.exports = planController;
