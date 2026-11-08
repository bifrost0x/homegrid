/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  findIcons,
  findTemplates,
  serviceCategories,
  serviceTemplates,
} from "./catalog";
import { serviceIcons, serviceIconUrl } from "./serviceIcons";
import { serviceCatalog } from "./serviceCatalog";
import { serviceKey } from "./serviceDetection";
import manifest from "./service-catalog.json";

const assets = import.meta.glob<string>("../public/service-icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});
const asset = (id: string) => assets[`../public/service-icons/${id}.svg`];
const MAX_SVG_BYTES = 60 * 1024;
const RASTER_DATA_URI =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

// Ids stored by earlier releases as "service:<id>"; they must never change.
const RELEASED_IDS = [
  "jellyfin",
  "plex",
  "emby",
  "sonarr",
  "radarr",
  "lidarr",
  "audiobookshelf",
  "navidrome",
  "immich",
  "photoprism",
  "nextcloud",
  "syncthing",
  "paperlessngx",
  "vaultwarden",
  "homeassistant",
  "adguardhome",
  "pihole",
  "uptimekuma",
  "grafana",
  "prometheus",
  "portainer",
  "dockge",
  "proxmox",
  "truenas",
  "gitea",
  "forgejo",
  "gitlab",
  "mealie",
  "freshrss",
  "miniflux",
  "qbittorrent",
  "transmission",
  "sabnzbd",
  "kavita",
  "calibreweb",
  "linkwarden",
  "nginxproxymanager",
  "traefik",
  "authentik",
  "authelia",
];

describe("offline service catalog", () => {
  it("provides one distinct named service logo with a local SVG per catalog entry", () => {
    const count = serviceCatalog.length;
    expect(count).toBeGreaterThanOrEqual(300);
    expect(serviceTemplates).toHaveLength(count);
    expect(Object.keys(serviceIcons)).toEqual(
      serviceCatalog.map((service) => service.id),
    );
    expect(
      new Set(serviceTemplates.map((template) => template.icon)).size,
    ).toBe(count);
    expect(
      new Set(serviceTemplates.map((template) => template.name)).size,
    ).toBe(count);
    expect(Object.keys(assets)).toHaveLength(count);
    for (const template of serviceTemplates) {
      expect(serviceIconUrl(template.icon)).toMatch(
        /^\/service-icons\/[a-z0-9]+\.svg$/,
      );
      const id = template.icon.slice("service:".length);
      expect(serviceIcons[id].name).toBe(template.name);
      expect(asset(id), id).toContain("<svg");
      expect(serviceCategories).toContain(template.category);
      expect(findTemplates(template.name)).toContain(template);
    }
  });

  it("keeps every previously released service id and its catalog position", () => {
    expect(
      serviceCatalog.slice(0, RELEASED_IDS.length).map((s) => s.id),
    ).toEqual(RELEASED_IDS);
    for (const id of RELEASED_IDS)
      expect(serviceIconUrl("service:" + id)).toBe(`/service-icons/${id}.svg`);
  });

  it("keeps the manifest consistent and every detection key unambiguous", () => {
    expect(manifest.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
    const keys = new Map<string, string>();
    const ports = new Map<number, string>();
    for (const service of serviceCatalog) {
      expect(service.id).toMatch(/^[a-z0-9]+$/);
      expect(["sage", "blue", "amber", "rose", "violet", "cyan"]).toContain(
        service.color,
      );
      expect(!!service.upstream !== !!service.vendored, service.id).toBe(true);
      expect(serviceIcons[service.id].aliases ?? []).toEqual(
        service.aliases ?? [],
      );
      for (const alias of service.aliases ?? [])
        expect(alias, service.id).toBe(serviceKey(alias));
      for (const key of new Set([
        service.id,
        serviceKey(service.name),
        ...(service.aliases ?? []),
      ])) {
        expect(keys.get(key) ?? service.id, key).toBe(service.id);
        keys.set(key, service.id);
      }
      for (const port of service.ports ?? []) {
        expect(ports.has(port), `port ${port}`).toBe(false);
        ports.set(port, service.id);
      }
    }
  });

  it("retains the generic icon picker and supports category and alias searches", () => {
    expect(findIcons("")).toHaveLength(44);
    expect(findIcons("camera").length).toBeGreaterThan(0);
    expect(
      findTemplates("Development")
        .slice(0, 3)
        .map((template) => template.name),
    ).toEqual(["Gitea", "Forgejo", "GitLab"]);
    expect(findTemplates("media jellyfin")[0].name).toBe("Jellyfin");
    expect(findTemplates("pve")[0].name).toBe("Proxmox");
    expect(findTemplates("open webui")[0].name).toBe("Open WebUI");
    expect(findTemplates("ollama")[0].name).toBe("Ollama");
    expect(findTemplates("opnsense")[0].name).toBe("OPNsense");
    expect(findTemplates("fritz")[0].name).toBe("FRITZ!Box");
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

  it("ships static standalone artwork without executable content or external requests", () => {
    for (const { src } of Object.values(serviceIcons)) {
      const svg = assets[`../public${src}`];
      expect(new TextEncoder().encode(svg).length, src).toBeLessThanOrEqual(
        MAX_SVG_BYTES,
      );
      expect(svg, src).not.toMatch(
        /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<script\b|javascript:|<foreignObject\b|<(iframe|embed|object)\b/i,
      );
      expect(svg, src).not.toMatch(
        /(?:-webkit-)?image-set\s*\(|cross-fade\s*\(/i,
      );
      const document = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(document.querySelector("parsererror"), src).toBeNull();
      expect(document.documentElement.localName).toBe("svg");
      expect(
        document.documentElement.getAttribute("viewBox") ||
          document.documentElement.getAttribute("width"),
      ).toBeTruthy();
      expect(
        document.querySelector(
          "script, foreignObject, iframe, embed, object, audio, video, animate, animateTransform, animateMotion, set",
        ),
        src,
      ).toBeNull();
      for (const element of document.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
          expect(attribute.name, src).not.toMatch(/^on/i);
          if (attribute.localName === "href") {
            // A base64 bitmap inside <image> is inert in an <img>-loaded SVG;
            // every other reference must stay inside the document.
            if (element.localName === "image")
              expect(attribute.value.replace(/\s/g, ""), src).toMatch(
                RASTER_DATA_URI,
              );
            else expect(attribute.value, src).toMatch(/^#[\w.-]+$/);
          }
          if (attribute.localName === "style")
            expect(attribute.value, src).not.toMatch(/https?:|\/\//i);
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
