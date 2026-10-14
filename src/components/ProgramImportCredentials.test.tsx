// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProgramImportCredentials } from "./ProgramImportCredentials";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows a newly created secret once and can revoke without listing secrets", async () => {
  const token = { id: "credential-1", name: "My tool", createdAt: "2026-10-13", expiresAt: "2026-11-13", revokedAt: null, lastUsedAt: null };
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ tokens: [] }))).mockResolvedValueOnce(new Response(JSON.stringify({ token, secret: "test-secret-only-once" }))).mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ProgramImportCredentials />);
  await waitFor(() => expect(screen.queryByText("Loading credentials…")).toBeNull());
  fireEvent.change(screen.getByLabelText("Credential name"), { target: { value: "My tool" } });
  fireEvent.click(screen.getByRole("button", { name: "Create credential" }));
  expect(await screen.findByLabelText("New credential secret")).toHaveValue("test-secret-only-once");
  fireEvent.click(screen.getByRole("button", { name: "Revoke My tool" }));
  await waitFor(() => expect(screen.queryByLabelText("New credential secret")).toBeNull());
  expect(fetchMock).toHaveBeenLastCalledWith("/api/program-import-tokens/credential-1", { method: "DELETE" });
});
