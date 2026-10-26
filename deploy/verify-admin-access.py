"""Prove the admin panel is NOT reachable by a normal tenant user, and that the
deep link survives the login round-trip.

1. signed-out /admin -> /login?next=/admin -> after login lands on /admin (admin user)
2. normal tenant user: no "super admin" row in the sidebar, /admin bounces to
   /dashboard, and the admin API answers 403
3. admin user: the sidebar row exists and /admin renders
"""

import pathlib

from playwright.sync_api import sync_playwright

BASE = "http://10.0.0.1:3000"
SHOTS = pathlib.Path("/home/maladdin/rado-yard/wacrm/docs/admin-shots")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "|", str(detail)[:170])


def login(page, email, password):
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.fill("#email", email)
    page.fill("#password", password)
    page.click("button[type=submit]")
    page.wait_for_timeout(3500)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- 1. signed-out deep link ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 950})
    ctx.add_cookies([{"name": "wacrm_locale", "value": "ar", "url": BASE}])
    page = ctx.new_page()
    page.goto(f"{BASE}/admin", wait_until="networkidle")
    check("signed-out /admin goes to login with next", "/login" in page.url and "next=%2Fadmin" in page.url, page.url)
    page.fill("#email", "test@excal.local")
    page.fill("#password", "Test12345!")
    page.click("button[type=submit]")
    page.wait_for_timeout(4500)
    check("admin lands back on /admin after login", page.url.rstrip("/").endswith("/admin"), page.url)
    check("admin sees the panel", "نظرة عامة" in page.inner_text("body"))

    # ---------- 2. admin sees the link in the tenant sidebar ----------
    page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    check("sidebar shows the admin row for an admin", "لوحة السوبر أدمن" in page.inner_text("body"))
    page.screenshot(path=str(SHOTS / "10-sidebar-admin-link.png"))

    # ---------- 3. normal tenant user ----------
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 950})
    ctx2.add_cookies([{"name": "wacrm_locale", "value": "ar", "url": BASE}])
    page2 = ctx2.new_page()
    login(page2, "demo.nour@nour-retail.test", "Demo12345!")
    check("normal user signed in", "/dashboard" in page2.url, page2.url)

    body = page2.inner_text("body")
    check("normal user does NOT see the admin row", "لوحة السوبر أدمن" not in body)

    page2.goto(f"{BASE}/admin", wait_until="networkidle")
    body = page2.inner_text("body")
    check("normal user /admin bounces to dashboard", page2.url.endswith("/dashboard"), page2.url)
    check("normal user never sees panel content", "نظرة عامة على المنصة" not in body, body[:80].replace("\n", " | "))

    api = page2.request.get(f"{BASE}/api/admin/accounts")
    check("/api/admin/accounts -> 404 for normal user", api.status == 404, api.status)
    api2 = page2.request.get(f"{BASE}/api/admin/session")
    check("/api/admin/session says false", api2.json().get("admin") is False, api2.json())
    page2.screenshot(path=str(SHOTS / "11-normal-user-dashboard.png"))

    browser.close()

failed = results.count(False)
print(f"\nSUMMARY: {len(results) - failed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
