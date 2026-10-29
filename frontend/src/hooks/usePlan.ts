import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listeningService } from "@/services/listeningService";
import type { PlanQuota, PlanUsage } from "@/types/segments";

export const PLAN_QUERY_KEY = ["plan"] as const;

/** The listener's plan and today's page count (spec story 8). Shared by the room's counter and Settings. */
export const usePlan = (enabled = true) =>
  useQuery({
    queryKey: PLAN_QUERY_KEY,
    queryFn: listeningService.getPlan,
    enabled,
    staleTime: 60_000,
  });

/**
 * Moves the cached count when the server reports a new one (a delivered clip, a planned window,
 * a 402), so the counter follows the listening without asking /plan again.
 */
export const useUpdatePlanUsage = () => {
  const queryClient = useQueryClient();
  return useCallback((quota: Partial<PlanQuota> & { used?: number }) => {
    const usedToday = quota.usedToday ?? quota.used;
    if (typeof usedToday !== "number") return;
    const current = queryClient.getQueryData<PlanUsage>(PLAN_QUERY_KEY);
    // Not loaded yet, or the plan changed (assigned by hand): the name and list come from /plan
    if (!current || (quota.plan && quota.plan !== current.plan)) {
      void queryClient.invalidateQueries({ queryKey: PLAN_QUERY_KEY });
      return;
    }
    const limit = quota.limit ?? current.limit;
    queryClient.setQueryData<PlanUsage>(PLAN_QUERY_KEY, {
      ...current,
      limit,
      usedToday,
      remainingToday: Math.max(limit - usedToday, 0),
    });
  }, [queryClient]);
};

/** "03:00", the local time today's count starts over. */
export const formatResetTime = (resetsAt: string) =>
  new Date(resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
