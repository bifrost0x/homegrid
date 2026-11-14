import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  defaults,
  type Application,
  type Category,
  type ServiceStatus,
  type Settings,
  type UndoRecord,
} from "../lib";

const dashboardKeys = [
  "apps",
  "categories",
  "settings",
  "undo",
  "status",
] as const;

/** Loads everything the dashboard renders and exposes a combined refresh. */
export function useDashboardData() {
  const client = useQueryClient();
  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<Application[]>("/apps"),
  });
  const catsQ = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/categories"),
  });
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const undoQ = useQuery({
    queryKey: ["undo"],
    queryFn: () => api<UndoRecord[]>("/undo"),
    refetchInterval: 30000,
  });
  // The server only contacts services while status checks are enabled.
  const statusQ = useQuery({
    queryKey: ["status"],
    queryFn: () => api<ServiceStatus>("/status"),
    enabled: settingsQ.data?.status_checks === true,
    refetchInterval: 60000,
  });
  const apps = [...(appsQ.data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const categories = [...(catsQ.data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const refresh = async () => {
    await Promise.all(
      dashboardKeys.map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
  };
  return {
    apps,
    categories,
    settings: settingsQ.data ?? defaults,
    statuses:
      settingsQ.data?.status_checks && statusQ.data?.enabled
        ? statusQ.data.statuses
        : undefined,
    latestUndo: Array.isArray(undoQ.data) ? undoQ.data[0] : undefined,
    loading: appsQ.isPending || catsQ.isPending || settingsQ.isPending,
    error: appsQ.error ?? catsQ.error ?? settingsQ.error,
    refresh,
    refreshUndo: () => client.invalidateQueries({ queryKey: ["undo"] }),
  };
}

/** Removes cached dashboard data, e.g. after the session ends. */
export function clearDashboardData(client: ReturnType<typeof useQueryClient>) {
  for (const key of dashboardKeys) client.removeQueries({ queryKey: [key] });
}
