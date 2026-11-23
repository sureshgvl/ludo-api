import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signToken, verifyToken } from "../src/auth/jwt";
import { normalizePhone } from "../src/auth/auth.service";

describe("tokens and phone numbers", () => {
  it("round-trips a token", () => {
    const t = signToken({ sub: "u1", name: "Asha" }, "s3cret");
    assert.equal(verifyToken(t, "s3cret")?.sub, "u1");
  });
  it("rejects wrong secret, tampering and expiry", () => {
    const t = signToken({ sub: "u1", name: "A" }, "s3cret", 60, 0);
    assert.equal(verifyToken(t, "other", 1000), null);
    assert.equal(verifyToken(t, "s3cret", 120_000), null);
    const [h, , s] = t.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "admin", name: "x", exp: 9e9 })).toString("base64url")}.${s}`;
    assert.equal(verifyToken(forged, "s3cret", 1000), null);
    assert.equal(verifyToken("garbage", "s3cret"), null);
    assert.equal(verifyToken(t, "", 1000), null);
  });
  it("normalizes Indian mobile numbers", () => {
    assert.equal(normalizePhone("+91 98765-43210"), "9876543210");
    assert.throws(() => normalizePhone("12345"));
    assert.throws(() => normalizePhone("5876543210"));
  });
});
