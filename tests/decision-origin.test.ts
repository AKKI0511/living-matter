import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionOriginAllowed } from "../src/server/decision-origin";

test("browser origins match the incoming host rather than the Next bind address", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "192.168.1.10:3000", "[::1]:3000"]) {
    assert.equal(decisionOriginAllowed(new Request("http://0.0.0.0:3000/api/decision", {
      headers: { host, origin: `http://${host}` },
    })), true);
  }
});

test("different hosts, ports and protocols remain rejected", () => {
  for (const origin of ["http://other.example:3000", "http://localhost:3001", "https://localhost:3000", "null"]) {
    assert.equal(decisionOriginAllowed(new Request("http://0.0.0.0:3000/api/decision", {
      headers: { host: "localhost:3000", origin, "x-forwarded-host": "other.example:3000" },
    })), false);
  }
});

test("requests without Host fall back to the URL and requests without Origin are allowed", () => {
  assert.equal(decisionOriginAllowed(new Request("http://localhost:3000/api/decision", {
    headers: { origin: "http://localhost:3000" },
  })), true);
  assert.equal(decisionOriginAllowed(new Request("http://localhost:3000/api/decision", {
    headers: { origin: "http://other.example:3000" },
  })), false);
  assert.equal(decisionOriginAllowed(new Request("http://localhost:3000/api/decision")), true);
});
