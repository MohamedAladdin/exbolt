"""Verify the super-admin panel on production (bolt.excal.uk)."""

from playwright.sync_api import sync_playwright

BASE = "https://bolt.excal.uk"
EMAIL = "mohamed_aladdin@live.com"
PASSWORD = "ExBolt-Admin-2026!"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "|", str(detail)[:200])


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    ctx.add_cookies([{"name": "exbolt_locale", "value": "ar", "url": BASE}])
    page = ctx.new_page()

    page.goto(f"{BASE}/admin", wait_until="networkidle")
    check("signed-out /admin -> login?next", "/login" in page.url and "next=" in page.url, page.url)

    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_timeout(6000)
    check("lands on the panel after login", page.url.rstrip("/").endswith("/admin"), page.url)

    body = page.inner_text("body")
    check("overview renders", "نظرة عامة" in body, body[:80].replace("\n", " | "))
    for label in ["الحسابات", "الاشتراكات والفواتير", "القنوات والاتصالات", "سجل العمليات", "إعدادات المنصة"]:
        check(f"nav: {label}", label in body)

    page.goto(f"{BASE}/admin/accounts", wait_until="networkidle")
    accounts = page.inner_text("body")
    check("accounts list loads", "الحسابات" in accounts and ("Mohamed Aladdin" in accounts or "3amer" in accounts))
    page.screenshot(path="/home/maladdin/rado-yard/exbolt/docs/admin-shots/12-live-overview.png", full_page=True)

    page.goto(f"{BASE}/admin/settings", wait_until="networkidle")
    check("settings loads", "إعدادات المنصة" in page.inner_text("body"))

    page.goto(f"{BASE}/admin/billing", wait_until="networkidle")
    check("billing loads", "الاشتراكات والفواتير" in page.inner_text("body"))

    # the tenant app still works for the same admin session
    page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    dash = page.inner_text("body")
    check("tenant dashboard still works", "لوحة التحكم" in dash or "Dashboard" in dash, dash[:60].replace("\n", " | "))
    check("sidebar shows the admin row", "لوحة السوبر أدمن" in dash)

    browser.close()

failed = results.count(False)
print(f"\nSUMMARY: {len(results) - failed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
