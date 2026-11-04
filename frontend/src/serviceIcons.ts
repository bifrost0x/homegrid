export interface ServiceIcon {
  src: string;
  name: string;
}

export const serviceIcons: Readonly<Record<string, ServiceIcon>> =
  Object.freeze({
    jellyfin: { src: "/service-icons/jellyfin.svg", name: "Jellyfin" },
    plex: { src: "/service-icons/plex.svg", name: "Plex" },
    emby: { src: "/service-icons/emby.svg", name: "Emby" },
    sonarr: { src: "/service-icons/sonarr.svg", name: "Sonarr" },
    radarr: { src: "/service-icons/radarr.svg", name: "Radarr" },
    lidarr: { src: "/service-icons/lidarr.svg", name: "Lidarr" },
    audiobookshelf: {
      src: "/service-icons/audiobookshelf.svg",
      name: "Audiobookshelf",
    },
    navidrome: { src: "/service-icons/navidrome.svg", name: "Navidrome" },
    immich: { src: "/service-icons/immich.svg", name: "Immich" },
    photoprism: { src: "/service-icons/photoprism.svg", name: "PhotoPrism" },
    nextcloud: { src: "/service-icons/nextcloud.svg", name: "Nextcloud" },
    syncthing: { src: "/service-icons/syncthing.svg", name: "Syncthing" },
    paperlessngx: {
      src: "/service-icons/paperlessngx.svg",
      name: "Paperless-ngx",
    },
    vaultwarden: { src: "/service-icons/vaultwarden.svg", name: "Vaultwarden" },
    homeassistant: {
      src: "/service-icons/homeassistant.svg",
      name: "Home Assistant",
    },
    adguardhome: {
      src: "/service-icons/adguardhome.svg",
      name: "AdGuard Home",
    },
    pihole: { src: "/service-icons/pihole.svg", name: "Pi-hole" },
    uptimekuma: { src: "/service-icons/uptimekuma.svg", name: "Uptime Kuma" },
    grafana: { src: "/service-icons/grafana.svg", name: "Grafana" },
    prometheus: { src: "/service-icons/prometheus.svg", name: "Prometheus" },
    portainer: { src: "/service-icons/portainer.svg", name: "Portainer" },
    dockge: { src: "/service-icons/dockge.svg", name: "Dockge" },
    proxmox: { src: "/service-icons/proxmox.svg", name: "Proxmox" },
    truenas: { src: "/service-icons/truenas.svg", name: "TrueNAS" },
    gitea: { src: "/service-icons/gitea.svg", name: "Gitea" },
    forgejo: { src: "/service-icons/forgejo.svg", name: "Forgejo" },
    gitlab: { src: "/service-icons/gitlab.svg", name: "GitLab" },
    mealie: { src: "/service-icons/mealie.svg", name: "Mealie" },
    freshrss: { src: "/service-icons/freshrss.svg", name: "FreshRSS" },
    miniflux: { src: "/service-icons/miniflux.svg", name: "Miniflux" },
    qbittorrent: { src: "/service-icons/qbittorrent.svg", name: "qBittorrent" },
    transmission: {
      src: "/service-icons/transmission.svg",
      name: "Transmission",
    },
    sabnzbd: { src: "/service-icons/sabnzbd.svg", name: "SABnzbd" },
    kavita: { src: "/service-icons/kavita.svg", name: "Kavita" },
    calibreweb: { src: "/service-icons/calibreweb.svg", name: "Calibre-Web" },
    linkwarden: { src: "/service-icons/linkwarden.svg", name: "Linkwarden" },
    nginxproxymanager: {
      src: "/service-icons/nginxproxymanager.svg",
      name: "Nginx Proxy Manager",
    },
    traefik: { src: "/service-icons/traefik.svg", name: "Traefik" },
    authentik: { src: "/service-icons/authentik.svg", name: "Authentik" },
    authelia: { src: "/service-icons/authelia.svg", name: "Authelia" },
  });

export function serviceIconUrl(icon: string): string {
  if (!icon.startsWith("service:")) return "";
  const id = icon.slice("service:".length);
  return Object.hasOwn(serviceIcons, id) ? serviceIcons[id].src : "";
}
