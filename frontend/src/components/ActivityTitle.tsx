import { Check, Pencil, X } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { api, type ActivityPageData } from "../api";
import { sportLabel } from "../format";

type Props = {
  activity: ActivityPageData;
  onRenamed: (name: string, renamed: boolean) => void;
};

/** The activity's title, with a pencil to give it your own (kept over Garmin's on every sync). */
export default function ActivityTitle({ activity, onRenamed }: Props) {
  const shown = activity.name || sportLabel(activity.sport_type);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(shown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(name: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.renameActivity(activity.id, name);
      onRenamed(r.name, r.renamed);
      setEditing(false);
    } catch {
      setError("Couldn't rename it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save(value);
  }

  function key(event: KeyboardEvent) {
    if (event.key === "Escape") setEditing(false);
  }

  if (editing) {
    return (
      <form className="title-form" onSubmit={submit}>
        <input aria-label="Activity title" value={value} maxLength={255} autoFocus onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)} onKeyDown={key} disabled={busy} />
        <button type="submit" className="button primary icon-only" aria-label="Save title" disabled={busy}>
          <Check size={16} aria-hidden />
        </button>
        <button type="button" className="button icon-only" aria-label="Cancel" onClick={() => setEditing(false)} disabled={busy}>
          <X size={16} aria-hidden />
        </button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    );
  }

  return (
    <div className="title-block">
      <h1>
        {shown}
        <button type="button" className="button ghost icon-only small title-edit" aria-label="Rename this activity"
          title="Rename" onClick={() => {
            setValue(shown);
            setEditing(true);
          }}>
          <Pencil size={14} aria-hidden />
        </button>
      </h1>
      {activity.renamed && (
        <p className="title-original">
          Garmin: {activity.garmin_name || "no name"} ·{" "}
          <button type="button" className="link-button" onClick={() => save("")} disabled={busy}>
            Reset
          </button>
        </p>
      )}
    </div>
  );
}
