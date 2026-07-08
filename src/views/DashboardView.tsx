import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock, Eye, PenSquare, Sparkles, UserCheck } from "lucide-react";
import { useTasks } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { Eir, Person, Task } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// User Dashboard — the landing page after sign-in. Personalised count cards
// summarising the work the signed-in user is involved in, across BOTH tasks
// and EIRs: what they're Assigned to, Watching, Created/reported, and how much
// has been updated this week. Each card shows the total plus a task/EIR split;
// where a matching List filter exists the card links straight to it.
//
// Completed tasks / closed EIRs are excluded by default; the "Show completed"
// toggle includes them. All counts derive from the tasks + EIRs already in the
// React Query cache, so the dashboard stays in sync with the rest of the app.
// =============================================================================

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function matches(list: Person[], email: string): boolean {
  if (!email) return false;
  return list.some((p) => (p.email ?? "").toLowerCase() === email);
}

export function DashboardView() {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: eirs = [], isLoading: eirsLoading } = useEirs();
  const currentUser = useCurrentUser();
  const [showCompleted, setShowCompleted] = useState(false);

  const myEmail = (currentUser.email ?? "").toLowerCase();

  const counts = useMemo(() => {
    const openTask = (t: Task) => showCompleted || t.status !== "Complete";
    const openEir = (e: Eir) => showCompleted || e.status !== "Closed";
    const myTasks = tasks.filter(openTask);
    const myEirs = eirs.filter(openEir);

    const assignedTasks = myTasks.filter((t) => matches(t.assigned, myEmail));
    const assignedEirs = myEirs.filter((e) => matches(e.assignedEngineers, myEmail));
    const watchingTasks = myTasks.filter((t) => matches(t.watchers, myEmail));
    const watchingEirs = myEirs.filter((e) => matches(e.watchers, myEmail));
    const createdTasks = myTasks.filter(
      (t) => (t.author?.email ?? "").toLowerCase() === myEmail,
    );
    const createdEirs = myEirs.filter(
      (e) =>
        (e.author?.email ?? "").toLowerCase() === myEmail ||
        (e.reporter?.email ?? "").toLowerCase() === myEmail,
    );

    // "Updated this week" = anything I'm involved in, modified in the last 7
    // days, deduped so a task I both own and watch only counts once.
    const involvedKeys = new Set<string>();
    let recentTasks = 0;
    let recentEirs = 0;
    const cutoff = Date.now() - WEEK_MS;
    for (const t of [...assignedTasks, ...watchingTasks, ...createdTasks]) {
      const key = `task-${t.id}`;
      if (involvedKeys.has(key)) continue;
      involvedKeys.add(key);
      if (t.modifiedAt.getTime() >= cutoff) recentTasks++;
    }
    const seenEir = new Set<string>();
    for (const e of [...assignedEirs, ...watchingEirs, ...createdEirs]) {
      const key = `eir-${e.id}`;
      if (seenEir.has(key)) continue;
      seenEir.add(key);
      if (e.modifiedAt.getTime() >= cutoff) recentEirs++;
    }

    return {
      assigned: { tasks: assignedTasks.length, eirs: assignedEirs.length },
      watching: { tasks: watchingTasks.length, eirs: watchingEirs.length },
      created: { tasks: createdTasks.length, eirs: createdEirs.length },
      recent: { tasks: recentTasks, eirs: recentEirs },
    };
  }, [tasks, eirs, myEmail, showCompleted]);

  if (isLoading || eirsLoading) return <LoadingTasks noun="your dashboard" />;

  const listUrl = (param: "assigned" | "createdBy") =>
    currentUser.email ? `/list?${param}=${encodeURIComponent(currentUser.email)}` : "/list";

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
            <Sparkles className="h-5 w-5 text-accent" />
            My Dashboard
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {greet(currentUser.displayName)} — here's what you're involved in.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 self-start rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Show completed
        </label>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CountCard
          label="Assigned to me"
          count={counts.assigned}
          icon={<UserCheck className="h-5 w-5" />}
          onClick={() => navigate(listUrl("assigned"))}
          actionText="View my tasks"
        />
        <CountCard
          label="Watching"
          count={counts.watching}
          icon={<Eye className="h-5 w-5" />}
        />
        <CountCard
          label="Created / reported"
          count={counts.created}
          icon={<PenSquare className="h-5 w-5" />}
          onClick={() => navigate(listUrl("createdBy"))}
          actionText="View my tasks"
        />
        <CountCard
          label="Updated this week"
          count={counts.recent}
          icon={<Clock className="h-5 w-5" />}
        />
      </div>
    </div>
  );
}

interface Split {
  tasks: number;
  eirs: number;
}

function CountCard({
  label,
  count,
  icon,
  onClick,
  actionText,
}: {
  label: string;
  count: Split;
  icon: React.ReactNode;
  onClick?: () => void;
  actionText?: string;
}) {
  const total = count.tasks + count.eirs;
  const subtitle = `${count.tasks} task${count.tasks === 1 ? "" : "s"} · ${
    count.eirs
  } EIR${count.eirs === 1 ? "" : "s"}`;

  const body = (
    <>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
          {icon}
        </span>
        {label}
      </div>
      <div className="font-display text-4xl font-bold tabular-nums text-fg">{total}</div>
      <div className="text-xs text-fg-muted">{subtitle}</div>
      {onClick && actionText && (
        <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent opacity-80 transition-opacity group-hover:opacity-100">
          {actionText}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </div>
      )}
    </>
  );

  const base =
    "flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-4 text-left sm:p-5";

  if (!onClick) {
    return <div className={base}>{body}</div>;
  }
  return (
    <button
      onClick={onClick}
      className={cn(
        base,
        "group transition-all hover:border-fg-muted hover:shadow-md",
      )}
    >
      {body}
    </button>
  );
}

function greet(name: string): string {
  if (!name) return "Welcome back";
  const first = name.split(" ")[0];
  const hr = new Date().getHours();
  const slot = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  return `${slot}, ${first}`;
}
