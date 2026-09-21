/**
 * Which platforms keep the app in a tray when its window is closed (#174).
 *
 * This lives at the top level rather than in `src/desktop/` for a mechanical
 * reason worth knowing: `.vscodeignore` deliberately keeps `out/desktop/**` out
 * of the VS Code vsix, with a hand-listed exception per module the extension
 * genuinely requires at runtime — and `check:vsix` fails packaging when an
 * import crosses that boundary without one. `sidebar.ts` needs this predicate
 * to tell the settings page whether to offer the row, and a tray module is not
 * something the VS Code extension should be shipping to get it.
 *
 * So the rule has one definition, `src/desktop/tray.ts` re-exports it for the
 * desktop app, and neither copy can drift from the other.
 *
 * macOS is excluded on purpose: closing the last window there already leaves
 * the app running in the dock, so a status item would be a second affordance
 * for a behaviour the platform already has.
 */
export function trayIsSupported(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "linux";
}
