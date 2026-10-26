import { describe, expect, it } from "vitest";

import {
  contentTypeForAttachment,
  parseMessagingWebhook,
  type RawMessagingWebhook,
} from "./inbound";

const messengerPayload: RawMessagingWebhook = {
  object: "page",
  entry: [
    {
      id: "1029384756",
      time: 1712000000000,
      messaging: [
        {
          sender: { id: "psid-111" },
          recipient: { id: "1029384756" },
          timestamp: 1712000000000,
          message: { mid: "mid.1", text: "hello there" },
        },
      ],
    },
  ],
};

describe("parseMessagingWebhook", () => {
  it("maps a Messenger text message", () => {
    const [event] = parseMessagingWebhook(messengerPayload);
    expect(event).toBeDefined();
    expect(event.channel).toBe("messenger");
    expect(event.externalId).toBe("1029384756");
    expect(event.senderId).toBe("psid-111");
    expect(event.messageId).toBe("mid.1");
    expect(event.text).toBe("hello there");
    expect(event.attachments).toEqual([]);
    expect(event.isPostback).toBe(false);
    expect(event.createdAt).toBe(new Date(1712000000000).toISOString());
  });

  it("maps an Instagram payload to the instagram channel", () => {
    const [event] = parseMessagingWebhook({
      ...messengerPayload,
      object: "instagram",
    });
    expect(event.channel).toBe("instagram");
  });

  it("ignores whatsapp_business_account payloads", () => {
    expect(
      parseMessagingWebhook({ object: "whatsapp_business_account", entry: [] }),
    ).toEqual([]);
  });

  it("drops echoes so agent replies are not duplicated", () => {
    const payload: RawMessagingWebhook = {
      object: "page",
      entry: [
        {
          id: "1",
          messaging: [
            {
              sender: { id: "page-1" },
              recipient: { id: "psid-1" },
              timestamp: 1712000000000,
              message: { mid: "mid.echo", text: "our reply", is_echo: true },
            },
          ],
        },
      ],
    };
    expect(parseMessagingWebhook(payload)).toEqual([]);
  });

  it("drops delivery / read receipts with no message body", () => {
    const payload: RawMessagingWebhook = {
      object: "page",
      entry: [
        {
          id: "1",
          messaging: [
            { sender: { id: "psid-1" }, recipient: { id: "1" }, delivery: {} },
            { sender: { id: "psid-1" }, recipient: { id: "1" }, read: {} },
          ],
        },
      ],
    };
    expect(parseMessagingWebhook(payload)).toEqual([]);
  });

  it("keeps an attachment-only message with no text", () => {
    const payload: RawMessagingWebhook = {
      object: "instagram",
      entry: [
        {
          id: "ig-1",
          messaging: [
            {
              sender: { id: "igsid-1" },
              recipient: { id: "ig-1" },
              timestamp: 1712000000000,
              message: {
                mid: "mid.2",
                attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }],
              },
            },
          ],
        },
      ],
    };
    const [event] = parseMessagingWebhook(payload);
    expect(event.text).toBeNull();
    expect(event.attachments).toEqual([{ type: "image", url: "https://cdn/x.jpg" }]);
  });

  it("turns a postback into text so the thread still reads sensibly", () => {
    const payload: RawMessagingWebhook = {
      object: "page",
      entry: [
        {
          id: "1",
          messaging: [
            {
              sender: { id: "psid-9" },
              recipient: { id: "1" },
              timestamp: 1712000000000,
              postback: { mid: "mid.pb", title: "Get started", payload: "START" },
            },
          ],
        },
      ],
    };
    const [event] = parseMessagingWebhook(payload);
    expect(event.isPostback).toBe(true);
    expect(event.text).toBe("Get started");
    expect(event.messageId).toBe("mid.pb");
  });

  it("ignores events without a sender id", () => {
    const payload: RawMessagingWebhook = {
      object: "page",
      entry: [
        {
          id: "1",
          messaging: [{ message: { mid: "mid.x", text: "no sender" } }],
        },
      ],
    };
    expect(parseMessagingWebhook(payload)).toEqual([]);
  });

  it("flattens multiple entries and multiple messages", () => {
    const payload: RawMessagingWebhook = {
      object: "page",
      entry: [
        {
          id: "page-a",
          messaging: [
            { sender: { id: "u1" }, message: { mid: "m1", text: "one" } },
            { sender: { id: "u2" }, message: { mid: "m2", text: "two" } },
          ],
        },
        {
          id: "page-b",
          messaging: [{ sender: { id: "u3" }, message: { mid: "m3", text: "three" } }],
        },
      ],
    };
    const events = parseMessagingWebhook(payload);
    expect(events.map((e) => e.externalId)).toEqual(["page-a", "page-a", "page-b"]);
    expect(events.map((e) => e.text)).toEqual(["one", "two", "three"]);
  });
});

describe("contentTypeForAttachment", () => {
  it("maps Meta attachment types onto the messages content_type enum", () => {
    expect(contentTypeForAttachment("image")).toBe("image");
    expect(contentTypeForAttachment("video")).toBe("video");
    expect(contentTypeForAttachment("audio")).toBe("audio");
    expect(contentTypeForAttachment("file")).toBe("document");
    expect(contentTypeForAttachment("share")).toBe("document");
  });
});
