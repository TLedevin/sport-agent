import { Trophy } from "lucide-react";
import type { PersonalRecord } from "../api";
import { clock, hours, km, meters, shortDate } from "../format";
import { SportBadge } from "../sports";

function formatRecord(record: PersonalRecord): string {
  switch (record.key) {
    case "fastest_run":
      return `${clock(1000 / record.value)} /km`;
    case "biggest_climb":
      return meters(record.value);
    case "longest_session":
      return hours(record.value);
    default:
      return km(record.value);
  }
}

export default function Records({ records }: { records: PersonalRecord[] }) {
  return (
    <section className="card" aria-labelledby="records-title">
      <div className="card-head">
        <div>
          <h2 id="records-title">
            <Trophy size={16} className="title-icon" aria-hidden /> Personal records
          </h2>
          <p className="card-sub">Best efforts across your whole history</p>
        </div>
      </div>
      {records.length === 0 ? (
        <p className="empty-text">Records appear once you have activities.</p>
      ) : (
        <ul className="records">
          {records.map((r) => (
            <li key={r.key} className="record">
              <SportBadge family={r.family} size={34} />
              <div className="record-body">
                <div className="record-label">{r.label}</div>
                <div className="record-value">{formatRecord(r)}</div>
                <div className="record-meta" title={r.activity_name}>
                  {r.activity_name || "Untitled"} · {shortDate(r.date)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
