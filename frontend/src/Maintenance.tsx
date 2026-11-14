import { useState } from "react";
import { ImageOff, Trash2 } from "lucide-react";
import { ErrorMessage } from "./components";
import { api } from "./lib";

interface UnusedUpload {
  name: string;
  url: string;
  size: number;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Lists uploaded images that no application, setting or pending undo uses,
 * and deletes them only after the administrator reviewed and confirmed.
 */
export function UnusedUploads() {
  const [files, setFiles] = useState<UnusedUpload[]>(),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const total = files?.reduce((sum, file) => sum + file.size, 0) ?? 0;
  return (
    <div className="unused-uploads">
      <h3>Unused images</h3>
      <p>
        Icons and backgrounds stay on disk after you replace them. Review the
        images nothing uses anymore before deleting them. Images uploaded in the
        last 24 hours are kept. JSON exports do not contain images, so an older
        export that refers to a deleted image shows a fallback icon.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await api<{ files: UnusedUpload[] }>(
              "/uploads/unused",
            );
            setFiles(result.files);
            setConfirmed(false);
          })
        }
      >
        <ImageOff size={16} />
        Find unused images
      </button>
      {files && files.length === 0 && (
        <p className="notice" role="status">
          No unused images found.
        </p>
      )}
      {files && files.length > 0 && (
        <div className="unused-review">
          <p>
            {files.length} unused {files.length === 1 ? "image" : "images"} ·{" "}
            {formatSize(total)}
          </p>
          <ul className="unused-grid" aria-label="Unused images">
            {files.map((file) => (
              <li key={file.name}>
                <img
                  src={file.url}
                  alt={`Unused image, ${formatSize(file.size)}`}
                  loading="lazy"
                />
              </li>
            ))}
          </ul>
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Permanently delete these images. This cannot be undone.
          </label>
          <button
            type="button"
            className="button danger"
            disabled={busy || !confirmed}
            onClick={() =>
              void run(async () => {
                const result = await api<{ deleted: number }>(
                  "/uploads/cleanup",
                  "POST",
                  { names: files.map((file) => file.name), confirm: true },
                );
                setFiles(undefined);
                setConfirmed(false);
                setNotice(
                  `Deleted ${result.deleted} unused ${result.deleted === 1 ? "image" : "images"}.`,
                );
              })
            }
          >
            <Trash2 size={16} />
            Delete unused images
          </button>
        </div>
      )}
      <ErrorMessage error={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
