"""End-to-end check of the super-admin panel against the local production build.

Asserts on rendered text, not screenshots: the model cannot read pixels, so
every check must be something `document.body.innerText` can prove. Screenshots
are still saved for human review in docs/admin-shots/.

Run: /home/maladdin/.hermes/hermes-agent/venv/bin/python deploy/verify-admin-panel.py
"""

import json
import pathlib
import sys
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
SUPABASE = "http://127.0.0.1:54321"
EMAIL = "test@excal.local"
PASSWORD = "Test12345!"
SHOTS = pathlib.Path("/home/maladdin/rado-yard/exbolt/docs/admin-shots")
ENV_FILE = pathlib.Path("/home/maladdin/rado-yard/exbolt/.env.local")

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), name, "|", str(detail)[:180])


def anon_key() -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("NEXT_PUBLIC_SUPABASE_ANON_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("anon key not found in .env.local")


def try_signup(email: str) -> tuple[int, dict]:
    payload = json.dumps(
        {"email": email, "password": "Test12345!", "data": {"full_name": "Gate Test"}}
    ).encode()
    request = urllib.request.Request(
        f"{SUPABASE}/auth/v1/signup",
        data=payload,
        method="POST",
        headers={"apikey": anon_key(), "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            return error.code, json.loads(body or b"{}")
        except json.JSONDecodeError:
            return error.code, {"raw": body.decode()[:200]}


def login(page):
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_url("**/dashboard", timeout=30_000)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        ctx.add_cookies([{"name": "exbolt_locale", "value": "ar", "url": BASE}])
        page = ctx.new_page()

        login(page)
        check("login", "/dashboard" in page.url, page.url)

        # ---------- overview ----------
        page.goto(f"{BASE}/admin", wait_until="networkidle")
        body = page.inner_text("body")
        check("overview renders", "نظرة عامة" in body, body[:90].replace("\n", " | "))
        check("mrr tile", "الإيراد الشهري المتكرر" in body)
        check("registration strip", "باب التسجيل" in body)
        check("attention panel", "محتاج تدخل" in body)
        page.screenshot(path=str(SHOTS / "01-overview-ar.png"), full_page=True)

        # ---------- accounts ----------
        page.goto(f"{BASE}/admin/accounts", wait_until="networkidle")
        body = page.inner_text("body")
        check("accounts table", "الحسابات" in body and EMAIL in body)
        page.screenshot(path=str(SHOTS / "02-accounts-ar.png"), full_page=True)

        # ---------- account detail (navigate by href, not by text) ----------
        href = page.eval_on_selector('a[href^="/admin/accounts/"]', "el => el.getAttribute('href')")
        page.goto(f"{BASE}{href}", wait_until="networkidle")
        body = page.inner_text("body")
        check("detail controls", "التحكم في الحساب" in body, page.url)
        check("grants panel", "المنح والهدايا" in body)
        check("invoice panel", "الفواتير" in body)
        check("email panel", "مراسلة العميل" in body)
        check("members panel", "المستخدمون" in body)
        page.screenshot(path=str(SHOTS / "03-account-detail-ar.png"), full_page=True)

        # ---------- billing / channels / settings ----------
        page.goto(f"{BASE}/admin/billing", wait_until="networkidle")
        body = page.inner_text("body")
        check("billing page", "الاشتراكات والفواتير" in body)
        check("smtp banner", "SMTP" in body)
        check("plans editor", "كتالوج الخطط" in body)
        page.screenshot(path=str(SHOTS / "04-billing-ar.png"), full_page=True)

        page.goto(f"{BASE}/admin/channels", wait_until="networkidle")
        body = page.inner_text("body")
        check("channels page", "القنوات والاتصالات" in body)
        page.screenshot(path=str(SHOTS / "05-channels-ar.png"), full_page=True)

        page.goto(f"{BASE}/admin/settings", wait_until="networkidle")
        body = page.inner_text("body")
        check("settings page", "إعدادات المنصة" in body)
        check("allowlist panel", "قائمة المسموح لهم بالتسجيل" in body)
        check("admins panel", "أدمنز المنصة" in body)
        page.screenshot(path=str(SHOTS / "06-settings-ar.png"), full_page=True)

        # ---------- audit ----------
        page.goto(f"{BASE}/admin/audit", wait_until="networkidle")
        body = page.inner_text("body")
        check("audit log", "سجل العمليات" in body and "settings.updated" in body)
        page.screenshot(path=str(SHOTS / "07-audit-ar.png"), full_page=True)

        # ---------- close registration from the UI, then prove the DB gate ----------
        page.goto(f"{BASE}/admin", wait_until="networkidle")
        closed = page.evaluate("fetch('/api/auth/signup-status').then(r => r.json())")
        if closed.get("enabled") is True:
            page.get_by_role("button", name="اقفل التسجيل").first.click()
            page.wait_for_timeout(2500)
        state = page.evaluate("fetch('/api/auth/signup-status').then(r => r.json())")
        check("registration closed via UI", state.get("enabled") is False, json.dumps(state))

        status, payload = try_signup("gate-check@excal.local")
        check(
            "DB refuses signup while closed",
            payload.get("message") == "SIGNUP_CLOSED" or status >= 400,
            f"{status} {payload}",
        )

        # reopen + prove the door works again
        page.get_by_role("button", name="افتح التسجيل").first.click()
        page.wait_for_timeout(2500)
        state = page.evaluate("fetch('/api/auth/signup-status').then(r => r.json())")
        check("registration reopened", state.get("enabled") is True, json.dumps(state))

        status, payload = try_signup("gate-check@excal.local")
        check("signup works when open", status == 200 and "access_token" in payload, status)

        # ---------- English ----------
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 1000})
        ctx2.add_cookies([{"name": "exbolt_locale", "value": "en", "url": BASE}])
        page2 = ctx2.new_page()
        login(page2)
        page2.goto(f"{BASE}/admin", wait_until="networkidle")
        body2 = page2.inner_text("body")
        check("english render", "Platform overview" in body2, body2[:90].replace("\n", " | "))
        page2.screenshot(path=str(SHOTS / "08-overview-en.png"), full_page=True)

        # ---------- non-admin is refused ----------
        anon = browser.new_context()
        page3 = anon.new_page()
        page3.goto(f"{BASE}/admin", wait_until="networkidle")
        check("signed-out admin redirect", "/login" in page3.url, page3.url)

        browser.close()

    failed = [r for r in results if not r["ok"]]
    print(f"\nSUMMARY: {len(results) - len(failed)} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
