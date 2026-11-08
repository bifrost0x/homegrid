import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_KEYS,
  COMMON_WORDS,
  GENERIC_LABELS,
  detectService,
} from "./serviceDetection";
import { serviceCatalog } from "./serviceCatalog";
import { serviceIcons } from "./serviceIndex";

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
      ["", "https://vault.example.com"],
      ["My vault", ""],
      ["Outline notes", "https://outline.home.example"],
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
      expect(result?.id, service.name).toBe(service.id);
      expect(ids.has(result!.id)).toBe(true);
      expect(detectService(service.name, "")).toEqual(result);
    }
    for (const label of GENERIC_LABELS)
      expect(detectService(label, `https://${label}.lan`)).toBeUndefined();
  });
});

describe("ambiguous names", () => {
  it("match only as the entire application name", () => {
    for (const key of AMBIGUOUS_KEYS) {
      expect(detected(key), key).toBe(key === "vault" ? undefined : key);
      expect(detected("", `https://${key}.home.example`), key).toBeUndefined();
      expect(detected(`My ${key}`), key).toBeUndefined();
    }
    expect(detectService("Outline", "https://outline.home.example")).toEqual({
      id: "outline",
      name: "Outline",
      icon: "service:outline",
      signal: "name",
    });
    // A bare "Vault" is usually Vaultwarden, so it stays unrecognized.
    expect(detected("Vault")).toBeUndefined();
    expect(detected("Outline 2")).toBe("outline");
  });
});

describe("extended logos", () => {
  it("resolves names from this dashboard", () => {
    expect(detected("Unifi Gateway")).toBe("unifi");
    expect(detected("UniFi")).toBe("unifi");
    expect(detected("UGreen NAS")).toBe("ugreen");
    expect(detected("UGOS")).toBe("ugreen");
    expect(detected("Proxmox Backup")).toBe("proxmoxbackupserver");
    expect(detected("Outline")).toBe("outline");
    expect(detected("WebSSH")).toBe("webssh");
    expect(detected("Web SSH")).toBe("webssh");
    expect(detected("IT-Tools")).toBe("itools");
    expect(detected("Cyberchef")).toBe("cyberchef");
    expect(detected("Stirling PDF")).toBe("stirlingpdf");
    expect(detected("Technitium")).toBe("technitium");
    expect(detected("Technitium DNS")).toBe("technitium");
    expect(detected("", "https://ugreen.home.lan")).toBe("ugreen");
  });

  it("recognizes extended names, aliases and hostname labels", () => {
    expect(detectService("Sshwifty", "")).toEqual({
      id: "sshwifty",
      name: "Sshwifty",
      icon: "service:sshwifty",
      signal: "name",
    });
    expect(detected("", "https://sshwifty.home.lan")).toBe("sshwifty");
    expect(detected("Ubiquiti UniFi")).toBe("ubiquiti-unifi");
    expect(detected("Unifi Voucher Site")).toBe("unifi-voucher-site");
    expect(detected("Paywall remover")).toBe("13ft");
  });

  it("lets curated services win shared keys and keeps ports curated", () => {
    // Upstream has a separate "kibana" logo; the curated entry keeps the id.
    expect(detected("Kibana")).toBe("kibana");
    expect(detected("TrueNAS")).toBe("truenas");
    // "truenasscale" is a curated alias, so the extended logo does not take it.
    expect(detected("My TrueNAS Scale")).toBe("truenas");
    const curated = new Set(serviceCatalog.map((service) => service.id));
    for (const port of [80, 443, 3000, 8080])
      expect(detected("", `http://10.0.0.1:${port}`)).toBeUndefined();
    expect(curated.has(detected("", "http://10.0.0.1:8096")!)).toBe(true);
  });

  it("ignores ordinary words that happen to be extended product names", () => {
    for (const word of COMMON_WORDS) {
      const result = detectService(word, `https://${word}.home.lan`);
      if (result)
        expect(
          serviceIcons.find((icon) => icon.id === result.id)?.curated,
          word,
        ).toBe(true);
    }
    for (const [name, url] of [
      ["Files", "https://files.home.lan"],
      ["Router", "http://router.lan"],
      ["Media", "https://media.home"],
      ["Photos", "https://photos.example.com"],
      ["Backup", ""],
      ["Wiki", "https://wiki.lan"],
      ["Status", "https://status.lan"],
    ])
      expect(detectService(name, url), name).toBeUndefined();
  });
});

describe("performance", () => {
  it("stays well below 50 ms per call with the full catalog", () => {
    expect(serviceIcons.length).toBeGreaterThan(2000);
    const long = Array.from({ length: 30 }, (_, i) => "label" + i).join(".");
    const inputs: [string, string][] = [
      ["Unifi Gateway", "https://unifi.home.lan"],
      ["", "https://" + long + ".lan/" + "x".repeat(900)],
      ["word ".repeat(20).trim(), "https://a-b-c-d-e-f-g-h-i-j-k-l.lan"],
      ["", "https://" + "a-".repeat(500) + "b.lan"],
      ["Nothing to see here", "http://10.0.0.1:12345"],
    ];
    let slowest = 0;
    for (let round = 0; round < 20; round++)
      for (const [name, url] of inputs) {
        const started = performance.now();
        detectService(name, url);
        slowest = Math.max(slowest, performance.now() - started);
      }
    expect(slowest).toBeLessThan(50);
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
