import { Backpack, Images, LayoutDashboard, List, LogOut, MapIcon, RefreshCw, TrendingUp, X } from "lucide-react";
import { useEffect, useRef } from "react";
import Logo from "./Logo";
import { NavLink, Outlet, useLocation } from "react-router";
import { timeAgo } from "../format";
import { useSync } from "../sync";

export default function Layout({ onLogout }: { onLogout: () => void }) {
  const { status, syncing, sync, notice, setNotice } = useSync();
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // On a phone the tabs scroll sideways: keep the current one in view.
  useEffect(() => {
    nav.current?.querySelector(".nav-link.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <div className="shell">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <Logo />
            Sport Agent
          </div>
          <nav className="nav" aria-label="Main" ref={nav}>
            <NavLink to="/" end className="nav-link">
              <LayoutDashboard size={16} aria-hidden /> Dashboard
            </NavLink>
            <NavLink to="/activities" className="nav-link">
              <List size={16} aria-hidden /> Activities
            </NavLink>
            <NavLink to="/map" className="nav-link">
              <MapIcon size={16} aria-hidden /> Map
            </NavLink>
            <NavLink to="/fitness" className="nav-link">
              <TrendingUp size={16} aria-hidden /> Fitness
            </NavLink>
            <NavLink to="/photos" className="nav-link">
              <Images size={16} aria-hidden /> Photos
            </NavLink>
            <NavLink to="/equipment" className="nav-link">
              <Backpack size={16} aria-hidden /> Equipment
            </NavLink>
          </nav>
          <div className="header-actions">
            <span className="sync-status">
              {syncing ? "Syncing with Garmin…" : `Synced ${timeAgo(status?.last_sync_at ?? null)}`}
            </span>
            <button className="button primary" onClick={sync} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? "spin" : undefined} aria-hidden />
              Refresh
            </button>
            <button className="button icon-only" onClick={onLogout} aria-label="Log out" title="Log out">
              <LogOut size={16} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        {notice && (
          <div className={`notice ${notice.kind}`} role="status">
            <div>{notice.content}</div>
            <button className="button icon-only small" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
