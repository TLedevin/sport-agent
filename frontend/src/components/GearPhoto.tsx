import { Camera } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Gear } from "../api";
import PhotoPicker from "./PhotoPicker";

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
      {open && (
        <PhotoPicker
          title={`Photo of ${gear.name}`}
          searchQuery={photoQuery(gear)}
          multiple={false}
          save={async (source) => onChange((await api.setGearPhoto(gear.uuid, source)).photo_version)}
          remove={gear.photo_version ? async () => {
            await api.deleteGearPhoto(gear.uuid);
            onChange(null);
          } : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
