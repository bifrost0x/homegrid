import { Check, X } from "lucide-react";
import type { UndoRecord } from "../lib";

/** Live status line for confirmations and the most recent undoable change. */
export function Feedback({
  notice,
  undo,
  busy,
  onUndo,
  onDismiss,
}: {
  notice: string;
  undo?: UndoRecord;
  busy: boolean;
  onUndo: (undo: UndoRecord) => void;
  onDismiss: () => void;
}) {
  if (!notice && !undo) return null;
  return (
    <div className="feedback" aria-live="polite">
      <Check size={15} />
      <span>{undo?.label ?? notice}</span>
      {undo && (
        <button
          className="button secondary undo-button"
          disabled={busy}
          onClick={() => onUndo(undo)}
        >
          Undo
        </button>
      )}
      <button
        className="icon-button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
