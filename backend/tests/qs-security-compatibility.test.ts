import { readFile } from "node:fs/promises";
import express from "express";
import qs from "qs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createOriginPolicy } from "../src/security/origin-policy.js";

const FRONTEND_ORIGIN = "https://nexuschat.example";

const createParserTestApp = () => {
  const router = express.Router();
  router.get("/query", (req, res) => res.status(200).json(req.query));
  router.post("/form", (req, res) => res.status(200).json(req.body));

  return createApp({
    originPolicy: createOriginPolicy({
      environment: "test",
      frontendOrigin: FRONTEND_ORIGIN,
    }),
    environment: "test",
    routes: [{ path: "/compat", router }],
  });
};

describe("qs security override", () => {
  it("pins the transitive qs replacement at the package root", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      overrides?: Record<string, string>;
    };

    expect(packageJson.overrides).toEqual({ qs: "6.16.0" });
    expect(packageJson.dependencies).not.toHaveProperty("qs");
  });

  it("enforces arrayLimit for bracket-key comma parsing", () => {
    expect(() => qs.parse("a[]=1,2,3,4", {
      arrayLimit: 3,
      comma: true,
      throwOnLimitExceeded: true,
    })).toThrowError(RangeError);
  });

  it("safely stringifies the hostile parse shape from GHSA-4mjr-xmp4-gh2g", () => {
    const parsed = qs.parse("x%5Bconstructor%5D%5BisBuffer%5D=y", {
      plainObjects: true,
    });

    expect(() => qs.stringify(parsed)).not.toThrow();
    expect(qs.stringify(parsed)).toBe("x%5Bconstructor%5D%5BisBuffer%5D=y");
  });
});

describe("Express query compatibility with the qs override", () => {
  it.each([
    ["simple values", "?foo=bar", { foo: "bar" }],
    ["repeated keys", "?foo=a&foo=b", { foo: ["a", "b"] }],
    ["nested values", "?filter[name]=alice", { filter: { name: "alice" } }],
    ["bracket arrays", "?items[]=a&items[]=b", { items: ["a", "b"] }],
    ["numeric bracket indexes", "?items[0]=a&items[2]=c", { items: ["a", "c"] }],
  ])("preserves %s", async (_label, query, expected) => {
    const response = await request(createParserTestApp()).get(`/compat/query${query}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
  });

  it("retains prototype-like keys without polluting Object.prototype", async () => {
    const response = await request(createParserTestApp()).get(
      "/compat/query?constructor[value]=ctor&prototype=value&__proto__[qsSecurityPolluted]=yes",
    );

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["constructor", "prototype"]);
    expect(response.body.constructor).toEqual({ value: "ctor" });
    expect(response.body.prototype).toBe("value");
    expect(Object.prototype).not.toHaveProperty("qsSecurityPolluted");
  });
});

describe("extended urlencoded compatibility with the qs override", () => {
  it("preserves simple, nested, array, and repeated form values", async () => {
    const response = await request(createParserTestApp())
      .post("/compat/form")
      .type("form")
      .send("name=alice&profile[role]=admin&items[]=a&items[]=b&tag=x&tag=y");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      name: "alice",
      profile: { role: "admin" },
      items: ["a", "b"],
      tag: ["x", "y"],
    });
  });

  it("preserves deterministic malformed-bracket parsing", async () => {
    const response = await request(createParserTestApp())
      .post("/compat/form")
      .type("form")
      .send("broken[=value");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ broken: { "[": "value" } });
  });

  it("retains the configured 10 MB limit beyond the parser default", async () => {
    const value = "x".repeat(150 * 1_024);
    const response = await request(createParserTestApp())
      .post("/compat/form")
      .type("form")
      .send(`content=${value}`);

    expect(response.status).toBe(200);
    expect(response.body.content).toHaveLength(value.length);
  });

  it("retains rejection at the default 1,000-parameter boundary", async () => {
    const body = Array.from({ length: 1_001 }, (_, index) => `p${index}=x`).join("&");
    const response = await request(createParserTestApp())
      .post("/compat/form")
      .type("form")
      .send(body);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, message: "Internal server error" });
  });

  it("rejects a hostile origin before parsing an over-limit form body", async () => {
    const body = Array.from({ length: 1_001 }, (_, index) => `p${index}=x`).join("&");
    const response = await request(createParserTestApp())
      .post("/compat/form")
      .set("Origin", "https://attacker.example")
      .type("form")
      .send(body);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, message: "Origin not allowed" });
  });

  it("preserves CORS headers for an allowed-origin form request", async () => {
    const response = await request(createParserTestApp())
      .post("/compat/form")
      .set("Origin", FRONTEND_ORIGIN)
      .type("form")
      .send("name=alice");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(FRONTEND_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.body).toEqual({ name: "alice" });
  });
});
