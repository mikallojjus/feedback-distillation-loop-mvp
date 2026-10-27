// The names the loop keeps under runs/ for its own files: the markers (SETUP, DECIDING, PAUSED), the promote lock, the pull store and its LATEST pointer, the builder registry and the
// practice pages. A run folder may not take one: the guard hook and the pause check read a marker by its name, and a folder of that name must not pass for it.
//
//   RESERVED_RUN_IDS        the names
//   isReservedRunId(id)     true for one of them, in any letter case (Windows does not tell SETUP from setup)

export const RESERVED_RUN_IDS = Object.freeze(['SETUP', 'DECIDING', 'PAUSED', 'PROMOTING', 'PROMOTING.json', 'LATEST', 'builder', 'demos', 'pull']);

export function isReservedRunId(id) {
  const wanted = String(id ?? '').trim().toLowerCase();
  return RESERVED_RUN_IDS.some((name) => name.toLowerCase() === wanted);
}
