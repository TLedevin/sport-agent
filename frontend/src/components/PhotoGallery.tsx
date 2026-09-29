import { ChevronLeft, ChevronRight, ExternalLink, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { Link } from "react-router";
import { photoSrc, type Photo } from "../api";

export type GalleryItem = {
  photo: Photo;
  /** Shown under the photo in the viewer, e.g. the activity's name. */
  caption?: string;
  /** Where the viewer's "Open activity" link goes. */
  href?: string;
};

type Props = {
  items: GalleryItem[];
  /** Deletes a photo (asks first). Without it, the viewer has no delete button. */
  onDelete?: (photo: Photo) => Promise<void>;
  /** Thumbnails in a single row that scrolls (dashboard), instead of a wrapping grid. */
  strip?: boolean;
  label: string;
};

/** Thumbnails; a click opens the photo full size, with previous / next. */
export default function PhotoGallery({ items, onDelete, strip = false, label }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <ul className={strip ? "photo-strip" : "photo-grid"} aria-label={label}>
        {items.map((item, i) => (
          <li key={item.photo.id}>
            <button type="button" className="photo-thumb" onClick={() => setOpen(i)}
              aria-label={`Open photo ${i + 1} of ${items.length}${item.caption ? `, ${item.caption}` : ""}`}>
              <img src={photoSrc(item.photo.thumb_url)} alt="" loading="lazy" decoding="async"
                width={item.photo.width} height={item.photo.height} />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && items[open] && (
        <Viewer items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)}
          onDelete={onDelete && (async (photo) => {
            await onDelete(photo);
            // Stay on the same position: the next photo slides in, or close after the last one.
            setOpen(items.length <= 1 ? null : Math.min(open, items.length - 2));
          })} />
      )}
    </>
  );
}

const SWIPE = 50; // px of horizontal finger travel to change photo

function Viewer({ items, index, onIndex, onClose, onDelete }: {
  items: GalleryItem[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  onDelete?: (photo: Photo) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const touchX = useRef<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && hasPrev) onIndex(index - 1);
      if (event.key === "ArrowRight" && hasNext) onIndex(index + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, hasPrev, hasNext, onIndex]);

  // The next photo starts loading while this one is looked at.
  useEffect(() => {
    if (hasNext) new Image().src = photoSrc(items[index + 1].photo.url);
  }, [index, hasNext, items]);

  async function remove() {
    if (!onDelete || !window.confirm("Delete this photo?")) return;
    setDeleting(true);
    try {
      await onDelete(item.photo);
    } finally {
      setDeleting(false);
    }
  }

  function touchEnd(event: TouchEvent) {
    if (touchX.current === null) return;
    const dx = event.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx > SWIPE && hasPrev) onIndex(index - 1);
    if (dx < -SWIPE && hasNext) onIndex(index + 1);
  }

  return (
    <dialog ref={dialog} className="photo-viewer" aria-label="Photo" onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}>
      <div className="photo-viewer-bar">
        <span className="photo-viewer-count">{index + 1} / {items.length}</span>
        {item.caption && <span className="photo-viewer-caption">{item.caption}</span>}
        <span className="spacer" />
        {item.href && (
          <Link to={item.href} className="button small" onClick={onClose} aria-label="Open activity">
            <ExternalLink size={14} aria-hidden /> <span className="button-label">Open activity</span>
          </Link>
        )}
        {onDelete && (
          <button type="button" className="button small danger" onClick={remove} disabled={deleting} aria-label="Delete photo">
            <Trash2 size={14} aria-hidden /> <span className="button-label">Delete</span>
          </button>
        )}
        <button type="button" className="button icon-only small" aria-label="Close" onClick={onClose} autoFocus>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="photo-viewer-stage" onTouchStart={(e) => (touchX.current = e.touches[0].clientX)} onTouchEnd={touchEnd}>
        <img key={item.photo.id} src={photoSrc(item.photo.url)} alt={item.caption ?? "Photo"}
          width={item.photo.width} height={item.photo.height} />
        {hasPrev && (
          <button type="button" className="photo-viewer-nav prev" aria-label="Previous photo" onClick={() => onIndex(index - 1)}>
            <ChevronLeft size={26} aria-hidden />
          </button>
        )}
        {hasNext && (
          <button type="button" className="photo-viewer-nav next" aria-label="Next photo" onClick={() => onIndex(index + 1)}>
            <ChevronRight size={26} aria-hidden />
          </button>
        )}
      </div>
    </dialog>
  );
}
