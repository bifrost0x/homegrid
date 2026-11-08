import { expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { SettingsPanel } from "./Settings";
import { defaults } from "./lib";
afterEach(() => vi.unstubAllGlobals());

it("places settings actions outside the scrolling form and names unsaved closing explicitly", async () => {
  const close = vi.fn();
  render(
    <SettingsPanel
      settings={defaults}
      onSave={async () => {}}
      onClose={close}
    />,
  );
  expect(
    screen.getByRole("group", { name: "Settings actions" }),
  ).toContainElement(screen.getByRole("button", { name: "Save appearance" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Forest preset" }),
  );
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Discard and close" }),
  );
  expect(close).toHaveBeenCalledOnce();
});

it("validates a title even when saving from the layout tab", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  await userEvent.clear(screen.getByLabelText("Dashboard title"));
  await userEvent.click(screen.getByRole("tab", { name: "Layout" }));
  await userEvent.click(screen.getByRole("button", { name: "Save layout" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter a dashboard title",
  );
  expect(save).not.toHaveBeenCalled();
});

it("does not offer first-run actions when application loading fails", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/apps")
        return new Response(
          JSON.stringify({
            error: {
              code: "unavailable",
              message: "Services unavailable. Try again.",
            },
          }),
          { status: 503 },
        );
      return new Response(
        JSON.stringify(
          path === "/api/auth/session"
            ? {
                authenticated: true,
                setup_required: false,
                username: "owner",
                csrf_token: "token",
              }
            : path === "/api/settings"
              ? defaults
              : [],
        ),
      );
    }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
  await screen.findByText("Services unavailable. Try again.");
  expect(
    screen.queryByRole("region", { name: "Welcome to HomeGrid" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Load example applications" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Retry loading" })).toBeVisible();
});
