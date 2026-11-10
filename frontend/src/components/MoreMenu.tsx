import { FileText, Images, MoreHorizontal, TrendingUp, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router";

/** Pages reached from the "⋯" button rather than a tab of their own. */
const PAGES: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/fitness", label: "Fitness", icon: TrendingUp },
  { to: "/photos", label: "Photos", icon: Images },
  { to: "/certificates", label: "Certificates", icon: FileText },
];

const GAP = 6; // px between the button and the menu
const MARGIN = 8; // px kept from the window's edge

/** The "⋯" tab and its menu. The menu is drawn over the page (not inside the tab row, which
 * scrolls sideways on a phone and would cut it off), right under the button. */
export default function MoreMenu() {
  const { pathname } = useLocation();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const current = PAGES.find((p) => pathname.startsWith(p.to));

  // Choosing a page (or any navigation) closes it.
  useEffect(() => setOpen(false), [pathname]);

  // Under the button, kept inside the window.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const b = button.current!.getBoundingClientRect();
      const width = menu.current?.offsetWidth ?? 200;
      setPosition({
        top: b.bottom + GAP,
        left: Math.max(MARGIN, Math.min(b.right - width, window.innerWidth - width - MARGIN)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // the tab row scrolls too
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // A click anywhere else closes it; so does Escape, back on the button.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  // Opened from the keyboard or not, the first link takes the focus once the menu is placed.
  useEffect(() => {
    if (open && position) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open, position]);

  function arrows(event: KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    items[(at + step + items.length) % items.length]?.focus();
  }

  return (
    <>
      <button ref={button} type="button" className={`nav-link nav-more ${current ? "active" : ""}`}
        aria-haspopup="menu" aria-expanded={open} aria-label={current ? `More pages (${current.label})` : "More pages"}
        title="More" onClick={() => {
          setPosition(null);
          setOpen((o) => !o);
        }}>
        <MoreHorizontal size={18} aria-hidden />
        {current && <span>{current.label}</span>}
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" aria-label="More pages" className="nav-menu" onKeyDown={arrows}
          style={position ? { top: position.top, left: position.left } : { visibility: "hidden" }}>
          {PAGES.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} role="menuitem" className="nav-menu-item">
              <Icon size={16} aria-hidden /> {label}
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
