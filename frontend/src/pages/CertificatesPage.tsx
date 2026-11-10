import { FileText, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, photoSrc, type Certificate } from "../api";
import { certificateInfo } from "../components/RaceResult";
import { clock, km, shortDate } from "../format";
import { buildRaces, groupLabel, topText, type Race } from "../races";
import { errorNotice, useSync } from "../sync";

type Item = { race: Race; certificate: Certificate };

/** Every race certificate, newest race first (a race's certificates in the order added). */
export default function CertificatesPage() {
  const { version, setNotice } = useSync();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The races already carry their certificates (name, type, size, signed address).
    api
      .races()
      .then((d) => {
        if (cancelled) return;
        const races = buildRaces(d.races).reverse();
        setItems(races.flatMap((race) => (race.activity.race_result?.certificates ?? []).map((certificate) => ({ race, certificate }))));
      })
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
        <h1>Certificates</h1>
        <p className="page-sub">
          {items && items.length > 0
            ? `${items.length} ${items.length === 1 ? "certificate" : "certificates"} from ${new Set(items.map((i) => i.race.activity.id)).size} ${new Set(items.map((i) => i.race.activity.id)).size === 1 ? "race" : "races"}, newest race first`
            : "The certificates of your races"}
        </p>
      </div>

      {items === null ? (
        <div className="page-loading" role="status">
          <div className="loader" aria-hidden />
        </div>
      ) : items.length === 0 ? (
        <section className="card empty-state">
          <h2>No certificates yet</h2>
          <p>
            Open a race, and in its <strong>Race result</strong> click <strong>Add certificate</strong>: a PDF or a photo
            of it, from your device or a link.
          </p>
          <Link to="/races" className="button"><Trophy size={15} aria-hidden /> Go to races</Link>
        </section>
      ) : (
        <ul className="certificate-grid">
          {items.map((item) => <CertificateCard key={item.certificate.id} {...item} />)}
        </ul>
      )}
    </div>
  );
}

function CertificateCard({ race: r, certificate }: Item) {
  const href = photoSrc(certificate.url);
  const isImage = certificate.content_type.startsWith("image/");
  const result = r.activity.race_result!;
  const facts = [
    r.group === "other" ? km(r.distance) : groupLabel(r.group),
    r.time ? clock(r.time) : null,
    result.overall_rank ? (r.top.overall !== null ? topText(r.top.overall) : `#${result.overall_rank}`) : null,
  ].filter(Boolean);
  return (
    <li className="card certificate-card">
      <a className="certificate-preview" href={href} target="_blank" rel="noopener noreferrer"
        aria-label={`Open the certificate of ${r.activity.name}`}>
        {isImage ? (
          <img src={href} alt="" loading="lazy" />
        ) : (
          <span className="certificate-pdf">
            <FileText size={40} strokeWidth={1.5} aria-hidden />
            PDF
          </span>
        )}
      </a>
      <div className="certificate-body">
        <Link to={`/activities/${r.activity.id}`} className="activity-name">{r.activity.name}</Link>
        <span className="muted">{shortDate(r.date)}{facts.length > 0 && ` · ${facts.join(" · ")}`}</span>
        <a className="certificate-open" href={href} target="_blank" rel="noopener noreferrer" title={certificate.filename}>
          <FileText size={14} aria-hidden /> {certificateInfo(certificate)}
        </a>
      </div>
    </li>
  );
}
