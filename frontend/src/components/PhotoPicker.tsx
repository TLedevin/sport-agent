import { ClipboardPaste, ExternalLink, ImageOff, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { ApiError } from "../api";

const MAX_UPLOAD_SIDE = 2000; // px: the server shrinks it further; this keeps phone photos quick to send

/** An image from the device or the clipboard as a data: URL (the server takes those like an
 * address), scaled down first: a 12-megapixel phone photo becomes a few hundred KB. */
async function imageToDataUrl(image: Blob): Promise<string> {
  const bitmap = await createImageBitmap(image, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.92); // PNG where the browser can't encode WebP (Safari)
}

const canReadClipboard = typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";
const IMAGE_ADDRESS = /^(https?:\/\/|data:image\/)/i;

/** An image waiting to be saved: from the device, the clipboard, or an address. */
type Pending = { key: number; source: string; label: string; preview: "loading" | "ok" | "failed" };

type Props = {
  title: string;
  /** What "Search the web" looks for in Google Images. */
  searchQuery: string;
  /** Several images at once (activity photos), or one that replaces the current one (gear). */
  multiple: boolean;
  /** Saves one image (an address or a data: URL). Throws ApiError with a message on refusal. */
  save: (source: string) => Promise<void>;
  onClose: () => void;
  /** When set, a "Remove photo" button (single mode, when a photo exists). */
  remove?: () => Promise<void>;
};

/** Add photos from the device, the clipboard or the web: one dialog for gear and activities. */
export default function PhotoPicker({ title, searchQuery, multiple, save, onClose, remove }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // progress text while saving
  const [error, setError] = useState<string | null>(null);
  const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchQuery)}`;

  // A modal (focus inside, Escape closes, page inert). No close() on cleanup: unmounting removes
  // it anyway, and its close event would call onClose again (twice in dev's StrictMode).
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  function add(source: string, label: string) {
    const item = { key: nextKey.current++, source, label, preview: "loading" as const };
    setPending((items) => (multiple ? [...items, item] : [item]));
    setError(null);
  }

  async function addImages(images: Blob[], label: string) {
    for (const image of multiple ? images : images.slice(0, 1)) {
      try {
        add(await imageToDataUrl(image), label);
      } catch {
        setError("One of the images can't be read here (format not supported by this browser).");
      }
    }
  }

  function addAddress(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = address.trim();
    if (!IMAGE_ADDRESS.test(trimmed)) {
      setError("Paste an image address starting with https://");
      return;
    }
    add(trimmed, "From the web");
    setAddress("");
  }

  /** Ctrl+V / ⌘V anywhere in the dialog: images are taken as is; text goes to the field as usual. */
  function onPaste(event: ClipboardEvent) {
    const images = [...event.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    addImages(images, "Pasted");
  }

  /** The button, for phones: reads the clipboard (the browser asks first). */
  async function pasteFromClipboard() {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return await addImages([await item.getType(type)], "Pasted");
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (IMAGE_ADDRESS.test(text)) add(text, "From the web");
      else setError("There's no image in the clipboard. Copy an image (or its address) first.");
    } catch {
      setError("The browser didn't let the app read the clipboard. Press Ctrl+V (⌘V on a Mac) instead.");
    }
  }

  function setPreview(key: number, preview: Pending["preview"]) {
    setPending((items) => items.map((p) => (p.key === key ? { ...p, preview } : p)));
  }

  async function saveAll() {
    setError(null);
    const failed: Pending[] = [];
    const messages: string[] = [];
    for (const [i, item] of pending.entries()) {
      setBusy(pending.length > 1 ? `Adding ${i + 1} of ${pending.length}…` : "Saving…");
      try {
        await save(item.source);
      } catch (err) {
        failed.push(item);
        messages.push(err instanceof ApiError && err.status === 422 ? err.detail : "Couldn't save it. Try again.");
      }
    }
    setBusy(null);
    if (!failed.length) return onClose();
    // Keep what failed, with the reason, so it can be removed or retried.
    setPending(failed);
    const saved = pending.length - failed.length;
    setError((saved ? `${saved} added. ` : "") + [...new Set(messages)].join(" "));
  }

  async function removeCurrent() {
    if (!remove) return;
    setBusy("Removing…");
    try {
      await remove();
      onClose();
    } catch {
      setError("Couldn't remove the photo. Try again.");
      setBusy(null);
    }
  }

  const count = pending.length;
  return (
    <dialog ref={dialog} className="photo-dialog" aria-labelledby="photo-dialog-title" onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()} onPaste={onPaste}>
      <div className="photo-dialog-head">
        <h2 id="photo-dialog-title">{title}</h2>
        <button type="button" className="button icon-only small" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="photo-sources">
        <section aria-labelledby="source-device">
          <h3 id="source-device">From this device</h3>
          <button type="button" className="button" onClick={() => fileInput.current?.click()} autoFocus>
            <ImagePlus size={15} aria-hidden /> Choose {multiple ? "photos" : "a photo"}
          </button>
          <input ref={fileInput} type="file" accept="image/*" multiple={multiple} hidden
            onChange={(e) => {
              addImages([...(e.target.files ?? [])], "From this device");
              e.target.value = ""; // the same file can be picked again
            }} />
        </section>

        <section aria-labelledby="source-paste">
          <h3 id="source-paste">Copy and paste</h3>
          <p className="muted">Copy an image anywhere, then press Ctrl+V (⌘V) here.</p>
          {canReadClipboard && (
            <button type="button" className="button" onClick={pasteFromClipboard}>
              <ClipboardPaste size={15} aria-hidden /> Paste image
            </button>
          )}
        </section>

        <section aria-labelledby="source-web">
          <h3 id="source-web">From the web</h3>
          <a className="button" href={searchUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={15} aria-hidden /> Search Google Images
          </a>
          <p className="muted">
            For “{searchQuery}”. Right-click an image → Copy image, and paste it here; or copy its address:
          </p>
          <form className="photo-input-row" onSubmit={addAddress}>
            <input type="text" inputMode="url" autoComplete="off" aria-label="Image address"
              placeholder="https://…" value={address} onChange={(e) => setAddress(e.target.value)} />
            <button type="submit" className="button" disabled={!address.trim()}>
              <Plus size={15} aria-hidden /> Add
            </button>
          </form>
        </section>
      </div>

      {count > 0 && (
        <ul className="photo-pending" aria-label="Photos to add">
          {pending.map((p) => (
            <li key={p.key}>
              {p.preview === "failed" ? (
                <div className="photo-pending-failed" title="No preview: it can still be saved">
                  <ImageOff size={18} aria-hidden />
                </div>
              ) : (
                <img src={p.source} alt={p.label} referrerPolicy="no-referrer" hidden={p.preview !== "ok"}
                  onLoad={() => setPreview(p.key, "ok")} onError={() => setPreview(p.key, "failed")} />
              )}
              <span className="photo-pending-label">{p.label}</span>
              <button type="button" className="button icon-only small" aria-label={`Remove this ${p.label.toLowerCase()} image`}
                onClick={() => setPending((items) => items.filter((x) => x.key !== p.key))} disabled={busy !== null}>
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="photo-dialog-actions">
        {remove && (
          <button type="button" className="button ghost danger" onClick={removeCurrent} disabled={busy !== null}>
            <Trash2 size={14} aria-hidden /> Remove photo
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="button primary" disabled={busy !== null || count === 0} onClick={saveAll}>
          {busy ?? (multiple ? `Add ${count || ""} ${count === 1 ? "photo" : "photos"}`.replace("  ", " ") : "Save photo")}
        </button>
      </div>
    </dialog>
  );
}
