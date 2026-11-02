import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { listeningService } from "@/services/listeningService";

const PAGES_AHEAD_QUERY_KEY = ["pages-ahead"] as const;
const OPTIONS = [1, 2, 3, 4, 5];
const DEFAULT_PAGES_AHEAD = 2;

/**
 * "Prepare ahead" (listen-ahead spec story 3): how many pages past the listener text and audio are
 * prepared. Saved on change; the next listen request uses it.
 */
export const PagesAheadSetting = () => {
  const queryClient = useQueryClient();
  const { data: pagesAhead, isLoading, isError } = useQuery({
    queryKey: PAGES_AHEAD_QUERY_KEY,
    queryFn: listeningService.getPagesAhead,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: listeningService.setPagesAhead,
    onMutate: async (value: number) => {
      await queryClient.cancelQueries({ queryKey: PAGES_AHEAD_QUERY_KEY });
      const previous = queryClient.getQueryData<number>(PAGES_AHEAD_QUERY_KEY);
      queryClient.setQueryData(PAGES_AHEAD_QUERY_KEY, value);
      return { previous };
    },
    onError: (_error, _value, context) => queryClient.setQueryData(PAGES_AHEAD_QUERY_KEY, context?.previous),
  });

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-md space-y-1">
        <Label htmlFor="pages-ahead">Prepare ahead</Label>
        <p className="text-sm text-muted-foreground">
          Text and audio are ready this many pages past where you are listening. More pages means fewer pauses
          when you skip ahead. Pages only count toward your daily limit when you listen to them.
        </p>
        {save.isError && <p className="text-sm text-destructive">Your choice could not be saved. Try again in a moment.</p>}
      </div>
      {isLoading ? (
        <Skeleton className="h-10 w-36" />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Could not be loaded.</p>
      ) : (
        <Select
          value={String(pagesAhead ?? DEFAULT_PAGES_AHEAD)}
          onValueChange={(value) => save.mutate(Number(value))}
          disabled={save.isPending}
        >
          <SelectTrigger id="pages-ahead" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n === 1 ? "1 page" : `${n} pages`}
                {n === DEFAULT_PAGES_AHEAD ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
};
