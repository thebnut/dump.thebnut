import { expect, it } from "vitest";
import OAuth2Server from "@node-oauth/oauth2-server";
import { oauthError, boundedText } from "../src/lib/oauth-http";
import { OAuthRequestError } from "../src/lib/oauth-policy";
it("distinguishes client errors from internal failures without exposing details", async () => {
  const invalid = oauthError(new OAuthRequestError("Bad input"));
  expect(invalid.status).toBe(400); expect((await invalid.json()).error).toBe("invalid_request");
  const grant = oauthError(new OAuth2Server.InvalidGrantError("Expired code"));
  expect(grant.status).toBe(400); expect((await grant.json()).error).toBe("invalid_grant");
  const failure = oauthError(new Error("DB secret must not leak"));
  expect(failure.status).toBe(500); expect(await failure.text()).not.toContain("DB secret");
});
it("enforces body limits without trusting content-length", async () => {
  await expect(boundedText(new Request("https://example.test", { method: "POST", body: "123456" }), 5)).rejects.toThrow();
  expect(await boundedText(new Request("https://example.test", { method: "POST", body: "12345" }), 5)).toBe("12345");
});
