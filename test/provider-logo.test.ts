import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("provider logo assets", () => {
  // settings.js carries a third copy because the VS Code settings TAB loads
  // only settings.css + settings.js — it cannot reach a shared helper.
  it.each(["media/chat.js", "media/projects-rail.js", "media/settings.js"])("inlines both currentColor Lobe marks in %s", (file) => {
    const source = read(file);
    expect(source).toContain("Provider marks from Lobe Icons (MIT)");
    expect(source).toContain('viewBox="0 0 24 24" fill="currentColor"');
    expect(source).toContain("M9.27 15.29l7.978-5.897");
    expect(source).toContain("M9.205 8.658v-2.26");
    expect(source).toContain("M4.709 15.955l4.72-2.647.08-.23-.08-.128");
    expect(source).toContain("M6.897 4c1.915 0 3.516.932 5.43 3.376");
    const providerSvgs = source.match(/<svg class="provider-logo"[^>]*>/g) ?? [];
    expect(providerSvgs.length).toBeGreaterThan(0);
    expect(providerSvgs.every((svg) => !svg.includes("style="))).toBe(true);
    // Meta's two loops are drawn with holes, so nonzero fills them solid and
    // the mark becomes a blob. Lobe ships all four marks with evenodd and the
    // other three render the same under it, which is why it sits on the shared
    // template rather than on one provider's path.
    expect(providerSvgs.every((svg) => svg.includes('fill-rule="evenodd"'))).toBe(true);
    // No provider draws its own initial. A letter beside three real marks is a
    // placeholder, and Muse Code carried one until 4.11.0.
    expect(source).not.toMatch(/>[A-Z]<\/span>/);
  });

  it.each(["media/chat.css", "media/projects-rail.css"])("maps every badge state and draws the one-pixel row-color ring in %s", (file) => {
    const css = read(file);
    for (const state of ["working", "needs-you", "unread", "error"]) {
      expect(css).toContain(`provider-status-badge${file.endsWith("chat.css") ? `.dot-${state}` : `[data-dot="${state}"]`}`);
    }
    expect(css).toMatch(/\.provider-status-badge\s*\{[\s\S]*?width:\s*4px;[\s\S]*?height:\s*4px;/);
    expect(css).toContain("box-shadow: 0 0 0 1px var(--provider-badge-ring");
  });
});
