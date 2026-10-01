import { Pencil, Trash2, Trophy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, ApiError, type ActivityPageData, type Gender, type RaceResult } from "../api";
import { clock, paceOrSpeed } from "../format";

/** French athletics (FFA) categories, the usual ones on race results; any other text works too. */
const CATEGORIES: [string, string][] = [
  ["MI", "Minime, 14–15"],
  ["CA", "Cadet, 16–17"],
  ["JU", "Junior, 18–19"],
  ["ES", "Espoir, 20–22"],
  ["SE", "Senior, 23–34"],
  ["M0", "Master, 35–39"],
  ["M1", "Master, 40–44"],
  ["M2", "Master, 45–49"],
  ["M3", "Master, 50–54"],
  ["M4", "Master, 55–59"],
  ["M5", "Master, 60–64"],
  ["M6", "Master, 65–69"],
  ["M7", "Master, 70–74"],
  ["M8", "Master, 75–79"],
  ["M9", "Master, 80–84"],
  ["M10", "Master, 85+"],
];

const GENDER_LABEL: Record<Gender, string> = { men: "Men", women: "Women" };

/** "3:17:25", "45:12", "3h17'25" or "3 17 25" -> seconds; null when it isn't a time. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(/[^0-9]+/).filter(Boolean).map(Number);
  if (parts.length < 2 || parts.length > 3) return null;
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  if (m >= 60 || s >= 60) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

function rankText(rank: number | null, total: number | null): string {
  return total ? `${rank} / ${total.toLocaleString("en")}` : String(rank);
}

/** "Top 6%": the share of finishers ahead of or level with you. */
function topShare(rank: number | null, total: number | null): string | null {
  if (!rank || !total) return null;
  const share = (rank / total) * 100;
  return `Top ${share < 10 ? share.toFixed(1).replace(/\.0$/, "") : Math.round(share)}%`;
}

type Props = {
  activity: ActivityPageData;
  result: RaceResult | null;
  editing: boolean;
  onEdit: () => void;
  onDone: (result: RaceResult | null) => void;
  onCancel: () => void;
};

/** A race's official result: shown, or typed in. */
export default function RaceResultSection({ activity, result, editing, onEdit, onDone, onCancel }: Props) {
  return (
    <section className="card race-card" aria-labelledby="race-title">
      <div className="card-head">
        <div>
          <h2 id="race-title">
            <Trophy size={16} className="title-icon" aria-hidden /> Race result
          </h2>
          {!result && !editing && <p className="card-sub">Garmin marks this activity as a race.</p>}
        </div>
        {result && !editing && (
          <button type="button" className="button small" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Edit
          </button>
        )}
      </div>
      {editing ? (
        <RaceForm activity={activity} result={result} onDone={onDone} onCancel={onCancel} />
      ) : result ? (
        <ResultView activity={activity} result={result} />
      ) : (
        <div className="race-empty">
          <p className="muted">Add your official time and your rankings: overall, by sex and by category.</p>
          <button type="button" className="button primary" onClick={onEdit}>
            <Trophy size={15} aria-hidden /> Add my result
          </button>
        </div>
      )}
    </section>
  );
}

function ResultView({ activity, result: r }: { activity: ActivityPageData; result: RaceResult }) {
  const watchTime = activity.duration;
  const rankings = [
    { label: "Overall", rank: r.overall_rank, total: r.overall_total },
    { label: r.gender ? GENDER_LABEL[r.gender] : "By sex", rank: r.gender_rank, total: r.gender_total },
    { label: r.category ? `Category ${r.category}` : "Category", rank: r.category_rank, total: r.category_total },
  ].filter((x) => x.rank);
  return (
    <div className="race-result">
      {r.official_time && (
        <div className="race-time">
          <span className="race-label">Official time</span>
          <strong>{clock(r.official_time)}</strong>
          <span className="muted">
            {activity.distance > 0 && `${paceOrSpeed(activity.sport_type, activity.distance / r.official_time)} · `}
            Watch {clock(watchTime)}
          </span>
        </div>
      )}
      {rankings.length > 0 && (
        <dl className="race-ranks">
          {rankings.map((x) => (
            <div key={x.label}>
              <dt>{x.label}</dt>
              <dd>{rankText(x.rank, x.total)}</dd>
              {topShare(x.rank, x.total) && <span className="race-share">{topShare(x.rank, x.total)}</span>}
            </div>
          ))}
        </dl>
      )}
      {!r.official_time && rankings.length === 0 && <p className="muted">No details yet.</p>}
    </div>
  );
}

const num = (text: string): number | null => (text.trim() ? Number(text) : null);
const str = (value: number | null | undefined) => (value == null ? "" : String(value));

function RaceForm({ activity, result, onDone, onCancel }: {
  activity: ActivityPageData; result: RaceResult | null; onDone: (r: RaceResult | null) => void; onCancel: () => void;
}) {
  const defaults = activity.race_defaults;
  const [time, setTime] = useState(result?.official_time ? clock(result.official_time) : "");
  const [overall, setOverall] = useState({ rank: str(result?.overall_rank), total: str(result?.overall_total) });
  const [gender, setGender] = useState<Gender | null>(result ? result.gender : defaults.gender);
  const [byGender, setByGender] = useState({ rank: str(result?.gender_rank), total: str(result?.gender_total) });
  const [category, setCategory] = useState((result ? result.category : defaults.category) ?? "");
  const [byCategory, setByCategory] = useState({ rank: str(result?.category_rank), total: str(result?.category_total) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const seconds = time.trim() ? parseTime(time) : null;
    if (time.trim() && seconds === null) {
      setError("Type the time as h:mm:ss (e.g. 3:17:25) or mm:ss (e.g. 45:12).");
      return;
    }
    // Sex and category only count when there's a ranking for them, or to prefill the next race.
    const body: RaceResult = {
      official_time: seconds,
      overall_rank: num(overall.rank),
      overall_total: num(overall.total),
      gender,
      gender_rank: num(byGender.rank),
      gender_total: num(byGender.total),
      category: category.trim() || null,
      category_rank: num(byCategory.rank),
      category_total: num(byCategory.total),
    };
    setBusy(true);
    setError(null);
    try {
      onDone(await api.saveRaceResult(activity.id, body));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 422 && err.detail !== "Unprocessable Entity"
        ? err.detail : "Couldn't save the result. Check the numbers and try again.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this race result?")) return;
    setBusy(true);
    try {
      await api.deleteRaceResult(activity.id);
      onDone(null);
    } catch {
      setError("Couldn't delete the result. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className="race-form" onSubmit={save}>
      <label className="race-field race-field-time">
        <span>Official time</span>
        <input type="text" inputMode="numeric" placeholder={`e.g. ${clock(activity.duration)}`} value={time}
          onChange={(e) => setTime(e.target.value)} autoFocus />
        <small className="muted">
          Watch: {clock(activity.duration)}{" "}
          <button type="button" className="link-button" onClick={() => setTime(clock(activity.duration))}>
            use it
          </button>
        </small>
      </label>

      <fieldset className="race-rank-row">
        <legend>Overall</legend>
        <RankInputs value={overall} onChange={setOverall} label="overall" />
      </fieldset>

      <fieldset className="race-rank-row">
        <legend>By sex</legend>
        <div className="segmented" role="group" aria-label="Sex">
          {(["men", "women"] as Gender[]).map((g) => (
            <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(gender === g ? null : g)}>
              {GENDER_LABEL[g]}
            </button>
          ))}
        </div>
        <RankInputs value={byGender} onChange={setByGender} label="by sex" />
      </fieldset>

      <fieldset className="race-rank-row">
        <legend>By category</legend>
        <input className="race-category" type="text" list="race-categories" placeholder="e.g. M1" maxLength={32}
          aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
        <datalist id="race-categories">
          {CATEGORIES.map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </datalist>
        <RankInputs value={byCategory} onChange={setByCategory} label="in category" />
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="photo-dialog-actions">
        {result && (
          <button type="button" className="button ghost danger" onClick={remove} disabled={busy}>
            <Trash2 size={14} aria-hidden /> Delete result
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : "Save result"}</button>
      </div>
    </form>
  );
}

function RankInputs({ value, onChange, label }: {
  value: { rank: string; total: string }; onChange: (v: { rank: string; total: string }) => void; label: string;
}) {
  return (
    <span className="race-rank-inputs">
      <input type="number" inputMode="numeric" min={1} step={1} placeholder="Rank" aria-label={`Rank ${label}`}
        value={value.rank} onChange={(e) => onChange({ ...value, rank: e.target.value })} />
      <span aria-hidden>/</span>
      <input type="number" inputMode="numeric" min={1} step={1} placeholder="Finishers" aria-label={`Finishers ${label}`}
        value={value.total} onChange={(e) => onChange({ ...value, total: e.target.value })} />
    </span>
  );
}
