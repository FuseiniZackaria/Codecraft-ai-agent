/* ============================================================
   Rev. Felix Agidipo Ministries — Activities
   Category filter + newest/oldest sort for the Activities page.
   Reads/writes the shared "facm_activities" localStorage collection
   so that changes made in admin.html are reflected here live.
   ============================================================ */

(function () {
  "use strict";

  var STORAGE_KEY = "facm_activities";
  var EVENT_NAME = "facm:activities:updated";

  var CATEGORY_ACCENTS = {
    "Outreach": "#D9A63F",
    "Youth Ministry": "#1E6F54",
    "Discipleship": "#7C1F2E",
    "Missions": "#D9A63F",
    "Community Development": "#1E6F54",
    "Women's Fellowship": "#7C1F2E",
    "Men's Fellowship": "#161A3A",
    "Prison Ministry": "#8A8578"
  };

  var DEFAULT_ACTIVITIES = [
    {
      id: "act-01",
      title: "Light in the City: Street Outreach",
      category: "Outreach",
      date: "2024-01-13",
      location: "Ojota Market, Lagos",
      description: "Volunteers carried food parcels, prayer, and the gospel message directly into the marketplace, reaching over 400 traders and commuters."
    },
    {
      id: "act-02",
      title: "Sunrise Youth Camp",
      category: "Youth Ministry",
      date: "2024-03-22",
      location: "Ministry Retreat Grounds, Epe",
      description: "A three-day residential camp forming young disciples through mentorship, worship, and practical service projects."
    },
    {
      id: "act-03",
      title: "Widows' Table Fellowship",
      category: "Community Development",
      date: "2023-11-04",
      location: "Fellowship Hall, Ikeja",
      description: "A monthly gathering providing meals, financial support, and companionship to widows within the congregation and wider community."
    },
    {
      id: "act-04",
      title: "Behind the Walls Prison Visitation",
      category: "Prison Ministry",
      date: "2023-09-16",
      location: "Kirikiri Correctional Centre",
      description: "Chaplaincy team delivered scripture teaching, counsel, and care packages to inmates as part of an ongoing restoration ministry."
    },
    {
      id: "act-05",
      title: "Deeper Life Discipleship Cohort",
      category: "Discipleship",
      date: "2024-02-05",
      location: "Online & Main Auditorium",
      description: "A ten-week structured study walking new believers from foundational doctrine into active service within the church body."
    },
    {
      id: "act-06",
      title: "Cross the Border Missions Trip",
      category: "Missions",
      date: "2023-07-29",
      location: "Republic of Benin",
      description: "A cross-cultural missions team planted a satellite fellowship and trained twelve local leaders over two weeks."
    },
    {
      id: "act-07",
      title: "Daughters of Zion Conference",
      category: "Women's Fellowship",
      date: "2024-04-18",
      location: "Grace Convention Centre",
      description: "An annual gathering of women across generations for teaching, testimony, and commissioning into ministry roles."
    },
    {
      id: "act-08",
      title: "Men of Valor Retreat",
      category: "Men's Fellowship",
      date: "2023-10-07",
      location: "Riverside Camp, Abeokuta",
      description: "A weekend of rugged fellowship, accountability groups, and teaching on biblical leadership in the home and workplace."
    }
  ];

  /* ---------- storage helpers ---------- */

  function readActivities() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) {
      seed();
      return DEFAULT_ACTIVITIES.slice();
    }
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : DEFAULT_ACTIVITIES.slice();
    } catch (e) {
      return DEFAULT_ACTIVITIES.slice();
    }
  }

  function seed() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_ACTIVITIES));
    } catch (e) { /* storage unavailable — degrade silently */ }
  }

  /* ---------- utilities ---------- */

  function formatDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function uniqueCategories(items) {
    var seen = {};
    var out = [];
    items.forEach(function (item) {
      if (item.category && !seen[item.category]) {
        seen[item.category] = true;
        out.push(item.category);
      }
    });
    return out.sort();
  }

  function escapeHTML(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- state ---------- */

  var state = {
    activeCategory: "All",
    sortOrder: "newest",
    items: []
  };

  var els = {};

  function findMount() {
    return document.getElementById("activities-app") ||
      document.querySelector("[data-activities-root]") ||
      document.getElementById("activities-grid") ||
      null;
  }

  /* ---------- render ---------- */

  function buildLayout(mount) {
    mount.innerHTML =
      '<div class="activities-controls" role="group" aria-label="Filter and sort activities">' +
        '<div class="activities-filters" id="activities-filters" role="group" aria-label="Filter by category"></div>' +
        '<div class="activities-sort">' +
          '<label for="activities-sort-select">Sort by</label>' +
          '<select id="activities-sort-select" class="activities-sort-select">' +
            '<option value="newest">Newest first</option>' +
            '<option value="oldest">Oldest first</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<p class="activities-count" id="activities-count" aria-live="polite"></p>' +
      '<div class="activities-grid beam-grid" id="activities-grid" role="list"></div>' +
      '<p class="activities-empty" id="activities-empty" hidden>No activities match this filter yet — check back soon, the light keeps moving.</p>';

    els.filters = mount.querySelector("#activities-filters");
    els.sortSelect = mount.querySelector("#activities-sort-select");
    els.grid = mount.querySelector("#activities-grid");
    els.empty = mount.querySelector("#activities-empty");
    els.count = mount.querySelector("#activities-count");
  }

  function renderFilters(categories) {
    var all = ["All"].concat(categories);
    els.filters.innerHTML = "";
    all.forEach(function (cat) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-pill" + (state.activeCategory === cat ? " is-active" : "");
      btn.textContent = cat;
      btn.setAttribute("aria-pressed", state.activeCategory === cat ? "true" : "false");
      btn.addEventListener("click", function () {
        state.activeCategory = cat;
        applyAndRender();
      });
      els.filters.appendChild(btn);
    });
  }

  function cardTemplate(item) {
    var accent = CATEGORY_ACCENTS[item.category] || "#D9A63F";
    return (
      '<article class="beam-card activity-card" role="listitem" style="--accent:' + accent + '">' +
        '<span class="beam-corner" aria-hidden="true"></span>' +
        '<div class="activity-media" aria-hidden="true">' +
          '<span class="activity-media-ray"></span>' +
          '<span class="activity-media-initial">' + escapeHTML((item.title || "?").charAt(0)) + '</span>' +
        '</div>' +
        '<div class="activity-body">' +
          '<span class="tag-pill" style="background:' + accent + '">' + escapeHTML(item.category) + '</span>' +
          '<h3 class="activity-title">' + escapeHTML(item.title) + '</h3>' +
          '<p class="activity-meta">' + escapeHTML(formatDate(item.date)) + (item.location ? " &middot; " + escapeHTML(item.location) : "") + '</p>' +
          '<p class="activity-desc">' + escapeHTML(item.description) + '</p>' +
        '</div>' +
      '</article>'
    );
  }

  function renderGrid(items) {
    if (!items.length) {
      els.grid.innerHTML = "";
      els.empty.hidden = false;
    } else {
      els.empty.hidden = true;
      els.grid.innerHTML = items.map(cardTemplate).join("");
    }
    els.count.textContent = items.length + (items.length === 1 ? " activity" : " activities") +
      (state.activeCategory !== "All" ? " in " + state.activeCategory : "");
  }

  function applyAndRender() {
    var filtered = state.items.filter(function (item) {
      return state.activeCategory === "All" || item.category === state.activeCategory;
    });

    filtered.sort(function (a, b) {
      var da = new Date(a.date).getTime();
      var db = new Date(b.date).getTime();
      return state.sortOrder === "newest" ? db - da : da - db;
    });

    renderFilters(uniqueCategories(state.items));
    renderGrid(filtered);
  }

  /* ---------- init & live sync ---------- */

  function refreshFromStorage() {
    state.items = readActivities();
    applyAndRender();
  }

  function init() {
    var mount = findMount();
    if (!mount) return;

    buildLayout(mount);

    els.sortSelect.value = state.sortOrder;
    els.sortSelect.addEventListener("change", function () {
      state.sortOrder = els.sortSelect.value;
      applyAndRender();
    });

    refreshFromStorage();

    // Reflect changes made in admin.html — either in another tab (storage
    // event) or the same tab via a custom dispatched event.
    window.addEventListener("storage", function (e) {
      if (e.key === STORAGE_KEY) refreshFromStorage();
    });
    window.addEventListener(EVENT_NAME, refreshFromStorage);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();