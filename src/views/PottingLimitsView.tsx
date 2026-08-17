import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Gauge } from "lucide-react";
import { usePottingLimits, useUpdatePottingLimits } from "@/hooks/usePottingSampleLog";
import { LoadingTasks } from "@/components/LoadingTasks";

/**
 * Coil Potting Spec Limits. Edits the two rows on the Coil-PottingLimit
 * SharePoint list (Lower / Upper Spec Limit). No admin gate — any
 * signed-in user maintains this, same as Teradyne's reference lists.
 */
export function PottingLimitsView() {
  const navigate = useNavigate();
  const { data: limits, isLoading } = usePottingLimits();
  const update = useUpdatePottingLimits();

  const [lowerLimit, setLowerLimit] = useState("");
  const [upperLimit, setUpperLimit] = useState("");
  const [savedJustNow, setSavedJustNow] = useState(false);

  useEffect(() => {
    if (limits) {
      setLowerLimit(String(limits.lowerLimit));
      setUpperLimit(String(limits.upperLimit));
    }
  }, [limits]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await update.mutateAsync({
      lowerLimit: Number(lowerLimit) || 0,
      upperLimit: Number(upperLimit) || 0,
    });
    setSavedJustNow(true);
    setTimeout(() => setSavedJustNow(false), 2000);
  }

  return (
    <div className="mx-auto flex max-w-[700px] flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Gauge className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Coil Potting Spec Limits
          </h1>
          <p className="text-xs text-fg-muted">
            A saved sample outside these limits emails the PSR notification list.
          </p>
        </div>
      </header>

      {isLoading ? (
        <LoadingTasks noun="the spec limits" />
      ) : (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            Lower Spec Limit
            <input
              type="number"
              value={lowerLimit}
              onChange={(e) => setLowerLimit(e.target.value)}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            Upper Spec Limit
            <input
              type="number"
              value={upperLimit}
              onChange={(e) => setUpperLimit(e.target.value)}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={update.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {update.isPending ? "Saving…" : "Save limits"}
            </button>
            {savedJustNow && <span className="text-xs text-cooper-green">Saved</span>}
          </div>
        </form>
      )}
    </div>
  );
}
