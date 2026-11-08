import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { api, setSession, type Session } from "./lib";
import { on } from "./events";
import { ErrorMessage } from "./components";
import { AuthScreen } from "./AuthScreen";
import { Dashboard } from "./dashboard/Dashboard";
import { clearDashboardData } from "./dashboard/useDashboardData";

/** Session gate: shows setup/sign-in until authenticated, then the dashboard. */
export function App() {
  const client = useQueryClient();
  useEffect(() => {
    const unsubscribe = [
      on(
        "homegrid:unauthorized",
        () => void client.invalidateQueries({ queryKey: ["session"] }),
      ),
      on("homegrid:session-refreshed", (session) =>
        client.setQueryData(["session"], session),
      ),
    ];
    return () => unsubscribe.forEach((off) => off());
  }, [client]);
  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/auth/session"),
  });
  useEffect(() => {
    if (!query.data) return;
    setSession(query.data);
    if (!query.data.authenticated) clearDashboardData(client);
  }, [query.data, client]);
  if (query.isPending)
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" />
        Opening HomeGrid…
      </div>
    );
  if (query.error)
    return (
      <div className="loading-screen">
        <ErrorMessage error={query.error} />
        <button className="button secondary" onClick={() => query.refetch()}>
          Try again
        </button>
      </div>
    );
  return query.data.authenticated ? (
    <Dashboard session={query.data} />
  ) : (
    <AuthScreen setup={query.data.setup_required} />
  );
}
