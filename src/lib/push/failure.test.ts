import { describe, expect, it } from "vitest";

import { pushFailureMessageKey } from "./failure";

describe("pushFailureMessageKey", () => {
  it("names the actual problem instead of a generic failure", () => {
    expect(pushFailureMessageKey("not_configured")).toBe("notConfigured");
    expect(pushFailureMessageKey("too_many_devices")).toBe("tooManyDevices");
    expect(pushFailureMessageKey("unsupported")).toBe("stateUnsupported");
    expect(pushFailureMessageKey("no_device")).toBe("noDevice");
  });

  it("sends a blocked browser to the lock-icon hint, never a bare 'denied'", () => {
    expect(pushFailureMessageKey("denied")).toBe("stateDeniedHint");
  });

  it("treats transport failures and a missing reason as retryable", () => {
    expect(pushFailureMessageKey("network")).toBe("failed");
    expect(pushFailureMessageKey("save_failed")).toBe("failed");
    expect(pushFailureMessageKey("subscribe_failed")).toBe("failed");
    expect(pushFailureMessageKey(undefined)).toBe("failed");
  });
});
