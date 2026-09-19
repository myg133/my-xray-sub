import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { filterPreferred } from "../scraper/filter.ts";
import type { CfEntry } from "../types.ts";

const mk = (value: string, avgScore: number, avgPkgLost = 1): CfEntry => ({
  value,
  type: "ip",
  avgScore,
  avgLatency: 100,
  avgPkgLost,
});

Deno.test("filterPreferred: drops entries above score threshold", () => {
  const input = [mk("1.1.1.1", 100), mk("2.2.2.2", 800)];
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.map((e) => e.value), ["1.1.1.1"]);
});

Deno.test("filterPreferred: drops entries above packet-loss threshold", () => {
  const input = [mk("1.1.1.1", 100, 1), mk("2.2.2.2", 100, 50)];
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.map((e) => e.value), ["1.1.1.1"]);
});

Deno.test("filterPreferred: drops blacklisted", () => {
  const input = [mk("1.1.1.1", 100), mk("2.2.2.2", 100)];
  const out = filterPreferred(input, ["2.2.2.2"], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.map((e) => e.value), ["1.1.1.1"]);
});

Deno.test("filterPreferred: dedupes by value, keeping best score", () => {
  const input = [mk("1.1.1.1", 200), mk("1.1.1.1", 150), mk("2.2.2.2", 100)];
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.length, 2);
  const one = out.find((e) => e.value === "1.1.1.1")!;
  assertEquals(one.avgScore, 150);
});

Deno.test("filterPreferred: respects cap", () => {
  const input = Array.from({ length: 30 }, (_, i) => mk(`1.1.1.${i}`, 100));
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 5 });
  assertEquals(out.length, 5);
});

Deno.test("filterPreferred: shuffle produces varying order", () => {
  const input = Array.from({ length: 50 }, (_, i) => mk(`1.1.1.${i}`, 100));
  const out1 = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 50 });
  const out2 = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 50 });
  const sameOrder = out1.every((e, i) => e.value === out2[i].value);
  assertEquals(sameOrder, false, "expected different shuffle orders");
});
