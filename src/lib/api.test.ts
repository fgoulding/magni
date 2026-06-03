import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./api";

describe("assertSameOrigin", () => {
  it("allows requests whose origin matches the host header", () => {
    const request = new Request("http://localhost:3001/api/programs", {
      headers: {
        host: "192.168.1.50:3001",
        origin: "http://192.168.1.50:3001",
      },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects real cross-origin requests", () => {
    const request = new Request("http://localhost:3001/api/programs", {
      headers: {
        host: "192.168.1.50:3001",
        origin: "http://evil.example",
      },
    });

    expect(() => assertSameOrigin(request)).toThrow("Forbidden cross-origin request");
  });
});
