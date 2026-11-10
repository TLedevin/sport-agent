import { FileText, Link2, Pencil, RefreshCw, Trash2, Trophy, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError, photoSrc, type ActivityPageData, type Certificate, type Gender, type RaceResult } from "../api";
import { clock, km, paceOrSpeed } from "../format";

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

/** Usual race distances, in meters, as quick choices. */
const DISTANCES: [string, number][] = [
  ["5 km", 5000],
  ["10 km", 10000],
  ["Half marathon", 21097.5],
  ["Marathon", 42195],
];

/** "10 km", "Half marathon", or "15.5 km". */
export function raceDistanceLabel(meters: number): string {
  return DISTANCES.find(([, m]) => Math.abs(m - meters) < 1)?.[0] ?? km(meters);
}

/** "10", "10.5" or "10,5" (km) -> meters; null when empty or not a number. */
function parseKm(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? Math.round(value * 1000 * 10) / 10 : null;
}

/** Meters -> the text of the km field: "21.0975", "10". */
function kmText(meters: number | null | undefined): string {
  return meters ? String(Number((meters / 1000).toFixed(4))) : "";
}

/** Same distance, give or take a meter (typed values are rounded). */
function sameDistance(a: number | null, b: number): boolean {
  return a !== null && Math.abs(a - b) < 1;
}

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
        <>
          <ResultView activity={activity} result={result} />
          <CertificateRow activityId={activity.id} certificate={result.certificate ?? null}
            onChange={(certificate) => onDone({ ...result, certificate })} />
        </>
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

const MAX_CERTIFICATE = 10 * 1024 * 1024; // bytes, as on the server

/** "PDF · 120 KB", "Image · 2.1 MB". */
export function certificateInfo(c: Certificate): string {
  const kind = c.content_type === "application/pdf" ? "PDF" : "Image";
  const size = c.size < 1024 * 1024 ? `${Math.max(1, Math.round(c.size / 1024))} KB` : `${(c.size / 1024 / 1024).toFixed(1)} MB`;
  return `${kind} · ${size}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** The race's certificate: open it, replace it or remove it; or add one from the device or a link. */
function CertificateRow({ activityId, certificate, onChange }: {
  activityId: number; certificate: Certificate | null; onChange: (c: Certificate | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(source: () => Promise<[string, string | null]>) {
    setBusy(true);
    setError(null);
    try {
      const [url, filename] = await source();
      onChange(await api.uploadCertificate(activityId, url, filename));
      setLinkOpen(false);
      setLink("");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 422 ? err.detail
        : err instanceof Error && err.message.startsWith("This file") ? err.message : "Couldn't add the certificate. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function picked(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_CERTIFICATE) {
      setError("This file is too large (10 MB at most).");
      return;
    }
    upload(async () => [await readAsDataUrl(file), file.name]);
  }

  async function remove() {
    if (!window.confirm("Remove this certificate?")) return;
    setBusy(true);
    try {
      await api.deleteCertificate(activityId);
      onChange(null);
    } catch {
      setError("Couldn't remove the certificate. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="race-certificate">
      <input ref={input} type="file" accept="application/pdf,image/*" hidden
        onChange={(e) => {
          picked(e.target.files?.[0]);
          e.target.value = ""; // the same file can be picked again
        }} />
      {certificate ? (
        <>
          <a className="certificate-link" href={photoSrc(certificate.url)} target="_blank" rel="noopener noreferrer"
            title={certificate.filename}>
            <FileText size={18} aria-hidden />
            <span>
              <strong>View certificate</strong>
              <span className="muted">{certificateInfo(certificate)}</span>
            </span>
          </a>
          <span className="spacer" />
          <button type="button" className="button ghost small" onClick={() => input.current?.click()} disabled={busy}>
            <RefreshCw size={14} aria-hidden /> Replace
          </button>
          <button type="button" className="button ghost small danger" onClick={remove} disabled={busy}>
            <Trash2 size={14} aria-hidden /> Remove
          </button>
        </>
      ) : (
        <>
          <button type="button" className="button small" onClick={() => input.current?.click()} disabled={busy}>
            <Upload size={14} aria-hidden /> {busy ? "Adding…" : "Add certificate"}
          </button>
          <span className="muted">PDF or image, from your device</span>
          {!linkOpen && (
            <button type="button" className="link-button" onClick={() => setLinkOpen(true)} disabled={busy}>
              or from a link
            </button>
          )}
        </>
      )}
      {linkOpen && !certificate && (
        <form className="photo-input-row certificate-link-form" onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) upload(async () => [link.trim(), decodeURIComponent(link.trim().split(/[?#]/)[0].split("/").pop() || "")]);
        }}>
          <input type="url" inputMode="url" placeholder="https://… (link to the PDF on the race's website)" aria-label="Certificate link"
            value={link} onChange={(e) => setLink(e.target.value)} autoFocus disabled={busy} />
          <button type="submit" className="button" disabled={busy || !link.trim()}>
            <Link2 size={15} aria-hidden /> Add
          </button>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function ResultView({ activity, result: r }: { activity: ActivityPageData; result: RaceResult }) {
  const watchTime = activity.duration;
  // The pace over the race itself when its distance is known, else over the whole activity.
  const distance = r.race_distance ?? activity.distance;
  const rankings = [
    { label: "Overall", rank: r.overall_rank, total: r.overall_total },
    { label: r.gender ? GENDER_LABEL[r.gender] : "By sex", rank: r.gender_rank, total: r.gender_total },
    { label: r.category ? `Category ${r.category}` : "Category", rank: r.category_rank, total: r.category_total },
  ].filter((x) => x.rank);
  return (
    <div className="race-result">
      {r.official_time && (
        <div className="race-time">
          <span className="race-label">
            Official time{r.race_distance ? ` · ${raceDistanceLabel(r.race_distance)}` : ""}
          </span>
          <strong>{clock(r.official_time)}</strong>
          <span className="muted">
            {distance > 0 && paceOrSpeed(activity.sport_type, distance / r.official_time)}
            {r.race_distance
              ? ` · in a ${km(activity.distance)} activity`
              : `${distance > 0 ? " · " : ""}Watch ${clock(watchTime)}`}
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
      {!r.official_time && r.race_distance && (
        <div className="race-time">
          <span className="race-label">Race distance</span>
          <strong>{raceDistanceLabel(r.race_distance)}</strong>
        </div>
      )}
      {!r.official_time && !r.race_distance && rankings.length === 0 && <p className="muted">No details yet.</p>}
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
  const [distanceKm, setDistanceKm] = useState(kmText(result?.race_distance));
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
    const raceDistance = distanceKm.trim() ? parseKm(distanceKm) : null;
    if (distanceKm.trim() && raceDistance === null) {
      setError("Type the race distance in km, e.g. 10 or 21.1.");
      return;
    }
    // Sex and category only count when there's a ranking for them, or to prefill the next race.
    const body: RaceResult = {
      official_time: seconds,
      race_distance: raceDistance,
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

      <fieldset className="race-rank-row race-distance-row">
        <legend>Race distance</legend>
        <div className="segmented" role="group" aria-label="Usual distances">
          {DISTANCES.map(([label, meters]) => (
            <button key={label} type="button" aria-pressed={sameDistance(parseKm(distanceKm), meters)}
              onClick={() => setDistanceKm(sameDistance(parseKm(distanceKm), meters) ? "" : kmText(meters))}>
              {label}
            </button>
          ))}
        </div>
        <span className="race-km">
          <input type="text" inputMode="decimal" aria-label="Race distance in km" value={distanceKm}
            placeholder={activity.distance > 0 ? String(Math.round(activity.distance / 100) / 10) : "km"}
            onChange={(e) => setDistanceKm(e.target.value)} />
          km
        </span>
        <small className="muted race-hint">
          {activity.distance > 0
            ? `When the race was only part of this ${km(activity.distance)} activity. Empty: the whole activity.`
            : "The race's distance, for the pace."}
        </small>
      </fieldset>

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
