import { useEffect, useRef, useState } from "react";
import { LogOut, User } from "lucide-react";
import { getMsalInstance } from "@/auth/AuthProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { USE_MOCK } from "@/api/config";
import { resetMockStore } from "@/api/tasks";
import { cn } from "@/lib/cn";

/**
 * Header user menu. Renders a circular initials avatar that opens a small
 * dropdown with the user's name, email, and a Sign out button.
 *
 * In demo mode the dropdown still shows but the Sign out button reads
 * "Sign out (demo)" and just refreshes the page, since there's no real
 * session to end.
 */
export function UserMenu() {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside of it.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleSignOut() {
    setOpen(false);
    if (USE_MOCK) {
      // Reset the demo: clear sign-in bypass and the persisted mock store
      // so the user gets a fresh demo (sign-in page first, original tasks).
      try {
        window.sessionStorage.removeItem("aets:demo-signin-bypassed");
      } catch {
        // sessionStorage might be unavailable; the reload still happens.
      }
      resetMockStore();
      window.location.reload();
      return;
    }
    const msal = getMsalInstance();
    if (!msal) return;
    // logoutPopup ends the SSO session for this app. The user can sign back
    // in afterward with a different account if they want.
    msal.logoutPopup({
      postLogoutRedirectUri: window.location.origin + window.location.pathname,
    });
  }

  const initials = computeInitials(user.displayName);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors sm:h-9 sm:w-9",
          open
            ? "border-accent bg-accent text-black"
            : "border-border bg-surface-2 text-fg hover:border-fg-muted",
        )}
        aria-label="Account menu"
        title={user.displayName}
      >
        {initials || <User className="h-4 w-4" />}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-border bg-surface p-2 shadow-lg">
          <div className="border-b border-border px-2 py-2">
            <div className="truncate text-sm font-medium text-fg">{user.displayName}</div>
            {user.email && (
              <div className="truncate text-[11px] text-fg-muted">{user.email}</div>
            )}
            {USE_MOCK && (
              <div className="mt-1 inline-block rounded bg-ajax-yellow/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ajax-yellow">
                Demo mode
              </div>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-surface-2"
          >
            <LogOut className="h-4 w-4" />
            {USE_MOCK ? "Reset demo" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function computeInitials(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
