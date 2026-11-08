/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  findIcons,
  findTemplates,
  serviceCategories,
  serviceTemplates,
} from "./catalog";
import { serviceIconUrl } from "./serviceIcons";
import { findServiceIcon, serviceIcons } from "./serviceIndex";
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
    // Templates stay curated; extended logos are reachable via the picker.
    expect(serviceTemplates).toHaveLength(count);
    expect(
      serviceIcons.slice(0, count).map((icon) => [icon.id, icon.curated]),
    ).toEqual(serviceCatalog.map((service) => [service.id, true]));
    expect(
      new Set(serviceTemplates.map((template) => template.icon)).size,
    ).toBe(count);
    expect(
      new Set(serviceTemplates.map((template) => template.name)).size,
    ).toBe(count);
    expect(Object.keys(assets)).toHaveLength(serviceIcons.length);
    for (const template of serviceTemplates) {
      expect(serviceIconUrl(template.icon)).toMatch(
        /^\/service-icons\/[a-z0-9]+\.svg$/,
      );
      const id = template.icon.slice("service:".length);
      expect(findServiceIcon(id)?.name).toBe(template.name);
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
      expect(findServiceIcon(service.id)?.aliases).toEqual(
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

  it("adds every other upstream logo as a distinct, categorized extended entry", () => {
    const extended = serviceIcons.filter((icon) => !icon.curated);
    expect(extended.length).toBeGreaterThan(2000);
    const curatedIds = new Set(serviceCatalog.map((service) => service.id));
    const curatedKeys = new Set(
      serviceCatalog.flatMap((service) => [
        service.id,
        serviceKey(service.name),
        ...(service.aliases ?? []),
      ]),
    );
    const ids = new Set<string>();
    const aliases = new Set<string>();
    for (const icon of extended) {
      expect(icon.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      expect(curatedIds.has(icon.id), icon.id).toBe(false);
      expect(ids.has(icon.id), icon.id).toBe(false);
      ids.add(icon.id);
      expect(icon.name.trim(), icon.id).not.toBe("");
      expect(serviceCategories).toContain(icon.category);
      expect(asset(icon.id), icon.id).toContain("<svg");
      for (const alias of icon.aliases) {
        expect(alias, icon.id).toBe(serviceKey(alias));
        expect(curatedKeys.has(alias), alias).toBe(false);
        expect(aliases.has(alias), alias).toBe(false);
        aliases.add(alias);
      }
    }
    expect(findServiceIcon("service:unifi-voucher-site")?.curated).toBe(false);
    expect(findServiceIcon("ubiquiti-unifi")?.name).toBe("Ubiquiti UniFi");
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

  it("resolves only well-formed service identifiers", () => {
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
      "service:__proto__",
      "service:toString",
      "Service:jellyfin",
      "service:Jellyfin",
      "builtin:film",
    ]) {
      expect(serviceIconUrl(icon)).toBe("");
    }
    for (const icon of [
      "service:-jellyfin",
      "service:jelly_fin",
      "service:" + "a".repeat(65),
      " service:jellyfin",
      "service:jellyfin\n",
    ])
      expect(serviceIconUrl(icon), icon).toBe("");
    expect(serviceIconUrl("service:jellyfin")).toBe(
      "/service-icons/jellyfin.svg",
    );
    expect(serviceIconUrl("service:unifi-voucher-site")).toBe(
      "/service-icons/unifi-voucher-site.svg",
    );
    // Only the format is checked here; the server allowlist decides which
    // ids can be stored, and a missing file falls back to a vector icon.
    expect(serviceIconUrl("service:constructor")).toBe(
      "/service-icons/constructor.svg",
    );
  });

  it("ships static standalone artwork without executable content or external requests", () => {
    for (const { id } of serviceIcons) {
      const src = serviceIconUrl("service:" + id);
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
    // Thousands of documents are parsed; jsdom needs more than the default.
  }, 120_000);
});
