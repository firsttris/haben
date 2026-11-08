/**
 * Zeitlimit für Tests mit echtem ERiC. Startet ERIC_WORKER_COMMAND den Worker emuliert (QEMU auf arm64, siehe
 * docs/installation.md, „ELSTER auf arm64“), dauert ein ERiC-Aufruf rund 25 statt einer Sekunde; dann gilt das
 * Zwanzigfache, sonst das angegebene Limit.
 */
export function ericTestTimeout(ms: number, workerCommand = process.env.ERIC_WORKER_COMMAND): number {
  return workerCommand?.trim() ? ms * 20 : ms;
}
