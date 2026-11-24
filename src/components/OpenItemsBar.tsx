import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Layers, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OpenItem } from "@/lib/openItems";
import {
  closeOpenItem,
  reorderOpenItem,
  shiftOpenItemBy,
  useOpenItems,
} from "@/hooks/useOpenItems";
import { useIsPhone } from "@/hooks/useIsPhone";
import { dropdownBlurHandler, dropdownKeyHandler, useDropdownClose } from "@/components/useDropdownClose";

// =============================================================================
// The strip of records kept open (BusinessIT#74), under the header.
//
// Rendered INSIDE the sticky header, so it stays in reach however far down a
// page somebody has scrolled. Nothing at all when nothing is kept open — a
// row of empty chrome above every page would be worse than no feature.
//
// Desktop and tablet: a row of tabs. Click one to open it, × to remove it,
// drag to reorder (or Ctrl+Shift+← / → on a focused tab). The tab for the page
// you're on is highlighted. A phone has no room for tabs, so it gets one
// "Open (3)" button with the same list in a menu, in the same order.
//
// Removing the tab for the page you're on keeps you on that page — the tab is
// a shortcut, not the page.
// =============================================================================

/** The shortcut for moving a focused tab, said in its tooltip and the manual. */
const MOVE_HINT = "Drag, or Ctrl+Shift+← / → to move";

function tabTitle(item: OpenItem): string {
  return item.category ? `${item.category}: ${item.label}` : item.label;
}

export function OpenItemsBar() {
  const items = useOpenItems();
  const isPhone = useIsPhone();
  if (items.length === 0) return null;
  return (
    <div className="border-t border-border bg-surface-2/60" data-testid="open-items-bar">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        {isPhone ? <OpenItemsMenu items={items} /> : <OpenItemsTabs items={items} />}
      </div>
    </div>
  );
}

function OpenItemsTabs({ items }: { items: OpenItem[] }) {
  const { pathname } = useLocation();
  // A drag ends with a pointerup over the tab that was dragged, and the
  // browser turns that into a click — which would open the tab somebody only
  // meant to move. dnd-kit stops that click's PROPAGATION at the window, so
  // React (and the Link's onClick) never hears of it — but its DEFAULT still
  // runs, and the browser follows the link as a full page load. Found in
  // Chrome, 2026-11-24. So the click is cancelled by our own window-level
  // capture listener, and the flag is cleared by the NEXT press rather than a
  // timer, which the click outlived.
  const justDragged = useRef(false);
  // Moving a tab with the keyboard re-orders the DOM, and some browsers drop
  // focus from a node that moves. Put it back on the moved tab.
  const [refocus, setRefocus] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    function swallowClickAfterDrag(e: MouseEvent) {
      if (!justDragged.current || !stripRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      justDragged.current = false;
    }
    window.addEventListener("click", swallowClickAfterDrag, true);
    return () => window.removeEventListener("click", swallowClickAfterDrag, true);
  }, []);

  useEffect(() => {
    if (!refocus) return;
    const links = stripRef.current?.querySelectorAll<HTMLElement>("[data-open-item]") ?? [];
    for (const link of links) {
      if (link.getAttribute("data-open-item") === refocus) link.focus();
    }
    setRefocus(null);
  }, [refocus, items]);

  function handleDragEnd(e: DragEndEvent) {
    if (e.over && e.active.id !== e.over.id) {
      reorderOpenItem(String(e.active.id), String(e.over.id));
    }
  }

  function handleKeyDown(e: KeyboardEvent, path: string) {
    if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    shiftOpenItemBy(path, e.key === "ArrowLeft" ? -1 : 1);
    setRefocus(path);
  }

  return (
    <nav
      aria-label="Kept open"
      className="flex items-center gap-2 py-1.5"
      onPointerDownCapture={() => {
        justDragged.current = false;
      }}
    >
      <span className="hidden shrink-0 items-center gap-1 font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted lg:inline-flex">
        <Layers className="h-3.5 w-3.5" />
        Open
      </span>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          justDragged.current = true;
        }}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.path)} strategy={horizontalListSortingStrategy}>
          <div ref={stripRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {items.map((item) => (
              <OpenItemTab
                key={item.path}
                item={item}
                active={item.path === pathname}
                onKeyDown={(e) => handleKeyDown(e, item.path)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </nav>
  );
}

function OpenItemTab({
  item,
  active,
  onKeyDown,
}: {
  item: OpenItem;
  active: boolean;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  // Only the pointer listeners are spread — not dnd-kit's `attributes`, which
  // would make the wrapper a focusable role="button" around a link and a
  // button (nested interactive controls). The link is the focus target; the
  // keyboard reorder is its own shortcut.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.path });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
      className={cn(
        "group flex max-w-[16rem] shrink-0 touch-none items-center rounded-md border text-xs transition-colors",
        active
          ? "border-accent bg-surface text-fg shadow-xs"
          : "border-border bg-surface/70 text-fg-muted hover:border-fg-muted hover:text-fg",
        isDragging && "z-10 opacity-80 shadow-md",
      )}
    >
      <Link
        to={item.path}
        data-open-item={item.path}
        title={`${tabTitle(item)}\n${MOVE_HINT}`}
        aria-current={active ? "page" : undefined}
        aria-keyshortcuts="Control+Shift+ArrowLeft Control+Shift+ArrowRight"
        onKeyDown={onKeyDown}
        className={cn(
          "min-w-0 truncate rounded-l-md py-1 pl-2.5 pr-1 focus-visible:outline-2 focus-visible:outline-accent",
          active && "font-semibold",
        )}
      >
        {item.label}
      </Link>
      <button
        type="button"
        onClick={() => closeOpenItem(item.path)}
        aria-label={`Close ${item.label}`}
        title="Close this tab (the record stays as it is)"
        className="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function OpenItemsMenu({ items }: { items: OpenItem[] }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDropdownClose(open, containerRef, close);

  // Following a link closes the menu.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div
      ref={containerRef}
      className="relative py-1.5"
      onKeyDown={dropdownKeyHandler(open, close)}
      onBlur={dropdownBlurHandler(containerRef, close)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-fg"
      >
        <Layers className="h-3.5 w-3.5 text-fg-muted" />
        Open ({items.length})
        <ChevronDown className="h-3.5 w-3.5 text-fg-muted" />
      </button>
      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
          {items.map((item) => (
            <li key={item.path} className="flex items-center gap-1">
              <Link
                to={item.path}
                aria-current={item.path === pathname ? "page" : undefined}
                className={cn(
                  "min-w-0 flex-1 rounded-md px-2 py-2 text-sm",
                  item.path === pathname ? "bg-surface-2 font-semibold text-fg" : "text-fg hover:bg-surface-2",
                )}
              >
                <span className="block truncate">{item.label}</span>
                {item.category && <span className="block truncate text-xs text-fg-muted">{item.category}</span>}
              </Link>
              <button
                type="button"
                onClick={() => closeOpenItem(item.path)}
                aria-label={`Close ${item.label}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
