import { describe, expect, it } from "vitest";
import { defaults, type Settings } from "./lib";
import { appearanceStyle, applyDesign, designs, wallpaperUrl } from "./themes";
const luminance = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);

describe("design catalog", () => {
  it("contains twelve distinct designs with local wallpapers", () => {
    expect(designs).toHaveLength(12);
    expect(new Set(designs.map((design) => design.id)).size).toBe(12);
    for (const design of designs) {
      expect(design.wallpaper).toBe(design.id);
      expect(
        wallpaperUrl({ ...defaults, wallpaper: design.wallpaper } as Settings),
      ).toBe(`/backgrounds/${design.id}.webp`);
    }
  });
  it("applies a design without mutating settings or changing layout", () => {
    const previous = {
      ...defaults,
      title: "My home",
      density: "compact",
      radius: "square",
      content_width: "wide",
      columns: "4",
      group_columns: "2",
      card_style: "list",
      background: "/uploads/old.png",
      custom_accent: "#123456",
    } as Settings;
    const copy = { ...previous };
    const next = applyDesign(previous, "aurora");
    expect(previous).toEqual(copy);
    expect(next).toMatchObject({
      design: "aurora",
      wallpaper: "aurora",
      theme: "dark",
      accent: "violet",
      background: "",
      custom_accent: "",
      background_strength: "balanced",
      blur: false,
    });
    for (const key of [
      "title",
      "density",
      "radius",
      "content_width",
      "columns",
      "group_columns",
      "card_style",
    ] as const)
      expect(next[key]).toBe(previous[key]);
    expect(applyDesign(previous, "missing")).toEqual(previous);
  });
  it("prioritizes custom backgrounds and rejects arbitrary wallpaper paths", () => {
    expect(
      wallpaperUrl({
        ...defaults,
        wallpaper: "dune",
        background: "/uploads/personal.webp",
      }),
    ).toBe("/uploads/personal.webp");
    expect(wallpaperUrl({ ...defaults, wallpaper: "none" })).toBe("");
    for (const wallpaper of [
      "../../private",
      "https://example.com/a",
      "",
      "toString",
    ])
      expect(wallpaperUrl({ ...defaults, wallpaper } as Settings)).toBe("");
  });
});

describe("custom accent", () => {
  it("keeps small custom-colored details readable on the catalog surface extremes", () => {
    for (let red = 0; red <= 255; red += 51)
      for (let green = 0; green <= 255; green += 51)
        for (let blue = 0; blue <= 255; blue += 51) {
          const custom_accent =
            "#" +
            [red, green, blue]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("");
          const style = appearanceStyle({ ...defaults, custom_accent });
          for (const [mode, backgrounds] of [
            ["light", ["#eeddce", "#ffffff"]],
            ["dark", ["#000000", "#2b4a42"]],
          ] as const)
            for (const background of backgrounds)
              expect(
                contrast(
                  style[
                    ("--custom-ink-" + mode) as keyof typeof style
                  ] as string,
                  background,
                ),
              ).toBeGreaterThanOrEqual(4.5);
        }
  });
  it("uses readable foregrounds for light, dark, and middle colors", () => {
    const luminance = (hex: string) => {
      const channels = hex
        .slice(1)
        .match(/../g)!
        .map((channel) => parseInt(channel, 16) / 255)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const custom_accent of [
      "#ffffff",
      "#000000",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#aabbcc",
    ]) {
      const style = appearanceStyle({ ...defaults, custom_accent });
      const background = luminance(
        style["--accent" as keyof typeof style] as string,
      );
      const foreground = luminance(
        style["--accent-text" as keyof typeof style] as string,
      );
      expect(
        (Math.max(background, foreground) + 0.05) /
          (Math.min(background, foreground) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("ignores missing and malformed custom colors", () => {
    for (const custom_accent of [
      "",
      "red",
      "#fff",
      "#123456; color:red",
      "url(x)",
    ])
      expect(appearanceStyle({ ...defaults, custom_accent })).toEqual({});
  });
});
