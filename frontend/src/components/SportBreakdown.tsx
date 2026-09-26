import type { FamilyTotals } from "../api";
import { hours } from "../format";
import { SPORTS, SportBadge, sportColor } from "../sports";

export default function SportBreakdown({ breakdown, year }: { breakdown: FamilyTotals[]; year: number }) {
  const total = breakdown.reduce((sum, b) => sum + b.duration, 0);

  return (
    <section className="card" aria-labelledby="breakdown-title">
      <div className="card-head">
        <div>
          <h2 id="breakdown-title">{year} by sport</h2>
          <p className="card-sub">Share of training time</p>
        </div>
      </div>
      {breakdown.length === 0 ? (
        <p className="empty-text">No activities this year yet.</p>
      ) : (
        <ul className="breakdown">
          {breakdown.map((b) => {
            const share = total > 0 ? b.duration / total : 0;
            return (
              <li key={b.family}>
                <SportBadge family={b.family} size={30} />
                <div className="breakdown-body">
                  <div className="breakdown-line">
                    <span className="breakdown-name">{SPORTS[b.family].label}</span>
                    <span className="breakdown-value">
                      {hours(b.duration)} <span className="muted">· {Math.round(share * 100)}%</span>
                    </span>
                  </div>
                  <div className="bar-track" aria-hidden>
                    <div className="bar-fill" style={{ width: `${share * 100}%`, background: sportColor(b.family) }} />
                  </div>
                  <div className="breakdown-meta">
                    {b.count} {b.count === 1 ? "activity" : "activities"}
                    {b.distance > 0 && ` · ${(b.distance / 1000).toLocaleString("en", { maximumFractionDigits: 0 })} km`}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
