/* ==========================================================================
   Rev. Felix Agidipo Ministries — main.js
   Navigation, entrance animations, homepage rendering, global search
   Expects window.MinistryData (js/data.js) exposing:
     init(), getActivities(), getEvents(), getSermons(), getGallery(), getNews()
   ========================================================================== */

(function () {
  "use strict";

  const $  = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  const Data = window.MinistryData || null;
  if (Data && typeof Data.init === "function") Data.init();

  /* ---------------------------------------------------------------------
     Helpers
     --------------------------------------------------------------------- */

  function fmtDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + (dateStr.length <= 10 ? "T00:00:00" : ""));
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
  }

  function truncate(str, n) {
    if (!str) return "";
    return str.length > n ? str.slice(0, n).trim() + "…" : str;
  }

  function safeArr(fn) {
    try {
      const v = Data && typeof Data[fn] === "function" ? Data[fn]() : [];
      return Array.isArray(v) ? v : [];
    } catch (e) {
      console.warn("MinistryData." + fn + " failed:", e);
      return [];
    }
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* ---------------------------------------------------------------------
     Navigation / hamburger menu
     --------------------------------------------------------------------- */

  function initNav() {
    const toggle = $(".nav-toggle");
    const menu = $("#primary-menu");
    const header = $(".site-header");
    if (!toggle || !menu) return;

    const closeMenu = () => {
      menu.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("nav-open");
    };
    const openMenu = () => {
      menu.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("nav-open");
    };

    toggle.addEventListener("click", () => {
      menu.classList.contains("is-open") ? closeMenu() : openMenu();
    });

    $$("a", menu).forEach((a) =>
      a.addEventListener("click", () => {
        if (window.innerWidth < 900) closeMenu();
      })
    );

    document.addEventListener("click", (e) => {
      if (
        menu.classList.contains("is-open") &&
        !menu.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.classList.contains("is-open")) {
        closeMenu();
        toggle.focus();
      }
    });

    // Shrink header on scroll
    if (header) {
      let lastY = window.scrollY;
      window.addEventListener(
        "scroll",
        () => {
          const y = window.scrollY;
          header.classList.toggle("is-scrolled", y > 24);
          lastY = y;
        },
        { passive: true }
      );
    }

    // Mark current page in nav
    const path = location.pathname.split("/").pop() || "index.html";
    $$(".nav-menu a").forEach((a) => {
      const href = a.getAttribute("href");
      if (href === path || (path === "" && href === "index.html")) {
        a.setAttribute("aria-current", "page");
      }
    });
  }

  /* ---------------------------------------------------------------------
     Entrance animations (scroll reveal)
     --------------------------------------------------------------------- */

  function initReveal() {
    const targets = $$(".reveal, .beam-card, .section-head, .stat-item");
    if (!targets.length) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      targets.forEach((t) => t.classList.add("in-view"));
      return;
    }

    targets.forEach((t, i) => {
      if (!t.style.transitionDelay) {
        t.style.transitionDelay = Math.min(i % 6, 5) * 70 + "ms";
      }
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    targets.forEach((t) => io.observe(t));
  }

  /* ---------------------------------------------------------------------
     Homepage rendering
     --------------------------------------------------------------------- */

  function renderHomeSermon() {
    const mount = $("#home-sermon-feed");
    if (!mount) return;
    const sermons = safeArr("getSermons").sort((a, b) => new Date(b.date) - new Date(a.date));
    const latest = sermons[0];
    if (!latest) {
      mount.innerHTML = '<p class="empty-note">New sermons are on the way. Please check back soon.</p>';
      return;
    }
    mount.innerHTML = "";
    mount.appendChild(
      el(`
      <article class="beam-card sermon-feature reveal">
        <div class="beam-card__corner" aria-hidden="true"></div>
        <p class="eyebrow">Latest Word</p>
        <h3>${escapeHtml(latest.title)}</h3>
        <p class="meta">${escapeHtml(latest.speaker || "Rev. Felix Agidipo")} · ${fmtDate(latest.date)}${latest.scripture ? " · " + escapeHtml(latest.scripture) : ""}</p>
        <p>${escapeHtml(truncate(latest.summary || "", 180))}</p>
        <a class="link-arrow" href="sermons.html">Listen to this message →</a>
      </article>
    `)
    );
  }

  function renderHomeEvents() {
    const mount = $("#home-events-feed");
    if (!mount) return;
    const today = new Date().setHours(0, 0, 0, 0);
    const events = safeArr("getEvents")
      .filter((e) => new Date(e.date).setHours(0, 0, 0, 0) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3);

    mount.innerHTML = "";
    if (!events.length) {
      mount.innerHTML = '<p class="empty-note">No upcoming events scheduled at this time.</p>';
      return;
    }
    events.forEach((ev) => {
      mount.appendChild(
        el(`
        <article class="beam-card event-card reveal">
          <div class="beam-card__corner" aria-hidden="true"></div>
          <p class="date-tag">${fmtDate(ev.date)}${ev.time ? " · " + escapeHtml(ev.time) : ""}</p>
          <h3>${escapeHtml(ev.title)}</h3>
          <p class="meta">${escapeHtml(ev.location || "Main Auditorium")}</p>
          <p>${escapeHtml(truncate(ev.description || "", 110))}</p>
          <a class="link-arrow" href="events.html">Details →</a>
        </article>
      `)
      );
    });
  }

  function renderHomeActivities() {
    const mount = $("#home-activities-feed");
    if (!mount) return;
    const activities = safeArr("getActivities").slice(0, 3);
    mount.innerHTML = "";
    if (!activities.length) {
      mount.innerHTML = '<p class="empty-note">Ministry activities will be listed here soon.</p>';
      return;
    }
    activities.forEach((a) => {
      mount.appendChild(
        el(`
        <article class="beam-card reveal">
          <div class="beam-card__corner" aria-hidden="true"></div>
          <p class="eyebrow">${escapeHtml(a.category || "Outreach")}</p>
          <h3>${escapeHtml(a.title)}</h3>
          <p>${escapeHtml(truncate(a.summary || "", 120))}</p>
          <a class="link-arrow" href="activities.html">Read more →</a>
        </article>
      `)
      );
    });
  }

  function renderHomeGallery() {
    const mount = $("#home-gallery-feed");
    if (!mount) return;
    const images = safeArr("getGallery").slice(0, 6);
    mount.innerHTML = "";
    if (!images.length) {
      mount.innerHTML = '<p class="empty-note">Gallery moments coming soon.</p>';
      return;
    }
    images.forEach((g) => {
      mount.appendChild(
        el(`
        <a class="gallery-thumb reveal" href="gallery.html" aria-label="${escapeHtml(g.title || "Gallery image")}">
          <img src="${escapeHtml(g.image)}" alt="${escapeHtml(g.title || "")}" loading="lazy">
        </a>
      `)
      );
    });
  }

  function renderHomeNews() {
    const mount = $("#home-news-feed");
    if (!mount) return;
    const news = safeArr("getNews")
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 3);
    mount.innerHTML = "";
    if (!news.length) {
      mount.innerHTML = '<p class="empty-note">No news posted yet.</p>';
      return;
    }
    news.forEach((n) => {
      mount.appendChild(
        el(`
        <article class="beam-card news-card reveal">
          <div class="beam-card__corner" aria-hidden="true"></div>
          <p class="date-tag">${fmtDate(n.date)}</p>
          <h3>${escapeHtml(n.title)}</h3>
          <p>${escapeHtml(truncate(n.excerpt || n.body || "", 120))}</p>
          <a class="link-arrow" href="news.html">Read story →</a>
        </article>
      `)
      );
    });
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderHome() {
    renderHomeSermon();
    renderHomeEvents();
    renderHomeActivities();
    renderHomeGallery();
    renderHomeNews();
  }

  /* ---------------------------------------------------------------------
     Global search
     --------------------------------------------------------------------- */

  function buildIndex() {
    const idx = [];
    safeArr("getSermons").forEach((s) =>
      idx.push({
        type: "Sermon",
        title: s.title,
        blurb: s.scripture || s.speaker || "",
        href: "sermons.html",
        date: s.date,
      })
    );
    safeArr("getEvents").forEach((e) =>
      idx.push({
        type: "Event",
        title: e.title,
        blurb: fmtDate(e.date) + (e.location ? " · " + e.location : ""),
        href: "events.html",
        date: e.date,
      })
    );
    safeArr("getActivities").forEach((a) =>
      idx.push({
        type: "Activity",
        title: a.title,
        blurb: a.category || "",
        href: "activities.html",
        date: a.date,
      })
    );
    safeArr("getNews").forEach((n) =>
      idx.push({
        type: "News",
        title: n.title,
        blurb: fmtDate(n.date),
        href: "news.html",
        date: n.date,
      })
    );
    safeArr("getGallery").forEach((g) =>
      idx.push({
        type: "Gallery",
        title: g.title || "Photo",
        blurb: g.category || "",
        href: "gallery.html",
        date: g.date,
      })
    );
    return idx;
  }

  function initSearch() {
    const form = $("#site-search-form");
    const input = $("#site-search-input");
    const results = $("#site-search-results");
    if (!form || !input || !results) return;

    let index = buildIndex();
    let activeIndex = -1;

    function closeResults() {
      results.innerHTML = "";
      results.hidden = true;
      activeIndex = -1;
    }

    function renderResults(list) {
      results.innerHTML = "";
      if (!list.length) {
        results.hidden = false;
        results.appendChild(el('<p class="search-empty">No matches found. Try a different word.</p>'));
        return;
      }
      list.slice(0, 8).forEach((item, i) => {
        const a = el(`
          <a class="search-result" href="${item.href}" role="option" data-index="${i}">
            <span class="search-result__type">${escapeHtml(item.type)}</span>
            <span class="search-result__title">${escapeHtml(item.title)}</span>
            <span class="search-result__blurb">${escapeHtml(item.blurb)}</span>
          </a>
        `);
        results.appendChild(a);
      });
      results.hidden = false;
    }

    function runSearch(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        closeResults();
        return;
      }
      const matches = index.filter((item) =>
        (item.title + " " + item.blurb + " " + item.type).toLowerCase().includes(q)
      );
      renderResults(matches);
    }

    input.addEventListener("input", (e) => runSearch(e.target.value));

    input.addEventListener("focus", () => {
      index = buildIndex();
      if (input.value.trim()) runSearch(input.value);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const first = $(".search-result", results);
      if (first) window.location.href = first.getAttribute("href");
    });

    input.addEventListener("keydown", (e) => {
      const items = $$(".search-result", results);
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        items[activeIndex].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        items[activeIndex].focus();
      } else if (e.key === "Escape") {
        closeResults();
      }
    });

    document.addEventListener("click", (e) => {
      if (!form.contains(e.target)) closeResults();
    });
  }

  /* ---------------------------------------------------------------------
     Cross-tab live updates (admin panel writes to localStorage)
     --------------------------------------------------------------------- */

  function initLiveSync() {
    window.addEventListener("storage", (e) => {
      if (!e.key || !e.key.startsWith("fam_")) return;
      renderHome();
      const banner = $("#live-update-banner");
      if (banner) {
        banner.hidden = false;
        banner.classList.add("is-visible");
        clearTimeout(initLiveSync._t);
        initLiveSync._t = setTimeout(() => banner.classList.remove("is-visible"), 4000);
      }
    });
  }

  /* ---------------------------------------------------------------------
     Footer year stamp
     --------------------------------------------------------------------- */

  function stampYear() {
    $$("[data-year]").forEach((n) => (n.textContent = new Date().getFullYear()));
  }

  /* ---------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */

  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    stampYear();
    renderHome();
    initSearch();
    initReveal();
    initLiveSync();
  });
})();