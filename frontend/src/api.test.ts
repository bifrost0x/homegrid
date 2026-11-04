import { afterEach, it, expect, vi } from "vitest";
import { api, setSession } from "./lib";
afterEach(() => vi.unstubAllGlobals());
it("reports an origin rejection without refreshing or replaying the request", async () => {
  const message =
    "This address is not allowed. Check HomeGrid's reverse proxy configuration.";
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code: "origin", message } }), {
        status: 403,
      }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(api("/auth/login", "POST", {})).rejects.toThrow(message);
  expect(fetch).toHaveBeenCalledOnce();
});
it("describes a stale login session as a sign-in retry", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "csrf", message: "Invalid token" } }),
        { status: 403 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: false,
          setup_required: false,
          username: "",
          csrf_token: "new-token",
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(api("/auth/login", "POST", {})).rejects.toThrow(
    "Please try signing in again.",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("sends the session CSRF token and same-origin credentials", async () => {
  const fetch = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  setSession({
    authenticated: true,
    setup_required: false,
    username: "owner",
    csrf_token: "token",
  });
  await api("/apps", "POST", { name: "Media" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/apps",
    expect.objectContaining({
      credentials: "same-origin",
      headers: expect.objectContaining({ "X-CSRF-Token": "token" }),
    }),
  );
});
it("notifies the app when authentication expires", async () => {
  const listener = vi.fn();
  window.addEventListener("homegrid:unauthorized", listener);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "unauthorized", message: "Sign in again." },
          }),
          { status: 401 },
        ),
    ),
  );
  await expect(api("/apps")).rejects.toThrow("Sign in again.");
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener("homegrid:unauthorized", listener);
});
it("refreshes stale CSRF state without replaying the mutation", async () => {
  const listener = vi.fn();
  window.addEventListener("homegrid:session-refreshed", listener);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "csrf", message: "Invalid token" } }),
        { status: 403 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          setup_required: false,
          username: "owner",
          csrf_token: "new-token",
        }),
      ),
    )
    .mockResolvedValueOnce(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await expect(api("/apps", "POST", {})).rejects.toThrow(
    "Your session changed",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(listener).toHaveBeenCalledOnce();
  await api("/apps", "POST", {});
  expect(fetch.mock.calls[2][1].headers["X-CSRF-Token"]).toBe("new-token");
  window.removeEventListener("homegrid:session-refreshed", listener);
});
