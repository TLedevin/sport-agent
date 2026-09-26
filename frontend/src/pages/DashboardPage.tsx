import { useEffect, useState } from "react";
import { api, ApiError, type Dashboard } from "../api";
import PeriodTile from "../components/PeriodTile";
import Records from "../components/Records";
import SportBreakdown from "../components/SportBreakdown";
import WeeklyChart from "../components/WeeklyChart";
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
          <div className="tiles">
            <PeriodTile label="Last 7 days" compareLabel="vs previous 7 days" {...data.periods.week} />
            <PeriodTile label="This month" compareLabel="vs same point last month" {...data.periods.month} />
            <PeriodTile label="This year" compareLabel="vs same point last year" {...data.periods.year} />
          </div>
          <div className="dash-row">
            <WeeklyChart weeks={data.weekly} />
            <SportBreakdown breakdown={data.breakdown} year={year} />
          </div>
          <Records records={data.records} />
        </>
      )}
    </div>
  );
}
