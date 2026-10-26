"""Prove the admin panel can actually send mail on production."""

from playwright.sync_api import sync_playwright

BASE = "https://bolt.excal.uk"
EMAIL = "mohamed_aladdin@live.com"
PASSWORD = "ExBolt-Admin-2026!"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "|", str(detail)[:180])


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    ctx.add_cookies([{"name": "wacrm_locale", "value": "ar", "url": BASE}])
    page = ctx.new_page()
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_timeout(5000)
    check("signed in", "/dashboard" in page.url or "/admin" in page.url, page.url)

    page.goto(f"{BASE}/admin/billing", wait_until="networkidle")
    body = page.inner_text("body")
    configured = "SMTP مضبوط" in body
    check("billing banner says SMTP configured", configured)
    check("dry-run warning gone", "SMTP مش مضبوط" not in body)

    # find the account id for the signed-in owner
    page.goto(f"{BASE}/admin/accounts", wait_until="networkidle")
    href = page.evaluate(
        """(email) => {
            const row = [...document.querySelectorAll('tr')].find((tr) =>
                tr.innerText.split('\\n').some((line) => line.trim() === email),
            );
            return row?.querySelector('a[href^="/admin/accounts/"]')?.getAttribute('href') ?? null;
        }""",
        EMAIL,
    )
    check("account row found", bool(href), href)

    if href:
        account_id = href.rsplit("/", 1)[-1]
        result = page.evaluate(
            """async ([accountId]) => {
                const response = await fetch(`/api/admin/accounts/${accountId}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        action: 'email',
                        to: 'mohamed_aladdin@live.com',
                        subject: 'ExBolt — اختبار مسار الإيميل من لوحة التحكم',
                        body: 'الرسالة دي اتبعتت من نفس الكود اللي بيبعت الفواتير والتذكيرات. لو وصلت، المسار شغال كامل.',
                        toName: 'Mohamed',
                    }),
                });
                return { status: response.status, data: await response.json().catch(() => null) };
            }""",
            [account_id],
        )
        check(
            "custom email delivered",
            result["status"] == 200 and (result["data"] or {}).get("status") == "sent",
            result,
        )

    browser.close()

failed = results.count(False)
print(f"\nSUMMARY: {len(results) - failed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
