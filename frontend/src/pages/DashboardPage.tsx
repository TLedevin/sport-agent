import { Images } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, type Dashboard, type Family } from "../api";
import ActivityCard from "../components/ActivityCard";
import EvolutionChart from "../components/EvolutionChart";
import PeriodTile from "../components/PeriodTile";
import PhotoGallery from "../components/PhotoGallery";
import Records from "../components/Records";
import SportBreakdown from "../components/SportBreakdown";
import SportFilter from "../components/SportFilter";
import { errorNotice, useSync } from "../sync";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { version, syncing, setNotice } = useSync();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [sport, setSport] = useState<Family | null>(null);

  // Refetch after each sync that imported something. The previous render stays on
  // screen (dimmed) while reloading: no skeleton flash, no layout jump.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const slowTimer = setTimeout(() => setSlow(true), 3000);
    api
      .dashboard()
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      })
      .finally(() => {
        clearTimeout(slowTimer);
        if (!cancelled) {
          setLoading(false);
          setSlow(false);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [version, setNotice]);

  if (!data) {
    return (
      <div className="page-loading" role="status">
        <div className="loader" aria-hidden />
        <p>{slow ? "Waking up the database… this can take up to a minute." : "Loading your training…"}</p>
      </div>
    );
  }

  const empty = data.periods.year.current.count === 0 && data.records.length === 0;
  const year = Number(data.today.slice(0, 4));
  const families = Object.keys(data.periods_by_family) as Family[];
  // A sport can drop out of the list (new year): fall back to all sports.
  const periods = (sport && data.periods_by_family[sport]) || data.periods;

  return (
    <div className={`page ${loading ? "refetching" : ""}`}>
      <div className="page-head">
        <h1>{greeting()}</h1>
        <p className="page-sub">
          {new Date(`${data.today}T00:00:00`).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </div>

      {empty ? (
        <section className="card empty-state">
          <h2>{syncing ? "Importing your Garmin history…" : "No activities yet"}</h2>
          <p>
            {syncing
              ? "This can take a minute the first time. The dashboard fills in as soon as it's done."
              : "Click Refresh to import your activities from Garmin Connect."}
          </p>
        </section>
      ) : (
        <>
          {families.length > 1 && (
            <SportFilter families={families} selected={periods === data.periods ? null : sport} onSelect={setSport} />
          )}
          <div className="tiles">
            <PeriodTile label="Last 7 days" compareLabel="vs previous 7 days" {...periods.week} />
            <PeriodTile label="This month" compareLabel="vs same point last month" {...periods.month} />
            <PeriodTile label="This year" compareLabel="vs same point last year" {...periods.year} />
          </div>
          {data.last_activity && <ActivityCard activity={data.last_activity} title="Last activity" />}
          {data.recent_photos.length > 0 && (
            <section className="card" aria-labelledby="recent-photos-title">
              <div className="card-head">
                <h2 id="recent-photos-title">
                  <Images size={16} className="title-icon" aria-hidden /> Recent photos
                </h2>
                <Link to="/photos" className="button ghost small">See all</Link>
              </div>
              <PhotoGallery strip label="Recent photos"
                items={data.recent_photos.map((p) => ({ photo: p, caption: p.activity_name, href: `/activities/${p.activity_id}` }))} />
            </section>
          )}
          <div className="dash-row">
            <EvolutionChart evolution={data.evolution} />
            <SportBreakdown breakdown={data.breakdown} year={year} />
          </div>
          <Records records={data.records} />
        </>
      )}
    </div>
  );
}
