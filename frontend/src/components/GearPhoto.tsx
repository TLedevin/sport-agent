import { Camera, ClipboardPaste, ExternalLink, ImageOff, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { api, ApiError, type Gear } from "../api";

/** Object URL of the gear's photo, or null. Loaded with the session (an <img> can't send it). */
function usePhotoUrl(gear: Gear): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!gear.photo_version) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    api
      .gearPhoto(gear.uuid, gear.photo_version)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [gear.uuid, gear.photo_version]);
  return url;
}

const MAX_UPLOAD_SIDE = 1600; // px: the server shrinks it further; this keeps big screenshots quick to send

/** A pasted image as a data: URL (the server takes those like an address), scaled down first. */
async function imageToDataUrl(image: Blob): Promise<string> {
  const bitmap = await createImageBitmap(image);
  const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.92); // PNG where the browser can't encode WebP (Safari)
}

const canReadClipboard = typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";

/** What to type in Google Images: the model, and what kind of gear it is. */
export function photoQuery(gear: Gear): string {
  const model = gear.make_model || gear.name;
  if (/shoe/i.test(gear.gear_type) && !/shoe/i.test(model)) return `${model} running shoe`;
  if (/bike/i.test(gear.gear_type) && !/bike/i.test(model)) return `${model} bike`;
  return model;
}

type Props = { gear: Gear; onChange: (version: string | null) => void };

/** The photo at the top of a gear card, or a button to add one. */
export default function GearPhoto({ gear, onChange }: Props) {
  const url = usePhotoUrl(gear);
  const [open, setOpen] = useState(false);
  return (
    <>
      {gear.photo_version ? (
        <div className="gear-photo">
          {url && <img src={url} alt={`Photo of ${gear.name}`} />}
          <button type="button" className="button small gear-photo-edit" onClick={() => setOpen(true)}>
            <Camera size={14} aria-hidden /> Change
          </button>
        </div>
      ) : (
        <button type="button" className="button ghost small gear-photo-add" onClick={() => setOpen(true)}>
          <Camera size={14} aria-hidden /> Add photo
        </button>
      )}
      {open && <PhotoDialog gear={gear} hasPhoto={Boolean(gear.photo_version)} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoDialog({ gear, hasPhoto, onChange, onClose }: {
  gear: Gear; hasPhoto: boolean; onChange: (version: string | null) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState("");
  const [pasted, setPasted] = useState<string | null>(null); // an image pasted from the clipboard
  // The preview's state, for the address or image it was reported for: a local image can finish
  // loading before an effect would run, so the state is keyed rather than reset on each change.
  const [previewOf, setPreviewOf] = useState<{ source: string; state: "ok" | "failed" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = address.trim();
  const source = pasted ?? trimmed;
  const looksValid = /^(https?:\/\/|data:image\/)/i.test(source);
  const preview = previewOf?.source === source ? previewOf.state : "loading";
  const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(photoQuery(gear))}`;

  // Opened as a modal (focus inside, Escape closes, page inert). No close() on cleanup: unmounting
  // removes it anyway, and its close event would call onClose again (twice in dev's StrictMode).
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    input.current?.focus(); // showModal() focuses the first control, the close button: go to the field
  }, []);

  // A new address or image: the previous one's error no longer applies.
  useEffect(() => setError(null), [source]);

  async function usePastedImage(image: Blob) {
    try {
      setPasted(await imageToDataUrl(image));
      setAddress("");
    } catch {
      setError("This image format can't be read here. Copy the image address instead.");
    }
  }

  /** Ctrl+V / ⌘V anywhere in the dialog: an image is taken as is; text goes to the field as usual. */
  function onPaste(event: ClipboardEvent) {
    const image = [...event.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    usePastedImage(image);
  }

  /** The button, for phones and anyone who prefers clicking: reads the clipboard (the browser asks first). */
  async function pasteFromClipboard() {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return await usePastedImage(await item.getType(type));
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (/^(https?:\/\/|data:image\/)/i.test(text)) {
        setPasted(null);
        setAddress(text);
      } else {
        setError("There's no image in the clipboard. Copy an image (or its address) first.");
      }
    } catch {
      setError("The browser didn't let the app read the clipboard. Press Ctrl+V (⌘V on a Mac) instead.");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { photo_version } = await api.setGearPhoto(gear.uuid, source);
      onChange(photo_version);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 422 ? err.detail : "Couldn't save the photo. Try again.");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteGearPhoto(gear.uuid);
      onChange(null);
      onClose();
    } catch {
      setError("Couldn't remove the photo. Try again.");
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="photo-dialog" aria-labelledby="photo-dialog-title" onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()} onPaste={onPaste}>
      <form onSubmit={save}>
        <div className="photo-dialog-head">
          <h2 id="photo-dialog-title">Photo of {gear.name}</h2>
          <button type="button" className="button icon-only small" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>

        <ol className="photo-steps">
          <li>
            <a className="button" href={searchUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden /> Search Google Images
            </a>
            <span className="muted"> for “{photoQuery(gear)}”</span>
          </li>
          <li>
            Open the image you like, then <strong>right-click it → Copy image</strong> (or Copy image address)
            <span className="muted">. On a phone: long-press it.</span>
          </li>
          <li>
            <label htmlFor="photo-address">Paste it here</label>
            {pasted ? (
              <div className="photo-pasted">
                <span>Image from the clipboard</span>
                <button type="button" className="button ghost small" onClick={() => setPasted(null)}>
                  <X size={14} aria-hidden /> Clear
                </button>
              </div>
            ) : (
              <div className="photo-input-row">
                <input id="photo-address" ref={input} type="text" inputMode="url" autoComplete="off"
                  placeholder="Ctrl+V: the image or its address" value={address}
                  onChange={(e) => setAddress(e.target.value)} />
                {canReadClipboard && (
                  <button type="button" className="button" onClick={pasteFromClipboard}>
                    <ClipboardPaste size={15} aria-hidden /> Paste image
                  </button>
                )}
              </div>
            )}
          </li>
        </ol>

        {looksValid && (
          <div className="photo-preview">
            {preview === "failed" ? (
              <p className="muted"><ImageOff size={16} aria-hidden /> No preview for this address. You can still try to save it.</p>
            ) : (
              <img src={source} alt="Preview" referrerPolicy="no-referrer" onLoad={() => setPreviewOf({ source, state: "ok" })}
                onError={() => setPreviewOf({ source, state: "failed" })} hidden={preview !== "ok"} />
            )}
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="photo-dialog-actions">
          {hasPhoto && (
            <button type="button" className="button ghost danger" onClick={remove} disabled={busy}>
              <Trash2 size={14} aria-hidden /> Remove photo
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary" disabled={busy || !looksValid}>
            {busy ? "Saving…" : "Save photo"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
