import { Status } from "./Status.tsx";

/** Zustand einer Pauschale, in ihrer Liste und in der Schnellsuche: nur eine stornierte hat einen */
export function PauschaleStatus({ storniert }: { storniert: boolean }) {
  return storniert ? <Status tone="danger">Storniert</Status> : null;
}
