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

  // A message that lists several numbers used to collapse into ONE candidate
  // (the separators are legal inside a number), whose digit count then blew
  // past 15 and killed every number on the line — customer service reported
  // exactly that: "the popup does not come up on any number in a message that
  // has a group of numbers".
  it("finds both numbers when they are separated by spaces", () => {
    const matches = findPhoneMatches("01012345678 01098765432");
    expect(matches.map((m) => m.digits)).toEqual(["01012345678", "01098765432"]);
    expect(matches[1].e164).toBe(`+${defaultCountryCode()}1098765432`);
  });

  it("finds both numbers when they are separated by a dash", () => {
    const matches = findPhoneMatches("أرقام التواصل: 01012345678 - 01098765432");
    expect(matches.map((m) => m.digits)).toEqual(["01012345678", "01098765432"]);
  });

  it("finds numbers separated by a newline", () => {
    const matches = findPhoneMatches("أرقامنا:\n01012345678\n01098765432");
    expect(matches).toHaveLength(2);
  });

  it("finds three numbers on one line", () => {
    const matches = findPhoneMatches("اتصل 01012345678 أو 01122334455 أو 01233445566");
    expect(matches).toHaveLength(3);
  });

  it("splits two numbers that are each written with internal spaces", () => {
    const matches = findPhoneMatches("0101 234 5678 / 0109 876 5432");
    expect(matches.map((m) => m.digits)).toEqual(["01012345678", "01098765432"]);
  });

  it("keeps a spaced international number as one candidate", () => {
    const matches = findPhoneMatches("+20 101 234 5678 أو 01098765432");
    expect(matches).toHaveLength(2);
    expect(matches[0].digits).toBe("201012345678");
  });

  it("accepts a number written right after a colon", () => {
    const [match] = findPhoneMatches("واتساب:01012345678");
    expect(match?.digits).toBe("01012345678");
  });

  it("still ignores a spaced date", () => {
    expect(findPhoneMatches("موعد 2026 10 26 الساعة 5")).toHaveLength(0);
  });

  it("reads Arabic-Indic digits", () => {
    const [match] = findPhoneMatches("رقمي ٠١٠١٢٣٤٥٦٧٨");
    expect(match?.digits).toBe("01012345678");
    expect(match?.e164).toBe(`+${defaultCountryCode()}1012345678`);
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
