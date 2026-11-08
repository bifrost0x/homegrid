import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_KEYS,
  GENERIC_LABELS,
  detectService,
} from "./serviceDetection";
import { serviceCatalog } from "./serviceCatalog";

const detected = (name: string, url = "") => detectService(name, url)?.id;
const signal = (name: string, url = "") => detectService(name, url)?.signal;

describe("detectService", () => {
  it("recognizes exact names, display names and curated aliases", () => {
    expect(detectService("Jellyfin", "")).toEqual({
      id: "jellyfin",
      name: "Jellyfin",
      icon: "service:jellyfin",
      signal: "name",
    });
    expect(detected("home assistant")).toBe("homeassistant");
    expect(detected("HomeAssistant")).toBe("homeassistant");
    expect(detected("Pi-hole")).toBe("pihole");
    expect(detected("Paperless-ngx")).toBe("paperlessngx");
    expect(detected("Paperless")).toBe("paperlessngx");
    expect(detected("HA")).toBe("homeassistant");
    expect(detected("PVE")).toBe("proxmox");
    expect(detected("Open WebUI")).toBe("openwebui");
    expect(detected("FRITZ!Box")).toBe("fritzbox");
    expect(detected("Baïkal")).toBe("baikal");
    expect(detected("Proxmox 2")).toBe("proxmox");
  });

  it("finds a service inside a longer name and prefers the most specific match", () => {
    expect(detected("My Jellyfin")).toBe("jellyfin");
    expect(detected("Living room Plex")).toBe("plex");
    expect(detected("My Nginx Proxy Manager")).toBe("nginxproxymanager");
    expect(detected("nginx")).toBe("nginx");
    expect(detected("Sonarr and Radarr")).toBe("sonarr");
    // Short aliases only count as a complete name, not as a word.
    expect(detected("HA Proxy")).toBe("haproxy");
    expect(detected("Ha ha")).toBeUndefined();
    expect(detected("JF media")).toBeUndefined();
  });

  it("recognizes hostname labels, including short aliases and numbered hosts", () => {
    expect(detected("", "https://jellyfin.home.lan")).toBe("jellyfin");
    expect(signal("", "https://jellyfin.home.lan")).toBe("host");
    expect(detected("", "https://jf.example")).toBe("jellyfin");
    expect(detected("", "https://pve.lan:8006")).toBe("proxmox");
    expect(detected("", "http://ha.local:8123")).toBe("homeassistant");
    expect(detected("", "http://fritz.box")).toBe("fritzbox");
    expect(detected("", "https://pve-01.lan")).toBe("proxmox");
    expect(detected("", "https://home-assistant.lan")).toBe("homeassistant");
    expect(detected("", "https://app.plex.tv")).toBe("plex");
    expect(detected("", "http://sonarr:8989")).toBe("sonarr");
    expect(detected("", "jellyfin.lan")).toBe("jellyfin");
    expect(detected("", "https://www.home.lan/")).toBeUndefined();
  });

  it("uses a distinctive path segment when the host is generic", () => {
    expect(detected("", "https://home.lan/jellyfin/web")).toBe("jellyfin");
    expect(signal("", "https://home.lan/jellyfin/web")).toBe("path");
    expect(detected("", "https://home.lan/admin")).toBeUndefined();
    expect(detected("", "https://home.lan/ha")).toBeUndefined();
  });

  it("falls back to distinctive default ports only", () => {
    expect(detectService("", "http://192.168.1.10:8096")).toMatchObject({
      id: "jellyfin",
      signal: "port",
    });
    expect(detected("", "http://10.0.0.2:32400/web")).toBe("plex");
    expect(detected("", "http://192.168.1.20:8123")).toBe("homeassistant");
    expect(detected("", "https://192.168.1.20:9443")).toBe("portainer");
    // Shared or generic ports are deliberately not mapped.
    for (const port of [80, 443, 3000, 5000, 8000, 8080, 8443, 9000, 9090])
      expect(detected("", `http://192.168.1.10:${port}`), `${port}`).toBe(
        undefined,
      );
  });

  it("never lets a port override a name or hostname", () => {
    expect(detected("Emby", "http://192.168.1.10:8096")).toBe("emby");
    expect(signal("Emby", "http://192.168.1.10:8096")).toBe("name");
    expect(detected("", "http://emby.lan:8096")).toBe("emby");
    expect(detected("Grafana", "http://jellyfin.lan")).toBe("grafana");
  });

  it("does not guess for generic names, hosts, addresses or unsupported URLs", () => {
    for (const [name, url] of [
      ["", ""],
      ["", "https://192.168.1.10:8080"],
      ["", "https://home.lan"],
      ["", "https://media.home"],
      ["", "https://photos.example.com"],
      ["", "https://localhost"],
      ["", "http://[::1]:8080"],
      ["", "ftp://jellyfin.lan"],
      ["", "javascript:alert(1)"],
      ["", "not a url"],
      ["Home", ""],
      ["My server", ""],
      ["Media", ""],
      ["Cinema", "https://media.home"],
      ["Vault", "https://vault.example.com"],
    ])
      expect(detectService(name, url), `${name} ${url}`).toBeUndefined();
    expect(detected("HashiCorp Vault")).toBe("vault");
    expect(detected("Vaultwarden", "https://vault.example.com")).toBe(
      "vaultwarden",
    );
  });

  it("is deterministic and only ever returns catalog services", () => {
    const ids = new Set(serviceCatalog.map((service) => service.id));
    for (const service of serviceCatalog) {
      const result = detectService(service.name, "");
      if (AMBIGUOUS_KEYS.has(service.id) && result?.id !== service.id) continue;
      expect(result?.id, service.name).toBe(service.id);
      expect(ids.has(result!.id)).toBe(true);
      expect(detectService(service.name, "")).toEqual(result);
    }
    for (const label of GENERIC_LABELS)
      expect(detectService(label, `https://${label}.lan`)).toBeUndefined();
  });
});

describe("hostile input", () => {
  it("stays fast on long digit runs and ignores oversized values", () => {
    const digits = "1".repeat(80_000) + "a";
    const started = performance.now();
    expect(detectService(digits, "https://" + digits + ".lan")).toBeUndefined();
    expect(detectService("Jellyfin" + "1".repeat(200), "")).toBeUndefined();
    expect(detectService("jellyfin" + "1".repeat(80), "")).toMatchObject({
      id: "jellyfin",
    });
    expect(performance.now() - started).toBeLessThan(200);
  });
});
