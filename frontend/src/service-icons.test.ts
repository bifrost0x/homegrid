/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  findIcons,
  findTemplates,
  serviceCategories,
  serviceTemplates,
} from "./catalog";
import { serviceIcons, serviceIconUrl } from "./serviceIcons";

const assets = import.meta.glob<string>("../public/service-icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});
const asset = (id: string) => assets[`../public/service-icons/${id}.svg`];

describe("offline service catalog", () => {
  it("provides forty distinct named service logos with local SVG assets", () => {
    expect(serviceTemplates).toHaveLength(40);
    expect(Object.keys(serviceIcons)).toHaveLength(40);
    expect(
      new Set(serviceTemplates.map((template) => template.icon)).size,
    ).toBe(40);
    expect(
      new Set(serviceTemplates.map((template) => template.name)).size,
    ).toBe(40);
    expect(Object.keys(assets)).toHaveLength(40);
    for (const template of serviceTemplates) {
      expect(serviceIconUrl(template.icon)).toMatch(
        /^\/service-icons\/[a-z0-9]+\.svg$/,
      );
      const id = template.icon.slice("service:".length);
      expect(serviceIcons[id].name).toBe(template.name);
      expect(asset(id)).toContain("<svg");
      expect(serviceCategories).toContain(template.category);
      expect(findTemplates(template.name)).toContain(template);
    }
  });

  it("retains the generic icon picker and supports category searches", () => {
    expect(findIcons("")).toHaveLength(44);
    expect(findIcons("camera").length).toBeGreaterThan(0);
    expect(
      findTemplates("Development").map((template) => template.name),
    ).toEqual(["Gitea", "Forgejo", "GitLab"]);
    expect(findTemplates("media jellyfin")[0].name).toBe("Jellyfin");
  });

  it("resolves only explicit known service identifiers", () => {
    for (const icon of [
      "",
      "https://tracker.invalid/logo.svg",
      "//tracker.invalid/logo.svg",
      "javascript:alert(1)",
      "service:https://tracker.invalid/logo.svg",
      "service:../jellyfin",
      "service:jellyfin.svg",
      "service:jellyfin?track=1",
      "service:jellyfin#x",
      "service:constructor",
      "service:__proto__",
      "service:toString",
      "Service:jellyfin",
      "service:Jellyfin",
      "builtin:film",
    ]) {
      expect(serviceIconUrl(icon)).toBe("");
    }
    expect(serviceIconUrl("service:jellyfin")).toBe(
      "/service-icons/jellyfin.svg",
    );
  });

  it("ships valid standalone artwork without executable content or external requests", () => {
    for (const { src } of Object.values(serviceIcons)) {
      const svg = assets[`../public${src}`];
      expect(svg).not.toMatch(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i);
      const document = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(document.querySelector("parsererror"), src).toBeNull();
      expect(document.documentElement.localName).toBe("svg");
      expect(
        document.documentElement.getAttribute("viewBox") ||
          document.documentElement.getAttribute("width"),
      ).toBeTruthy();
      expect(
        document.querySelector(
          "script, foreignObject, iframe, image, audio, video, animate, set",
        ),
        src,
      ).toBeNull();
      for (const element of document.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
          expect(attribute.name, src).not.toMatch(/^on/i);
          if (attribute.localName === "href")
            expect(attribute.value, src).toMatch(/^#[\w.-]+$/);
          for (const match of attribute.value.matchAll(
            /url\(\s*["']?([^\s)"']+)/gi,
          )) {
            expect(match[1], src).toMatch(/^#[\w.-]+$/);
          }
        }
      }
      for (const style of document.querySelectorAll("style")) {
        expect(style.textContent, src).not.toMatch(
          /@import|https?:|\/\/|expression\s*\(/i,
        );
        for (const match of (style.textContent || "").matchAll(
          /url\(\s*["']?([^\s)"']+)/gi,
        )) {
          expect(match[1], src).toMatch(/^#[\w.-]+$/);
        }
      }
    }
  });
});
