import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("iOS PWA assets", () => {
  it("defines a standalone manifest with required icon assets", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "manifest.json"), "utf8")) as {
      display: string;
      icons: { src: string; sizes: string }[];
    };

    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icon-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icon-512.png", sizes: "512x512" }),
      ]),
    );
    expect(fs.existsSync(path.join(root, "public", "apple-touch-icon.png"))).toBe(true);
  });

  it("keeps authenticated API requests out of the service worker cache", () => {
    const serviceWorker = fs.readFileSync(path.join(root, "public", "sw.js"), "utf8");
    const staticAssetsLine = serviceWorker
      .split("\n")
      .find((line) => line.startsWith("const STATIC_ASSETS")) as string;

    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(staticAssetsLine).not.toContain('"/api/');
    expect(staticAssetsLine).not.toContain('"/"');
  });
});
