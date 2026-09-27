import { LayoutDashboard, List, LogOut, RefreshCw, X } from "lucide-react";
import Logo from "./Logo";
import { NavLink, Outlet } from "react-router";
import { timeAgo } from "../format";
import { useSync } from "../sync";

export default function Layout({ onLogout }: { onLogout: () => void }) {
  const { status, syncing, sync, notice, setNotice } = useSync();

  return (
    <div className="shell">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <Logo />
            Sport Agent
          </div>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end className="nav-link">
              <LayoutDashboard size={16} aria-hidden /> Dashboard
            </NavLink>
            <NavLink to="/activities" className="nav-link">
              <List size={16} aria-hidden /> Activities
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
