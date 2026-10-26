"""Open the panel on the Aorus link hostname (10.0.0.1) and prove login works.

If this passes from the Linux box, it passes from Aorus: Aorus reaches
http://10.0.0.1:3000 directly (verified over ssh) and the browser client now
talks to whatever origin it loaded from.
"""

import pathlib

from playwright.sync_api import sync_playwright

BASE = "http://10.0.0.1:3000"
SHOTS = pathlib.Path("/home/maladdin/rado-yard/wacrm/docs/admin-shots")
ok = True


def check(name, passed, detail=""):
    global ok
    ok = ok and passed
    print(("PASS" if passed else "FAIL"), name, "|", str(detail)[:160])


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    ctx.add_cookies([{"name": "wacrm_locale", "value": "ar", "url": BASE}])
    page = ctx.new_page()

    page.goto(f"{BASE}/login", wait_until="networkidle")
    check("login page served on 10.0.0.1", "تسجيل الدخول" in page.inner_text("body"))

    page.fill("#email", "test@excal.local")
    page.fill("#password", "Test12345!")
    page.click("button[type=submit]")
    try:
        page.wait_for_url("**/dashboard", timeout=25_000)
        logged_in = True
    except Exception:  # noqa: BLE001
        logged_in = False
    check("auth via same origin", logged_in, page.url)

    page.goto(f"{BASE}/admin", wait_until="networkidle")
    body = page.inner_text("body")
    check("panel loads on 10.0.0.1", "نظرة عامة" in body, body[:70].replace("\n", " | "))
    page.screenshot(path=str(SHOTS / "09-overview-aorus-link.png"), full_page=True)

    page.goto(f"{BASE}/admin/accounts", wait_until="networkidle")
    check("accounts on 10.0.0.1", "الحسابات" in page.inner_text("body"))

    browser.close()

print("RESULT:", "OK" if ok else "FAILED")
raise SystemExit(0 if ok else 1)
