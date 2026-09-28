import { Bike, Footprints, Package, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type Gear } from "../api";
import GearPhoto from "../components/GearPhoto";
import { km, shortDate } from "../format";
import { errorNotice, useSync } from "../sync";

const NEAR_TARGET = 0.85; // share of the target distance from which a pair is flagged

function gearIcon(type: string): LucideIcon {
  if (/shoe/i.test(type)) return Footprints;
  if (/bike/i.test(type)) return Bike;
  return Package;
}

function Wear({ gear }: { gear: Gear }) {
  const target = gear.maximum_distance;
  if (!target) return <p className="gear-wear-text">No target distance set in Garmin Connect</p>;
  const share = gear.total_distance / target;
  const level = gear.status !== "active" ? "retired" : share >= 1 ? "over" : share >= NEAR_TARGET ? "near" : "ok";
  const text =
    level === "over"
      ? `${km(gear.total_distance - target)} over target: time to replace`
      : level === "near"
        ? `${Math.round(share * 100)}% of target: replace soon`
        : `${Math.round(share * 100)}% of target`;
  return (
    <>
      <div
        className={`gear-bar ${level}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(gear.total_distance, target)}
        aria-label="Distance against target"
      >
        <div style={{ width: `${Math.min(share, 1) * 100}%` }} />
      </div>
      <p className={`gear-wear-text ${level}`}>{text}</p>
    </>
  );
}

type PhotoChange = (uuid: string, version: string | null) => void;

function GearCard({ gear, onPhotoChange }: { gear: Gear; onPhotoChange: PhotoChange }) {
  const Icon = gearIcon(gear.gear_type);
  const showModel = gear.make_model && gear.make_model.toLowerCase() !== gear.name.toLowerCase();
  return (
    <li className={`card gear-card ${gear.status} ${gear.photo_version ? "with-photo" : "no-photo"}`}>
      <GearPhoto gear={gear} onChange={(version) => onPhotoChange(gear.uuid, version)} />
      <div className="gear-head">
        <span className="gear-icon" aria-hidden>
          <Icon size={18} />
        </span>
        <div className="gear-title">
          <h3>{gear.name}</h3>
          {showModel && <p className="card-sub">{gear.make_model}</p>}
        </div>
      </div>
      <div className="gear-distance">
        {km(gear.total_distance)}
        {gear.maximum_distance ? <span> / {km(gear.maximum_distance)}</span> : null}
      </div>
      <Wear gear={gear} />
      <dl className="gear-facts">
        <div>
          <dt>Activities</dt>
          <dd>{gear.total_activities}</dd>
        </div>
        <div>
          <dt>Since</dt>
          <dd>{gear.date_begin ? shortDate(gear.date_begin) : "–"}</dd>
        </div>
        {gear.status === "active" ? (
          <div>
            <dt>Last used</dt>
            <dd>{gear.last_used ? shortDate(gear.last_used) : "Never"}</dd>
          </div>
        ) : (
          <div>
            <dt>Retired</dt>
            <dd>{gear.date_end ? shortDate(gear.date_end) : "–"}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

function GearSection({ title, items, onPhotoChange }: { title: string; items: Gear[]; onPhotoChange: PhotoChange }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="section-title">
        {title} <span className="muted">{items.length}</span>
      </h2>
      <ul className="gear-grid">
        {items.map((g) => (
          <GearCard key={g.uuid} gear={g} onPhotoChange={onPhotoChange} />
        ))}
      </ul>
    </section>
  );
}

export default function EquipmentPage() {
  const { version, syncing, setNotice } = useSync();
  const [gear, setGear] = useState<Gear[] | null>(null);
  const setPhoto: PhotoChange = (uuid, version) =>
    setGear((items) => items && items.map((g) => (g.uuid === uuid ? { ...g, photo_version: version } : g)));

  useEffect(() => {
    let cancelled = false;
    api
      .gear()
      .then((rows) => !cancelled && setGear(rows))
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version, setNotice]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Equipment</h1>
        <p className="page-sub">Your gear from Garmin Connect, with distance against the target you set</p>
      </div>
      {gear === null ? (
        <div className="page-loading" role="status">
          <div className="loader" aria-hidden />
        </div>
      ) : gear.length === 0 ? (
        <section className="card empty-state">
          <h2>{syncing ? "Loading your equipment…" : "No equipment yet"}</h2>
          <p>
            {syncing
              ? "It appears here as soon as the sync is done."
              : "Add your shoes in Garmin Connect, then click Refresh."}
          </p>
        </section>
      ) : (
        <>
          <GearSection title="In use" items={gear.filter((g) => g.status === "active")} onPhotoChange={setPhoto} />
          <GearSection title="Retired" items={gear.filter((g) => g.status !== "active")} onPhotoChange={setPhoto} />
        </>
      )}
    </div>
  );
}
