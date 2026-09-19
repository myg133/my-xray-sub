import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import { fetchVps789Domains, fetchVps789Ips } from "../scraper/vps789.ts";

const sampleBody = JSON.stringify({
  code: 0,
  message: "true",
  count: 0,
  data: {
    CT: [
      {
        ip: "104.19.45.241",
        ydLatencyAvg: 180,
        ltLatencyAvg: 248,
        dxLatencyAvg: 174,
        ydPkgLostRateAvg: 4,
        ltPkgLostRateAvg: 0.8,
        dxPkgLostRateAvg: 3.7,
        avgScore: 348,
      },
    ],
    CU: [
      {
        ip: "104.16.88.178",
        ydLatencyAvg: 184,
        ltLatencyAvg: 171,
        dxLatencyAvg: 205,
        ydPkgLostRateAvg: 5,
        ltPkgLostRateAvg: 0.3,
        dxPkgLostRateAvg: 5.6,
        avgScore: 380,
      },
      {
        ip: "104.19.45.241",
        ydLatencyAvg: 100,
        ltLatencyAvg: 100,
        dxLatencyAvg: 100,
        ydPkgLostRateAvg: 1,
        ltPkgLostRateAvg: 1,
        dxPkgLostRateAvg: 1,
        avgScore: 250,
      },
    ],
    CM: [],
  },
});

Deno.test("fetchVps789Ips: parses CT/CU/CM and merges", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sampleBody, { status: 200 }));
  try {
    const entries = await fetchVps789Ips("dummy-token");
    assertEquals(entries.length, 2);
    const ips = entries.map((e) => e.value).sort();
    assertEquals(ips, ["104.16.88.178", "104.19.45.241"]);
    const dup = entries.find((e) => e.value === "104.19.45.241")!;
    assertEquals(dup.avgScore, 250);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: averages carrier latencies/loss", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sampleBody, { status: 200 }));
  try {
    const entries = await fetchVps789Ips("dummy-token");
    const e104 = entries.find((e) => e.value === "104.19.45.241")!;
    assertEquals(e104.avgLatency, 100);
    assertEquals(e104.avgPkgLost, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: throws on non-2xx", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("forbidden", { status: 403 }));
  try {
    await assertRejects(() => fetchVps789Ips("dummy-token"), Error, "403");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: throws on code != 0", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ code: 5, message: "Token失效" }), {
        status: 200,
      }),
    );
  try {
    await assertRejects(() => fetchVps789Ips("dummy-token"), Error, "Token");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: tolerates missing fields", async () => {
  const body = JSON.stringify({
    code: 0,
    data: { CT: [{ ip: "1.2.3.4" }], CU: [], CM: [] },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(body, { status: 200 }));
  try {
    const entries = await fetchVps789Ips("dummy-token");
    assertEquals(entries.length, 1);
    assertEquals(entries[0].value, "1.2.3.4");
    assertEquals(entries[0].avgScore, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: throws on malformed JSON body", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("not json{", { status: 200 }));
  try {
    await assertRejects(() => fetchVps789Ips("dummy-token"), Error);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Domains: parses data.good[] with type=domain", async () => {
  const body = JSON.stringify({
    code: 0,
    message: "true",
    count: 0,
    data: {
      good: [
        {
          id: 106135728,
          ip: "cf.blogluo.eu.org",
          avgLatency: 86,
          avgPkgLostRate: 0.39,
          avgScore: 105,
        },
        {
          id: 106135729,
          ip: "www.oopt.eu.cc",
          avgLatency: 116,
          avgPkgLostRate: 0.81,
          avgScore: 156,
        },
      ],
    },
  });
  const origFetch = globalThis.fetch;
  let capturedHeaders: HeadersInit | undefined;
  globalThis.fetch = (_url, init) => {
    capturedHeaders = init?.headers;
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  try {
    const entries = await fetchVps789Domains("dummy-yf-token");
    assertEquals(entries.length, 2);
    assertEquals(entries.every((e) => e.type === "domain"), true);
    assertEquals(
      entries.map((e) => e.value).sort(),
      ["cf.blogluo.eu.org", "www.oopt.eu.cc"],
    );
    assertEquals(
      (capturedHeaders as Record<string, string>)?.["yf-token"],
      "dummy-yf-token",
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Domains: throws on non-2xx", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("forbidden", { status: 401 }));
  try {
    await assertRejects(() => fetchVps789Domains("dummy-yf-token"), Error, "401");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Domains: throws on code != 0", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ code: 5, message: "Token失效" }), {
        status: 200,
      }),
    );
  try {
    await assertRejects(() => fetchVps789Domains("dummy-yf-token"), Error, "Token");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Domains: tolerates missing fields", async () => {
  const body = JSON.stringify({
    code: 0,
    data: { good: [{ ip: "test.example.com" }] },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(body, { status: 200 }));
  try {
    const entries = await fetchVps789Domains("dummy-yf-token");
    assertEquals(entries.length, 1);
    assertEquals(entries[0].value, "test.example.com");
    assertEquals(entries[0].type, "domain");
    assertEquals(entries[0].avgScore, 0);
    assertEquals(entries[0].avgLatency, 0);
    assertEquals(entries[0].avgPkgLost, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Domains: skips entries with no ip field", async () => {
  const body = JSON.stringify({
    code: 0,
    data: {
      good: [
        { ip: "a.example.com", avgScore: 50 },
        { avgScore: 99 },
        { ip: "", avgScore: 80 },
      ],
    },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(body, { status: 200 }));
  try {
    const entries = await fetchVps789Domains("dummy-yf-token");
    assertEquals(entries.length, 1);
    assertEquals(entries[0].value, "a.example.com");
  } finally {
    globalThis.fetch = origFetch;
  }
});
