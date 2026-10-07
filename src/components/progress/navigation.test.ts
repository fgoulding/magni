import { describe, expect, it } from "vitest";
import { decodeProgressKey, pageLinks, progressReturnTo, progressUrl } from "./navigation";

describe("Progress navigation", () => {
  it("replaces pages while retaining the search and filter scope on next and previous", () => {
    const start = "/history/exercises?q=old+bench&program=3";
    const second = pageLinks(start, "cursor-one").next!;
    expect(new URL(second, "https://magni.test").searchParams.get("q")).toBe("old bench");
    const third = pageLinks(second, "cursor-two", "");
    expect(third.previous).toBe(start);
    expect(pageLinks(third.next!, null, "cursor-one").previous).toBe(second);
  });
  it("accepts only Progress and History return paths", () => {
    expect(progressReturnTo("/history/exercises?q=bench&cursor=abc")).toBe("/history/exercises?q=bench&cursor=abc");
    for (const value of ["//evil.test", "/history-other", "https://evil.test", "/history\\evil", "/settings"]) {
      expect(progressReturnTo(value)).toBe("/history");
    }
  });
  it("preserves literal recorded names without treating a plus or slash as a route", () => {
    expect(new URL(progressUrl("/history/exercises", { q: "Row + curl / band" }), "https://magni.test").searchParams.get("q")).toBe("Row + curl / band");
  });
  it("decodes the encoded dynamic parameters returned by the installed Next runtime exactly once", () => {
    expect(decodeProgressKey("e%3A5d92572c-c020-4ba7-ada6-21b34174fe02")).toBe("e:5d92572c-c020-4ba7-ada6-21b34174fe02");
    expect(decodeProgressKey("u%3AYmFuZCByb3c")).toBe("u:YmFuZCByb3c");
    expect(decodeProgressKey("e:abc")).toBe("e:abc");
    expect(decodeProgressKey("e%253Aabc")).toBeNull();
    expect(decodeProgressKey("%broken")).toBeNull();
    expect(decodeProgressKey("e%3A..%2Fother")).toBeNull();
  });

  it("keeps the 50th browse page and its return context bounded without a growing cursor trail", () => {
    let current = "/history/exercises?browse=az&q=old+exercise";
    for (let page = 1; page <= 50; page++) current = pageLinks(current, `cursor-${page}`, `cursor-${page - 1}`).next!;
    expect(current.length).toBeLessThan(100);
    expect(current).not.toContain("trail=");
    expect(progressReturnTo(current)).toBe(current);
    expect(pageLinks(current, null, "cursor-49").previous).toBe("/history/exercises?browse=az&q=old+exercise&cursor=cursor-49");
  });

});
