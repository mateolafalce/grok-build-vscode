import { homedir } from "node:os";
import * as path from "node:path";
import { findCliOnPath, isCliFile } from "./cli-path";

/** Locate only an existing vendor binary; native Windows is unsupported. */
export function locateMuseCli(options: {
  configuredPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  isExecutable?: (file: string) => boolean;
  which?: (name: string) => string | undefined;
} = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return undefined;
  const env = options.env ?? process.env;
  const executable = options.isExecutable ?? ((file) => isCliFile(file, platform));
  const configured = options.configuredPath?.trim() || env.MUSE_CODE_EXECUTABLE?.trim();
  if (configured) return executable(configured) ? path.resolve(configured) : undefined;
  const found = options.which
    ? options.which("muse")
    : findCliOnPath("muse", env, platform, executable);
  if (found && executable(found)) return found;
  const candidate = path.join(options.home || env.HOME || homedir(), ".local", "bin", "muse");
  return executable(candidate) ? candidate : undefined;
}

export const MUSE_WINDOWS_REASON = "Muse Code is unavailable on this host: Meta does not provide a native Windows CLI";

/**
 * The version out of `muse --version`.
 *
 * MEASURED against the 1.3.0 launcher installed on a cloud host, not assumed:
 * it prints `Muse Code 1.3.0 (1.3.0-R3401.1)` -- the short version, then the
 * build it came from in parentheses. So the output carries TWO version-like
 * tokens, the second of which is the specific one, and the parenthesis is not
 * whitespace. Prefer the build when the CLI offers one; a CLI that prints a
 * single version is answered with that one.
 */
export function parseMuseVersionOutput(output: string): string {
  const found = [...output.trim().matchAll(/(?:^|[\s(])v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=[\s)]|$)/g)]
    .map((m) => m[1]);
  return found.find((v) => /[-+]/.test(v)) ?? found[0] ?? "";
}
