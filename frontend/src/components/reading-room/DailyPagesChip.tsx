import { Headphones } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { formatResetTime, usePlan } from "@/hooks/usePlan";

/**
 * "3 / 10 pages today": the pages listened to today against the plan's daily limit. A page counts
 * once a day when its audio first plays; Read mode and replays never count. Turns red at the limit.
 */
export const DailyPagesChip = ({ limitReached = false }: { limitReached?: boolean }) => {
  const { data: plan } = usePlan();
  if (!plan) return null;

  const atLimit = limitReached || plan.remainingToday === 0;
  const resets = formatResetTime(plan.resetsAt);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          tabIndex={0}
          className={
            "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
            (atLimit ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground")
          }
          aria-label={
            atLimit
              ? `Daily limit reached: ${plan.usedToday} of ${plan.limit} pages today. Starts over at ${resets}.`
              : `${plan.usedToday} of ${plan.limit} pages listened to today`
          }
        >
          <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
          {atLimit && <span>Daily limit reached ·</span>}
          <span dir="ltr">
            {plan.usedToday} / {plan.limit}
          </span>
          {!atLimit && <span>pages today</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {plan.name} plan: {plan.limit} pages of listening a day. A page counts once a day, the first time its audio
        plays. Reading never counts. Starts over at <span dir="ltr">{resets}</span>.
      </TooltipContent>
    </Tooltip>
  );
};
