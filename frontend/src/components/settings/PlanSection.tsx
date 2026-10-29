import { Check, Headphones } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatResetTime, usePlan } from "@/hooks/usePlan";
import type { PlanSummary } from "@/types/segments";

const formatPrice = ({ priceCents, currency }: PlanSummary) =>
  priceCents === 0
    ? "Free"
    : `${new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 0 }).format(priceCents / 100)} / month`;

/**
 * The listener's plan and today's listening (audio pipeline story 8). Read only: plans are
 * assigned by hand until payments (story 12) add upgrade and cancel.
 */
export const PlanSection = () => {
  const { data: plan, isLoading, isError } = usePlan();

  return (
    <section>
      <div className="mb-6 flex items-center gap-2">
        <Headphones className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold text-foreground">Plan and listening</h2>
      </div>

      <Card className="space-y-6 p-6 shadow-none">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-2 w-full" />
          </div>
        ) : isError || !plan ? (
          <p className="text-sm text-muted-foreground">Your plan could not be loaded. Try again in a moment.</p>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{plan.name}</span> plan · {plan.limit} pages of listening a day
                </p>
                <p className={`text-sm tabular-nums ${plan.remainingToday === 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  <span dir="ltr">
                    {plan.usedToday} / {plan.limit}
                  </span>{" "}
                  used today
                </p>
              </div>
              <Progress
                value={plan.limit > 0 ? Math.min((plan.usedToday / plan.limit) * 100, 100) : 100}
                className="h-2"
                aria-label={`${plan.usedToday} of ${plan.limit} pages used today`}
              />
              <p className="text-sm text-muted-foreground">
                A page counts once a day, the first time its audio plays. Listening to it again, reading, the
                text view and chat never count. Today's count starts over at{" "}
                <span dir="ltr">{formatResetTime(plan.resetsAt)}</span>.
              </p>
            </div>

            <div className="divide-y divide-border rounded-md border border-border">
              {plan.plans.map((option) => {
                const current = option.id === plan.plan;
                return (
                  <div key={option.id} className={`flex items-center justify-between gap-4 px-4 py-3 ${current ? "bg-muted/50" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{option.name}</span>
                      {current && (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Current plan
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-sm tabular-nums text-muted-foreground">
                      <span>{option.dailyPageLimit} pages a day</span>
                      <span className="w-24 text-end">{formatPrice(option)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </section>
  );
};
