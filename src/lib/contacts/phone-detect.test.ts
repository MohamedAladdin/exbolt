import { describe, expect, it } from "vitest";

import {
  defaultCountryCode,
  findPhoneMatches,
  segmentByPhone,
} from "./phone-detect";

describe("findPhoneMatches", () => {
  it("finds an international number written with separators", () => {
    const matches = findPhoneMatches("Please call +20 101 234 5678 today");
    expect(matches).toHaveLength(1);
    expect(matches[0].digits).toBe("201012345678");
    expect(matches[0].e164).toBe("+201012345678");
  });

  it("promotes an Egyptian local number with the default country code", () => {
    const [match] = findPhoneMatches("رقمي 01012345678");
    expect(match).toBeDefined();
    expect(match.e164).toBe(`+${defaultCountryCode()}1012345678`);
  });

  it("accepts the 00 international prefix", () => {
    const [match] = findPhoneMatches("dial 00201012345678");
    expect(match.e164).toBe("+201012345678");
  });

  it("ignores dates", () => {
    expect(findPhoneMatches("delivery on 2026-10-26 please")).toHaveLength(0);
  });

  it("ignores prices, order ids and short runs", () => {
    expect(findPhoneMatches("order 12345 costs 1500")).toHaveLength(0);
  });

  it("ignores a URL that happens to contain digits", () => {
    expect(findPhoneMatches("https://example.com/track/1234567890")).toHaveLength(0);
  });

  it("finds two numbers in one message", () => {
    const matches = findPhoneMatches("+201012345678 أو 01098765432");
    expect(matches).toHaveLength(2);
  });

  it("returns null e164 for an ambiguous local number", () => {
    const [match] = findPhoneMatches("call 5551234567 now");
    expect(match).toBeDefined();
    expect(match.e164).toBeNull();
  });
});

describe("segmentByPhone", () => {
  it("splits text around the phone number, preserving everything", () => {
    const segments = segmentByPhone("اتصل +201012345678 بكرة");
    expect(segments.map((s) => s.kind)).toEqual(["text", "phone", "text"]);
    expect(segments[1].text).toBe("+201012345678");
    expect(segments[0].kind === "text" && segments[0].text).toBe("اتصل ");
    expect(segments[2].kind === "text" && segments[2].text).toBe(" بكرة");
  });

  it("returns a single text segment when there is no number", () => {
    expect(segmentByPhone("hello")).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("returns nothing for empty input", () => {
    expect(segmentByPhone("")).toEqual([]);
  });
});
