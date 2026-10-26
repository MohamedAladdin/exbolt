"""Prove the money path and the gift path end to end, against the local build.

1. A feature grant must show up in the tenant's own entitlements
   (plan resolution + the account_grants RLS policy, both at once).
2. An invoice must be created with the next number, emailed (dry run with no
   SMTP), and moved to paid.

Run: /home/maladdin/.hermes/hermes-agent/venv/bin/python deploy/verify-admin-flows.py
"""

import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
EMAIL = "test@excal.local"
PASSWORD = "Test12345!"

results = []


def check(name, ok, detail=""):
    results.append({"ok": bool(ok), "name": name})
    print(("PASS" if ok else "FAIL"), name, "|", str(detail)[:200])


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        # Arabic cookie so the shell check can assert on the Arabic copy.
        ctx.add_cookies([{"name": "wacrm_locale", "value": "ar", "url": BASE}])
        page = ctx.new_page()
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.fill("#email", EMAIL)
        page.fill("#password", PASSWORD)
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=30_000)

        def api(method, path, body=None):
            return page.evaluate(
                """async ([method, path, body]) => {
                    const response = await fetch(path, {
                        method,
                        headers: { 'content-type': 'application/json' },
                        body: body ? JSON.stringify(body) : undefined,
                    });
                    return { status: response.status, data: await response.json().catch(() => null) };
                }""",
                [method, path, body],
            )

        # Resolve THIS user's account id: the list is newest-first, so the
        # first row can be a throwaway account from another check.
        page.goto(f"{BASE}/admin/accounts", wait_until="networkidle")
        href = page.evaluate(
            """(email) => {
                // Exact line match: `gate-test@excal.local` contains
                // `test@excal.local` as a substring, so includes() lies.
                const row = [...document.querySelectorAll('tr')].find((tr) =>
                    tr.innerText.split('\\n').some((line) => line.trim() === email),
                );
                return row?.querySelector('a[href^="/admin/accounts/"]')?.getAttribute('href') ?? null;
            }""",
            EMAIL,
        )
        if not href:
            raise SystemExit("could not find the demo account row")
        account_id = href.rsplit("/", 1)[-1]
        print("account:", account_id)

        # Idempotent setup: a previous interrupted run may have left the
        # tenant suspended, and every check below needs it active.
        api("PATCH", f"/api/admin/accounts/{account_id}", {"action": "status", "status": "active"})

        # ---------- gift → entitlements ----------
        # Pick a feature the demo plan does NOT already include, otherwise the
        # check proves nothing (the plan, not the grant, would be the reason).
        before = api("GET", "/api/account/entitlements")
        candidates = ["flows", "api", "ai_knowledge", "reports_advanced", "team_roles", "branches"]
        feature = next((f for f in candidates if before["data"]["features"].get(f) is False), None)
        if feature is None:
            raise SystemExit("demo plan already includes every candidate feature")
        ai_before = before["data"]["features"][feature]
        print("feature under test:", feature)

        granted = api(
            "PATCH",
            f"/api/admin/accounts/{account_id}",
            {"action": "grant", "kind": "feature", "key": feature, "value": True, "reason": "verify"},
        )
        check("grant created", granted["status"] == 200 and granted["data"].get("id"), granted)

        after = api("GET", "/api/account/entitlements")
        ai_after = after["data"]["features"][feature]
        check("grant reaches tenant entitlements", ai_after is True and ai_before is False, f"{ai_before} -> {ai_after}")

        revoked = api(
            "PATCH",
            f"/api/admin/accounts/{account_id}",
            {"action": "revoke_grant", "grantId": granted["data"]["id"]},
        )
        check("grant revoked", revoked["status"] == 200, revoked)

        ai_revoked = api("GET", "/api/account/entitlements")["data"]["features"][feature]
        check("revoked grant removed", ai_revoked is False, ai_revoked)

        # ---------- invoice → send (dry run) → paid ----------
        created = api(
            "POST",
            "/api/admin/invoices",
            {
                "action": "create",
                "accountId": account_id,
                "lineItems": [{"description": "Growth plan — November", "quantity": 1, "unit_price": 129}],
                "dueDate": "2026-11-15",
                "toEmail": EMAIL,
                "notes": "created by verify-admin-flows",
            },
        )
        invoice = (created.get("data") or {}).get("invoice") or {}
        check("invoice created", created["status"] == 200 and invoice.get("number"), invoice.get("number"))
        check("invoice total", float(invoice.get("amount") or 0) == 129.0, invoice.get("amount"))
        check(
            "invoice numbering",
            str(invoice.get("number", "")).startswith("EXB-") and len(str(invoice.get("number"))) == 13,
            invoice.get("number"),
        )

        sent = api("POST", "/api/admin/invoices", {"action": "send", "invoiceId": invoice.get("id")})
        check("invoice send is honest about SMTP", sent["data"].get("status") in ("dry_run", "sent"), sent)

        paid = api("POST", "/api/admin/invoices", {"action": "update", "invoiceId": invoice.get("id"), "status": "paid"})
        check("invoice marked paid", paid["status"] == 200, paid)

        # ---------- suspension locks the tenant API ----------
        suspended = api(
            "PATCH",
            f"/api/admin/accounts/{account_id}",
            {"action": "status", "status": "suspended", "reason": "verify"},
        )
        check("suspend accepted", suspended["status"] == 200, suspended)

        blocked = api("GET", "/api/account")
        check("suspended tenant API refuses", blocked["status"] == 403, blocked)

        # The app shell must explain the lock instead of rendering an empty app.
        # `networkidle` never settles on the dashboard (presence heartbeat +
        # realtime socket), so wait for the block text instead.
        page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
        try:
            page.wait_for_selector("text=الوصول متوقف لهذا الحساب", timeout=20_000)
            shown = True
        except Exception:  # noqa: BLE001 - the assertion below reports it
            shown = False
        shell = page.inner_text("body")
        check("tenant shell shows the block screen", shown, shell[:90].replace("\n", " | "))

        restored = api(
            "PATCH",
            f"/api/admin/accounts/{account_id}",
            {"action": "status", "status": "active"},
        )
        check("restore accepted", restored["status"] == 200, restored)

        back = api("GET", "/api/account")
        check("tenant API works again", back["status"] == 200, back["status"])

        browser.close()

    failed = [r for r in results if not r["ok"]]
    print(f"\nSUMMARY: {len(results) - len(failed)} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
