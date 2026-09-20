"use client";

import { useFormStatus } from "react-dom";

export function SyncButton() {
  const { pending } = useFormStatus();

  return (
    <button disabled={pending} type="submit">
      {pending ? "Starting sync..." : "Sync GitHub activity"}
    </button>
  );
}
