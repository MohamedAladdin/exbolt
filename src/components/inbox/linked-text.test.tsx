import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LinkifiedSpan } from "./linked-text";

function render(text: string, onPrimary = false) {
  return renderToStaticMarkup(
    createElement(LinkifiedSpan, { text, onPrimary }),
  );
}

describe("LinkifiedSpan (composed with the phone-to-contact-card renderer)", () => {
  it("leaves plain text alone", () => {
    expect(render("Hello there\nHow are you?")).toBe(
      "<span>Hello there\nHow are you?</span>",
    );
  });

  it("links http, https and www URLs", () => {
    const markup = render(
      "Visit http://legacy.example.com and https://example.com/p?q=1 or www.example.com",
    );
    expect(markup).toContain('href="http://legacy.example.com"');
    expect(markup).toContain('href="https://example.com/p?q=1"');
    expect(markup).toContain('href="https://www.example.com"');
    expect(markup).toContain('rel="noopener noreferrer nofollow"');
    expect(markup).toContain('target="_blank"');
  });

  it("inverts the link colour on outbound (primary) bubbles", () => {
    const inbound = render("see https://example.com");
    const outbound = render("see https://example.com", true);
    expect(inbound).toContain("text-blue-600");
    expect(outbound).not.toContain("text-blue-600");
    expect(outbound).toContain("underline");
  });

  it("keeps HTML-like content as text", () => {
    const markup = render("<script>alert('xss')</script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("does not swallow a phone number that sits before a URL", () => {
    // The phone stays in its own segment (rendered by ContactPeek); this
    // asserts only that no phone digits leak into an anchor.
    const markup = render("call me on +20 100 123 4567 or see https://example.com");
    expect(markup).toContain('href="https://example.com"');
    expect(markup).not.toContain('href="tel:');
  });
});
