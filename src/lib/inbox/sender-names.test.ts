import { describe, expect, it } from "vitest";
import { senderDisplayName, unresolvedSenderIds } from "./sender-names";

describe("senderDisplayName", () => {
  it("prefers the full name", () => {
    expect(
      senderDisplayName({ user_id: "u1", full_name: "  منى عبد الله ", email: "mona@excal.uk" }),
    ).toBe("منى عبد الله");
  });

  it("falls back to the email local part when there is no name", () => {
    expect(senderDisplayName({ user_id: "u1", full_name: null, email: "omar@excal.uk" })).toBe("omar");
  });

  it("treats a blank name as missing", () => {
    expect(senderDisplayName({ user_id: "u1", full_name: "   ", email: "sara@excal.uk" })).toBe("sara");
  });

  it("returns null when nothing identifies the user", () => {
    expect(senderDisplayName({ user_id: "u1", full_name: null, email: null })).toBeNull();
  });
});

describe("unresolvedSenderIds", () => {
  const known = new Map([["u1", "Mona"]]);

  it("only asks for agent messages with a sender", () => {
    expect(
      unresolvedSenderIds(
        [
          { sender_id: "u1", sender_type: "agent" },
          { sender_id: null, sender_type: "customer" },
          { sender_id: "u2", sender_type: "customer" },
          { sender_id: "u3", sender_type: "agent" },
          { sender_id: "u3", sender_type: "agent" },
        ],
        known,
      ),
    ).toEqual(["u3"]);
  });

  it("skips ids that already failed so the effect cannot loop", () => {
    expect(
      unresolvedSenderIds([{ sender_id: "gone", sender_type: "agent" }], known, new Set(["gone"])),
    ).toEqual([]);
  });

  it("skips ids already cached", () => {
    expect(unresolvedSenderIds([{ sender_id: "u1", sender_type: "agent" }], known)).toEqual([]);
  });
});
