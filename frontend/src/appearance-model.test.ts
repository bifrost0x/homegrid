import { describe, expect, it } from "vitest";
import { defaults, type Settings } from "./lib";
import {
  applyPreset,
  backgroundImage,
  backgroundKind,
  gradients,
  matchingPreset,
  palettes,
  photos,
  presets,
} from "./themes";

describe("appearance model", () => {
  it("keeps every preset consistent with palettes and backgrounds", () => {
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    for (const preset of presets) {
      expect(palettes.map((p) => p.id)).toContain(preset.palette);
      expect([
        "none",
        ...photos.map((p) => p.id),
        ...gradients.map((g) => g.id),
      ]).toContain(preset.wallpaper);
      expect(matchingPreset(applyPreset(defaults, preset.id))?.id).toBe(
        preset.id,
      );
    }
  });
  it("describes each background kind and its CSS", () => {
    const at = (patch: Partial<Settings>) => ({ ...defaults, ...patch });
    expect(backgroundKind(at({ wallpaper: "none" }))).toBe("none");
    expect(backgroundImage(at({ wallpaper: "none" }))).toBe("");
    expect(backgroundKind(at({ wallpaper: "aurora" }))).toBe("photo");
    expect(backgroundImage(at({ wallpaper: "aurora" }))).toBe(
      'url("/backgrounds/aurora.webp")',
    );
    expect(backgroundKind(at({ wallpaper: "gradient-dusk" }))).toBe("gradient");
    expect(backgroundImage(at({ wallpaper: "gradient-dusk" }))).toMatch(
      /^radial-gradient\(/,
    );
    const upload = at({
      wallpaper: "gradient-dusk",
      background: "/uploads/a.png",
    });
    expect(backgroundKind(upload)).toBe("upload");
    expect(backgroundImage(upload)).toBe('url("/uploads/a.png")');
    // Palette-only identifiers are not backgrounds.
    expect(backgroundImage(at({ wallpaper: "graphite" }))).toBe("");
  });
  it("leaves no preset matched after an individual change", () => {
    const aurora = applyPreset(defaults, "aurora");
    expect(matchingPreset(aurora)?.id).toBe("aurora");
    expect(matchingPreset({ ...aurora, design: "nord" })).toBeUndefined();
    expect(
      matchingPreset({ ...aurora, custom_accent: "#123456" }),
    ).toBeUndefined();
  });
});
