import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Trash2, UserPlus } from "lucide-react";
import {
  useAddPsrNotificationPerson,
  usePsrNotificationList,
  useRemovePsrNotificationPerson,
} from "@/hooks/usePottingSampleLog";
import { LoadingTasks } from "@/components/LoadingTasks";

/**
 * Coil PSR Notification List. Lists everyone emailed when a potting sample
 * is outside the spec limits, and lets anyone signed in add/remove people.
 * No admin gate — same as Teradyne's reference lists.
 */
export function PsrNotificationView() {
  const navigate = useNavigate();
  const { data: people = [], isLoading } = usePsrNotificationList();
  const add = useAddPsrNotificationPerson();
  const remove = useRemovePsrNotificationPerson();

  const [showNew, setShowNew] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim() || !email.trim()) return;
    await add.mutateAsync({ displayName: displayName.trim(), email: email.trim() });
    setDisplayName("");
    setEmail("");
    setShowNew(false);
  }

  return (
    <div className="mx-auto flex max-w-[800px] flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Mail className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Coil PSR Notification List
          </h1>
          <p className="text-xs text-fg-muted">
            Everyone on this list is emailed when a saved potting sample is outside the spec limits.
          </p>
        </div>
      </header>

      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" /> Add person
        </button>
      </div>

      {showNew && (
        <form
          onSubmit={handleAdd}
          className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            Name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={add.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {add.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <LoadingTasks noun="the notification list" />
      ) : people.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          Nobody is on the notification list yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="w-12 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} className="border-t border-border">
                  <td className="px-4 py-2 text-fg">{person.displayName}</td>
                  <td className="px-4 py-2 text-fg-muted">{person.email}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => remove.mutate(person.id)}
                      aria-label={`Remove ${person.displayName}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
