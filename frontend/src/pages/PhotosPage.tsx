import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, type PhotoGroup } from "../api";
import PhotoGallery from "../components/PhotoGallery";
import { activityDate, sportLabel } from "../format";
import { SportBadge } from "../sports";
import { errorNotice, useSync } from "../sync";

/** Every photo, grouped by activity, newest activity first. */
export default function PhotosPage() {
  const { version, setNotice } = useSync();
  const [groups, setGroups] = useState<PhotoGroup[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .photos()
      .then((g) => !cancelled && setGroups(g))
      .catch((err) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setNotice(errorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version, setNotice]);

  const total = groups?.reduce((sum, g) => sum + g.photos.length, 0) ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Photos</h1>
        <p className="page-sub">
          {groups && total > 0
            ? `${total.toLocaleString("en")} ${total === 1 ? "photo" : "photos"} from ${groups.length} ${groups.length === 1 ? "activity" : "activities"}`
            : "Your photos, by activity"}
        </p>
      </div>

      {groups === null ? (
        <div className="page-loading" role="status">
          <div className="loader" aria-hidden />
        </div>
      ) : groups.length === 0 ? (
        <section className="card empty-state">
          <h2>No photos yet</h2>
          <p>
            Open an activity and click <strong>Add photos</strong>: pick them on your device, paste them, or find them
            on the web.
          </p>
          <Link to="/activities" className="button">Go to activities</Link>
        </section>
      ) : (
        groups.map(({ activity: a, photos }) => {
          const name = a.name || sportLabel(a.sport_type);
          return (
            <section key={a.id} className="card photo-group" aria-labelledby={`photos-${a.id}`}>
              <div className="photo-group-head">
                <SportBadge family={a.sport_family} size={32} />
                <div>
                  <h2 id={`photos-${a.id}`}>
                    <Link to={`/activities/${a.id}`} className="title-link">{name}</Link>
                  </h2>
                  <p className="card-sub">
                    {activityDate(a.start_time_local)}
                    {a.location_name && (
                      <span className="activity-card-place">
                        <MapPin size={13} aria-hidden /> {a.location_name}
                      </span>
                    )}
                  </p>
                </div>
                <span className="muted photo-group-count">
                  {photos.length} {photos.length === 1 ? "photo" : "photos"}
                </span>
              </div>
              <PhotoGallery label={`Photos of ${name}`}
                items={photos.map((photo) => ({ photo, caption: name, href: `/activities/${a.id}` }))}
                onDelete={async (photo) => {
                  await api.deleteActivityPhoto(photo.id);
                  setGroups((list) =>
                    (list ?? [])
                      .map((g) => (g.activity.id === a.id ? { ...g, photos: g.photos.filter((p) => p.id !== photo.id) } : g))
                      .filter((g) => g.photos.length > 0),
                  );
                }} />
            </section>
          );
        })
      )}
    </div>
  );
}
