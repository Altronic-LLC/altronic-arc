import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Debounced search box shared by every list view. The input itself updates
 * on every keystroke (local state — always instant), but `onChange` fires
 * only after a short pause in typing. That decoupling is what fixed the
 * search-freezes-the-app bug: the previous inline inputs pushed every
 * keystroke straight into URL search params, re-rendering the entire route
 * tree AND re-running the full list filter per character.
 */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number>();
  // Tracks the last value we emitted, so the sync effect below can tell an
  // external change (URL navigation, "clear filters") apart from the echo of
  // our own onChange landing back in props.
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setLocal(value);
    }
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function handleChange(next: string) {
    setLocal(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      lastEmitted.current = next;
      onChange(next);
    }, 250);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
      <input
        type="search"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className={
          className ??
          "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
        }
        // Room for the magnifier icon regardless of which class supplied
        // the rest of the styling (FilterBar passes the shared "select").
        style={{ paddingLeft: "2.25rem" }}
      />
    </div>
  );
}
