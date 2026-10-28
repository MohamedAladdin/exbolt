/* ExBolt landing — interactions + live commercial content */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const localHosts = ["localhost", "127.0.0.1", ""];
  const isLocal =
    localHosts.includes(location.hostname) ||
    location.hostname.startsWith("192.168.") ||
    location.hostname.endsWith(".local");
  const API_BASE = isLocal ? "http://localhost:3111" : "https://bolt.excal.uk";
  const LANG = document.documentElement.lang === "en" ? "en" : "ar";

  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>';
  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  let contactEmail = "sales@excal.uk";
  let contactResponse = LANG === "ar" ? "خلال يوم عمل" : "within one business day";

  /* header state */
  const header = $(".site-header");
  const onScroll = () => header && header.classList.toggle("is-stuck", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* mobile menu */
  const menuBtn = $("#menuBtn");
  const navLinks = $("#navLinks");
  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", (event) => {
      // Keep the document-level "click outside" handler from seeing this
      // click after innerHTML swaps the icon (the original target is detached).
      event.stopPropagation();
      const open = navLinks.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.innerHTML = open
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    });
    $$("a", navLinks).forEach((a) =>
      a.addEventListener("click", () => {
        navLinks.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
      })
    );
    document.addEventListener("click", (event) => {
      const path = event.composedPath();
      if (path.includes(navLinks) || path.includes(menuBtn)) return;
      navLinks.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    });
  }

  /* scroll reveal */
  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* pricing period */
  const periodButtons = $$("[data-period]");
  let currentPeriod = "monthly";
  const setPeriod = (period) => {
    currentPeriod = period;
    periodButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === period)));
    $$(".price-amount").forEach((el) => {
      const value = period === "annual" ? el.dataset.a : el.dataset.m;
      el.textContent = Number(value || 0).toLocaleString("en-US");
    });
    $$(".price-period").forEach((el) => {
      el.textContent = period === "annual" ? el.dataset.a : el.dataset.m;
    });
  };
  periodButtons.forEach((b) => b.addEventListener("click", () => setPeriod(b.dataset.period)));

  /* plan CTA prefills the form */
  $$("[data-plan]").forEach((a) => {
    a.addEventListener("click", () => {
      const select = $("#f-plan");
      if (!select) return;
      const wanted = a.dataset.plan.toLowerCase();
      const option = Array.from(select.options).find((o) => o.textContent.trim().toLowerCase() === wanted);
      if (option) select.value = option.value;
      window.setTimeout(() => $("#f-name")?.focus({ preventScroll: true }), 650);
    });
  });

  /* one FAQ open at a time */
  const faqItems = $$(".faq-item");
  faqItems.forEach((item) =>
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item) other.open = false;
      });
    })
  );

  /* scroll progress + scroll spy */
  const progressBar = $(".scroll-progress i");
  const spyLinks = $$('.nav-links a[href^="#"]').filter((a) => a.hash.length > 1);
  const spyTargets = spyLinks
    .map((link) => ({ link, target: document.querySelector(link.hash) }))
    .filter((item) => item.target);

  const updateScrollUi = () => {
    const root = document.documentElement;
    const max = root.scrollHeight - root.clientHeight;
    if (progressBar) {
      progressBar.style.transform = `scaleX(${max > 0 ? Math.min(root.scrollTop / max, 1) : 0})`;
    }
    let active = null;
    for (const item of spyTargets) {
      if (item.target.getBoundingClientRect().top <= 140) active = item.link;
    }
    spyLinks.forEach((link) => link.classList.toggle("active", link === active));
  };

  let scrollTick = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTick) return;
      scrollTick = true;
      requestAnimationFrame(() => {
        updateScrollUi();
        scrollTick = false;
      });
    },
    { passive: true }
  );
  updateScrollUi();

  /* animated numbers in the studio section */
  const facts = $(".about-facts");
  if (facts) {
    const numbers = $$("b[data-count]", facts);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = (el) => {
      const target = Number(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      const decimals = String(el.dataset.count).includes(".") ? 1 : 0;
      if (!Number.isFinite(target)) return;
      if (reduce) {
        el.textContent = target.toFixed(decimals) + suffix;
        return;
      }
      const started = performance.now();
      const duration = 1250;
      const tick = (now) => {
        const progress = Math.min((now - started) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = (target * eased).toFixed(decimals) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if ("IntersectionObserver" in window) {
      const counterObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            numbers.forEach(animate);
            counterObserver.disconnect();
          });
        },
        { threshold: 0.35 }
      );
      counterObserver.observe(facts);
    } else {
      numbers.forEach(animate);
    }
  }

  /* live contact + pricing from the admin panel */
  const applyContact = (contact) => {
    if (!contact) return;
    if (contact.email) {
      contactEmail = contact.email;
      $$("[data-contact-email]").forEach((el) => {
        el.textContent = contact.email;
        if (el.tagName === "A") el.setAttribute("href", `mailto:${contact.email}`);
      });
    }
    if (contact.responseTime) {
      contactResponse = contact.responseTime;
      $$("[data-response]").forEach((el) => {
        el.textContent = contact.responseTime;
      });
    }

    const phoneRow = $("[data-contact-phone]");
    if (phoneRow) {
      if (contact.phone) {
        phoneRow.hidden = false;
        const link = $("[data-contact-phone-link]", phoneRow);
        if (link) {
          link.textContent = contact.phone;
          link.setAttribute("href", `tel:${contact.phone.replace(/\s+/g, "")}`);
        }
      } else {
        phoneRow.hidden = true;
      }
    }

    const waRow = $("[data-contact-whatsapp]");
    if (waRow) {
      if (contact.whatsapp) {
        waRow.hidden = false;
        const link = $("[data-contact-whatsapp-link]", waRow);
        if (link) {
          link.textContent = contact.whatsapp;
          link.setAttribute("href", `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`);
        }
      } else {
        waRow.hidden = true;
      }
    }
  };

  const applyPlans = (plans) => {
    if (!Array.isArray(plans) || plans.length === 0) return;
    const grid = $(".pricing-grid");
    if (!grid) return;
    const cards = new Map(
      $$(".price-card[data-code]", grid).map((card) => [card.dataset.code, card])
    );
    const seen = new Set();

    plans.forEach((plan) => {
      const card = cards.get(plan.code);
      if (!card) return;
      seen.add(plan.code);

      const subtitle = $(".price-name-ar", card);
      if (subtitle && plan.subtitle) subtitle.textContent = plan.subtitle;
      const desc = $(".price-desc", card);
      if (desc) desc.textContent = plan.description || "";

      const amount = $(".price-amount", card);
      if (amount) {
        amount.dataset.m = String(plan.priceMonthly ?? 0);
        amount.dataset.a = String(plan.priceAnnual ?? plan.priceMonthly ?? 0);
        amount.textContent = Number(plan.priceMonthly ?? 0).toLocaleString("en-US");
      }

      const annual = $(".price-annual .ann", card);
      if (annual) {
        annual.textContent = Number(plan.priceAnnual ?? 0).toLocaleString("en-US");
        annual.closest(".price-annual").style.display =
          plan.priceAnnual === null ? "none" : "";
      }

      const limits = $(".price-limits", card);
      if (limits) {
        limits.innerHTML = (plan.limits || [])
          .map((label) => `<li>${CHECK}${escapeHtml(label)}</li>`)
          .join("");
      }
      const features = $(".price-features", card);
      if (features) {
        features.innerHTML = (plan.features || [])
          .map((label) => `<li>${CHECK}${escapeHtml(label)}</li>`)
          .join("");
      }

      card.classList.toggle("featured", Boolean(plan.featured));
      if (plan.badge) card.dataset.badge = plan.badge;
      grid.appendChild(card);
    });

    cards.forEach((card, code) => {
      if (!seen.has(code)) card.remove();
    });

    setPeriod(currentPeriod);
  };

  const loadLanding = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/public/landing?locale=${LANG}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      applyContact(data.contact);
      applyPlans(data.plans);
    } catch {
      /* keep the static fallback */
    }
  };
  loadLanding();

  /* lead form */
  const form = $("#leadForm");
  if (!form) return;
  const status = $("#formStatus");
  const submit = $("#leadSubmit");
  const submitLabel = submit ? submit.innerHTML : "";

  const show = (kind, message) => {
    if (!status) return;
    status.className = `form-status ${kind}`;
    status.textContent = message;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;

    const data = Object.fromEntries(new FormData(form).entries());
    const consent = $("#f-consent");
    if (!String(data.name || "").trim() || !String(data.email || "").trim()) {
      show("err", LANG === "ar" ? "الاسم والإيميل مطلوبين." : "Name and email are required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(data.email))) {
      show("err", LANG === "ar" ? "الإيميل مش صحيح." : "That email doesn't look right.");
      return;
    }
    if (consent && !consent.checked) {
      show("err", LANG === "ar" ? "لازم توافق على التواصل." : "Please accept the contact consent.");
      return;
    }

    submit.disabled = true;
    submit.textContent = LANG === "ar" ? "بيبعت…" : "Sending…";
    show("", "");

    try {
      const response = await fetch(`${API_BASE}/api/public/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          locale: LANG,
          source: "landing",
          page: location.pathname,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "request_failed");
      show(
        "ok",
        LANG === "ar"
          ? `وصلنا طلبك ✓ هنرد عليك ${contactResponse}.`
          : `Got it ✓ We'll get back to you ${contactResponse}.`
      );
      form.reset();
    } catch {
      show(
        "err",
        LANG === "ar"
          ? `حصلت مشكلة وإحنا بنبعت. جرّب تاني أو راسلنا على ${contactEmail}.`
          : `Something went wrong. Try again or email ${contactEmail}.`
      );
    } finally {
      submit.disabled = false;
      submit.innerHTML = submitLabel;
    }
  });
})();
