/* ============================================================================
   Rev. Felix Agidipo Ministries — js/events.js
   Renders the Upcoming / Past events split on events.html, wires up
   category filtering, share-link actions and a live "auto-refresh" so
   items published from admin.html appear without a page reload.

   Expected markup hooks on events.html:
     <div id="upcomingGrid"></div>          -> upcoming event cards
     <p   id="upcomingEmpty" hidden>…</p>    -> shown when no upcoming events
     <div id="pastGrid"></div>              -> past event cards
     <p   id="pastEmpty" hidden>…</p>        -> shown when no past events
     <div data-event-filters>
       <button data-event-filter="all" class="is-active">All</button>
       <button data-event-filter="crusade">Crusades</button>
       ...
     </div>
   Storage: reads/writes localStorage key "rfam_events" (array of event
   objects). If js/data.js has already exposed window.RFAM.getCollection,
   that is used instead so admin.html edits stay in sync everywhere.
   ============================================================================ */

(function (window, document) {
  "use strict";

  var STORAGE_KEY = "rfam_events";
  var UPDATE_EVENT = "rfam-data-updated";

  var DEFAULT_EVENTS = [
    {
      id: "ev-anniversary-2025",
      title: "Ministry Anniversary Thanksgiving Service",
      category: "anniversary",
      date: "2025-11-16",
      time: "09:00",
      location: "Gospel Light Cathedral, Ikeja, Lagos",
      excerpt: "A special service of gratitude marking another year of God's faithfulness to the ministry.",
      description: "Join Rev. Felix Agidipo and the entire church family for a morning of worship, testimonies and the Word as we celebrate what the Lord has done. Guests and choirs from partner churches will be joining us.",
      image: "assets/events/anniversary.jpg",
      featured: true
    },
    {
      id: "ev-conference-light",
      title: "Light Breaking Through Conference",
      category: "conference",
      date: "2025-09-05",
      time: "17:00",
      location: "Faith Convention Centre, Abuja",
      excerpt: "Three nights of teaching on walking in revelation light in a shifting season.",
      description: "A three-day gathering for believers hungry for depth — nightly sessions of teaching, prayer and impartation with Rev. Felix Agidipo and guest ministers.",
      image: "assets/events/conference.jpg",
      featured: false
    },
    {
      id: "ev-outreach-ikorodu",
      title: "Community Outreach & Medical Mission",
      category: "outreach",
      date: "2025-08-02",
      time: "08:30",
      location: "Ikorodu Township Field, Lagos",
      excerpt: "Free medical checks, food distribution and an open-air gospel crusade.",
      description: "Our compassion ministry partners with local health workers to serve the Ikorodu community with free basic medical screening, food packs and an evening crusade.",
      image: "assets/events/outreach.jpg",
      featured: false
    },
    {
      id: "ev-crusade-benin",
      title: "Arise & Shine Citywide Crusade",
      category: "crusade",
      date: "2025-03-14",
      time: "18:00",
      location: "Ogbe Stadium Grounds, Benin City",
      excerpt: "A four-night citywide crusade calling a generation back to the light.",
      description: "Rev. Felix Agidipo ministers to thousands across four nights in Benin City, believing God for salvation, healing and restoration testimonies.",
      image: "assets/events/crusade.jpg",
      featured: false
    },
    {
      id: "ev-newyear-2025",
      title: "Watchnight & New Year Communion Service",
      category: "conference",
      date: "2024-12-31",
      time: "22:00",
      location: "Gospel Light Cathedral, Ikeja, Lagos",
      excerpt: "Crossing over in prayer, thanksgiving and Holy Communion.",
      description: "We closed the year in prayer and worship, and welcomed a new season with prophetic declarations and the Lord's Table.",
      image: "assets/events/watchnight.jpg",
      featured: false
    }
  ];

  var CATEGORY_LABELS = {
    crusade: "Crusade",
    conference: "Conference",
    outreach: "Outreach",
    anniversary: "Anniversary"
  };

  /* ---------------------------- data access ---------------------------- */

  function readEvents() {
    if (window.RFAM && typeof window.RFAM.getCollection === "function") {
      var fromStore = window.RFAM.getCollection("events");
      if (Array.isArray(fromStore) && fromStore.length) return fromStore;
    }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (err) {
      console.warn("events.js: could not read localStorage, using defaults.", err);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_EVENTS));
    } catch (err) { /* private mode / quota — ignore */ }
    return DEFAULT_EVENTS.slice();
  }

  function eventDateTime(ev) {
    var t = ev.time || "00:00";
    return new Date(ev.date + "T" + t + ":00");
  }

  /* ------------------------------ helpers ------------------------------ */

  function formatDate(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }

  function formatTime(timeStr) {
    if (!timeStr) return "";
    var parts = timeStr.split(":");
    var h = parseInt(parts[0], 10);
    var m = parts[1] || "00";
    var suffix = h >= 12 ? "PM" : "AM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + m + " " + suffix;
  }

  function eventUrl(ev) {
    return window.location.origin + window.location.pathname + "#event-" + ev.id;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toIcsDate(ev) {
    var dt = eventDateTime(ev);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) + "T" +
      pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + "00Z";
  }

  function buildIcsHref(ev) {
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RFAM//Events//EN",
      "BEGIN:VEVENT",
      "UID:" + ev.id + "@rfaministries.org",
      "DTSTAMP:" + toIcsDate(ev),
      "DTSTART:" + toIcsDate(ev),
      "SUMMARY:" + (ev.title || "").replace(/\n/g, " "),
      "LOCATION:" + (ev.location || "").replace(/\n/g, " "),
      "DESCRIPTION:" + (ev.excerpt || "").replace(/\n/g, " "),
      "END:VEVENT", "END:VCALENDAR"
    ];
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
  }

  /* ------------------------------ rendering ----------------------------- */

  function cardMarkup(ev, isPast) {
    var url = eventUrl(ev);
    var label = CATEGORY_LABELS[ev.category] || "Event";
    var img = ev.image
      ? '<img src="' + escapeHtml(ev.image) + '" alt="" loading="lazy" class="event-card__img">'
      : '<div class="event-card__img event-card__img--beam" aria-hidden="true"></div>';

    return (
      '<article id="event-' + escapeHtml(ev.id) + '" class="event-card beam-card' +
      (isPast ? " event-card--past" : "") + (ev.featured ? " event-card--featured" : "") +
      '" data-category="' + escapeHtml(ev.category) + '">' +
        '<div class="event-card__media">' + img +
          '<span class="event-card__tag">' + escapeHtml(label) + '</span>' +
        '</div>' +
        '<div class="event-card__body">' +
          '<p class="event-card__date">' + formatDate(ev.date) + (ev.time ? " &bull; " + formatTime(ev.time) : "") + '</p>' +
          '<h3 class="event-card__title">' + escapeHtml(ev.title) + '</h3>' +
          '<p class="event-card__location">' + escapeHtml(ev.location) + '</p>' +
          '<p class="event-card__excerpt">' + escapeHtml(ev.excerpt) + '</p>' +
          '<div class="event-card__actions">' +
            (isPast ? "" :
              '<a class="btn btn--ghost btn--sm" download="' + escapeHtml(ev.id) + '.ics" href="' + buildIcsHref(ev) + '">Add to Calendar</a>'
            ) +
            '<div class="share-group" data-share role="group" aria-label="Share this event">' +
              '<button type="button" class="share-btn" data-share-action="native" data-url="' + escapeHtml(url) + '" data-title="' + escapeHtml(ev.title) + '" aria-label="Share">Share</button>' +
              '<a class="share-btn" target="_blank" rel="noopener" aria-label="Share on Facebook" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) + '">FB</a>' +
              '<a class="share-btn" target="_blank" rel="noopener" aria-label="Share on X" href="https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(ev.title) + '">X</a>' +
              '<a class="share-btn" target="_blank" rel="noopener" aria-label="Share on WhatsApp" href="https://wa.me/?text=' + encodeURIComponent(ev.title + " — " + url) + '">WA</a>' +
              '<button type="button" class="share-btn share-btn--copy" data-share-action="copy" data-url="' + escapeHtml(url) + '" aria-label="Copy link">Copy Link</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function render(activeFilter) {
    var upcomingGrid = document.getElementById("upcomingGrid");
    var pastGrid = document.getElementById("pastGrid");
    if (!upcomingGrid && !pastGrid) return;

    var events = readEvents().filter(function (ev) { return ev && ev.date; });
    var now = new Date();
    var filter = activeFilter || "all";

    var upcoming = events
      .filter(function (ev) { return eventDateTime(ev) >= now; })
      .sort(function (a, b) { return eventDateTime(a) - eventDateTime(b); });

    var past = events
      .filter(function (ev) { return eventDateTime(ev) < now; })
      .sort(function (a, b) { return eventDateTime(b) - eventDateTime(a); });

    if (filter !== "all") {
      upcoming = upcoming.filter(function (ev) { return ev.category === filter; });
      past = past.filter(function (ev) { return ev.category === filter; });
    }

    if (upcomingGrid) {
      upcomingGrid.innerHTML = upcoming.map(function (ev) { return cardMarkup(ev, false); }).join("");
      var upcomingEmpty = document.getElementById("upcomingEmpty");
      if (upcomingEmpty) upcomingEmpty.hidden = upcoming.length > 0;
    }

    if (pastGrid) {
      pastGrid.innerHTML = past.map(function (ev) { return cardMarkup(ev, true); }).join("");
      var pastEmpty = document.getElementById("pastEmpty");
      if (pastEmpty) pastEmpty.hidden = past.length > 0;
    }

    if (window.location.hash) {
      var target = document.querySelector(window.location.hash);
      if (target && typeof target.scrollIntoView === "function") {
        window.setTimeout(function () {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      }
    }
  }

  /* -------------------------- share interactions ------------------------- */

  function handleShareClick(evt) {
    var btn = evt.target.closest("[data-share-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-share-action");
    var url = btn.getAttribute("data-url");

    if (action === "native") {
      var title = btn.getAttribute("data-title") || "RFAM Event";
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { flashLabel(btn, "Link Copied"); });
      }
      return;
    }

    if (action === "copy") {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { flashLabel(btn, "Copied!"); });
      } else {
        var temp = document.createElement("textarea");
        temp.value = url;
        document.body.appendChild(temp);
        temp.select();
        try { document.execCommand("copy"); flashLabel(btn, "Copied!"); } catch (e) {}
        document.body.removeChild(temp);
      }
    }
  }

  function flashLabel(btn, text) {
    var original = btn.textContent;
    btn.textContent = text;
    btn.classList.add("share-btn--done");
    window.setTimeout(function () {
      btn.textContent = original;
      btn.classList.remove("share-btn--done");
    }, 1600);
  }

  /* --------------------------------- filters ------------------------------ */

  function initFilters() {
    var group = document.querySelector("[data-event-filters]");
    if (!group) return;
    group.addEventListener("click", function (evt) {
      var btn = evt.target.closest("[data-event-filter]");
      if (!btn) return;
      group.querySelectorAll("[data-event-filter]").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      render(btn.getAttribute("data-event-filter"));
    });
  }

  function currentFilter() {
    var active = document.querySelector("[data-event-filters] .is-active");
    return active ? active.getAttribute("data-event-filter") : "all";
  }

  /* ------------------------------- live sync ------------------------------ */

  function initLiveSync() {
    window.addEventListener("storage", function (evt) {
      if (evt.key === STORAGE_KEY) render(currentFilter());
    });
    window.addEventListener(UPDATE_EVENT, function (evt) {
      if (!evt.detail || evt.detail.collection === "events") render(currentFilter());
    });
  }

  /* --------------------------------- init ---------------------------------- */

  function init() {
    if (!document.getElementById("upcomingGrid") && !document.getElementById("pastGrid")) return;
    initFilters();
    render("all");
    document.addEventListener("click", handleShareClick);
    initLiveSync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.RFAM = window.RFAM || {};
  window.RFAM.Events = { render: render, readEvents: readEvents };
})(window, document);