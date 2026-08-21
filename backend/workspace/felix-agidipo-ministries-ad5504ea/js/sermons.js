/* ==========================================================================
   Rev. Felix Agidipo Ministries — Sermon Library
   Search, filter, sort, and YouTube facade-embed rendering.
   Reacts to localStorage changes pushed from admin.html in real time.
   ========================================================================== */

(function () {
  "use strict";

  const state = {
    all: [],
    filtered: [],
    query: "",
    series: "all",
    speaker: "all",
    sort: "newest",
    visibleCount: 9,
    pageSize: 9,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.grid = document.getElementById("sermons-grid");
    if (!els.grid) return; // not on sermons page

    els.search = document.getElementById("sermon-search");
    els.seriesFilter = document.getElementById("sermon-series-filter");
    els.speakerFilter = document.getElementById("sermon-speaker-filter");
    els.sort = document.getElementById("sermon-sort");
    els.empty = document.getElementById("sermons-empty");
    els.count = document.getElementById("sermons-count");
    els.loadMore = document.getElementById("load-more-sermons");
    els.modal = document.getElementById("sermon-modal");
    els.modalBody = document.getElementById("sermon-modal-body");
    els.modalClose = document.getElementById("sermon-modal-close");

    loadData();
    buildFilterOptions();
    bindEvents();
    applyFilters();

    // Real-time sync: admin panel writes to localStorage in another tab/view
    window.addEventListener("storage", (e) => {
      if (!e.key || e.key === getKey()) {
        loadData();
        buildFilterOptions();
        applyFilters();
      }
    });
    // Same-tab custom event (admin.html dispatches this after saving)
    window.addEventListener("fam:dataUpdated", (e) => {
      if (!e.detail || e.detail.key === getKey()) {
        loadData();
        buildFilterOptions();
        applyFilters();
      }
    });
  }

  function getKey() {
    if (window.FAM && window.FAM.KEYS && window.FAM.KEYS.SERMONS) {
      return window.FAM.KEYS.SERMONS;
    }
    return "fam_sermons";
  }

  function loadData() {
    let records = [];
    try {
      if (window.FAM && typeof window.FAM.getSermons === "function") {
        records = window.FAM.getSermons() || [];
      } else {
        const raw = localStorage.getItem(getKey());
        records = raw ? JSON.parse(raw) : [];
      }
    } catch (err) {
      console.warn("Sermon data could not be loaded:", err);
      records = [];
    }

    if (!Array.isArray(records) || records.length === 0) {
      records = fallbackSermons();
    }

    state.all = records
      .filter((s) => s && (s.published === undefined || s.published !== false))
      .map(normalizeSermon)
      .sort((a, b) => b.dateValue - a.dateValue);
  }

  function normalizeSermon(s) {
    const dateValue = s.date ? Date.parse(s.date) : 0;
    return {
      id: s.id || cryptoId(),
      title: s.title || "Untitled Message",
      speaker: s.speaker || "Rev. Felix Agidipo",
      series: s.series || "Standalone",
      date: s.date || "",
      dateValue: isNaN(dateValue) ? 0 : dateValue,
      scripture: s.scripture || "",
      description: s.description || "",
      youtubeId: extractYouTubeId(s.youtubeId || s.youtubeUrl || s.video || ""),
      tags: Array.isArray(s.tags) ? s.tags : [],
      duration: s.duration || "",
      featured: !!s.featured,
    };
  }

  function extractYouTubeId(input) {
    if (!input) return "";
    if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/,
      /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
      /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    ];
    for (const re of patterns) {
      const m = input.match(re);
      if (m) return m[1];
    }
    return "";
  }

  function fallbackSermons() {
    return [
      {
        id: "s1",
        title: "Sunrise Over the Valley of Dry Bones",
        speaker: "Rev. Felix Agidipo",
        series: "The Breaking Dawn",
        date: "2024-05-19",
        scripture: "Ezekiel 37:1-14",
        description:
          "A message on how the light of God's word revives what looks dead — resurrection hope for weary seasons.",
        youtubeId: "dQw4w9WgXcQ",
        tags: ["Hope", "Restoration"],
        duration: "48 min",
        featured: true,
      },
      {
        id: "s2",
        title: "Beams Through the Storm",
        speaker: "Pastor Grace Adeyemi",
        series: "The Breaking Dawn",
        date: "2024-04-21",
        scripture: "Mark 4:35-41",
        description:
          "When faith feels small against a raging sea, the light still breaks through the clouds.",
        youtubeId: "3JZ_D3ELwOQ",
        tags: ["Faith", "Peace"],
        duration: "41 min",
        featured: false,
      },
      {
        id: "s3",
        title: "The Gospel at First Light",
        speaker: "Rev. Felix Agidipo",
        series: "Foundations",
        date: "2024-03-03",
        scripture: "John 1:1-14",
        description: "Returning to the first light of the gospel — the Word made flesh among us.",
        youtubeId: "eY52Zsg-KVI",
        tags: ["Gospel", "Foundations"],
        duration: "52 min",
        featured: false,
      },
    ];
  }

  function cryptoId() {
    return "sm_" + Math.random().toString(36).slice(2, 10);
  }

  function buildFilterOptions() {
    if (els.seriesFilter) {
      const series = uniqueSorted(state.all.map((s) => s.series));
      fillSelect(els.seriesFilter, series, state.series);
    }
    if (els.speakerFilter) {
      const speakers = uniqueSorted(state.all.map((s) => s.speaker));
      fillSelect(els.speakerFilter, speakers, state.speaker);
    }
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(select, values, current) {
    const prior = select.value || current;
    select.innerHTML = '<option value="all">All</option>';
    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    if (values.includes(prior)) select.value = prior;
  }

  function bindEvents() {
    if (els.search) {
      els.search.addEventListener("input", debounce(() => {
        state.query = els.search.value.trim().toLowerCase();
        state.visibleCount = state.pageSize;
        applyFilters();
      }, 180));
    }
    if (els.seriesFilter) {
      els.seriesFilter.addEventListener("change", () => {
        state.series = els.seriesFilter.value;
        state.visibleCount = state.pageSize;
        applyFilters();
      });
    }
    if (els.speakerFilter) {
      els.speakerFilter.addEventListener("change", () => {
        state.speaker = els.speakerFilter.value;
        state.visibleCount = state.pageSize;
        applyFilters();
      });
    }
    if (els.sort) {
      els.sort.addEventListener("change", () => {
        state.sort = els.sort.value;
        applyFilters();
      });
    }
    if (els.loadMore) {
      els.loadMore.addEventListener("click", () => {
        state.visibleCount += state.pageSize;
        render();
      });
    }

    els.grid.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-play]");
      if (trigger) openModal(trigger.getAttribute("data-play"), trigger.getAttribute("data-title"));
    });
    els.grid.addEventListener("keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const trigger = e.target.closest("[data-play]");
        if (trigger) openModal(trigger.getAttribute("data-play"), trigger.getAttribute("data-title"));
      }
    });

    if (els.modalClose) els.modalClose.addEventListener("click", closeModal);
    if (els.modal) {
      els.modal.addEventListener("click", (e) => {
        if (e.target === els.modal) closeModal();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.modal && els.modal.classList.contains("is-open")) {
        closeModal();
      }
    });
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  function applyFilters() {
    let list = state.all.slice();

    if (state.series !== "all") {
      list = list.filter((s) => s.series === state.series);
    }
    if (state.speaker !== "all") {
      list = list.filter((s) => s.speaker === state.speaker);
    }
    if (state.query) {
      list = list.filter((s) => {
        const haystack = [s.title, s.speaker, s.series, s.scripture, s.description, s.tags.join(" ")]
          .join(" ")
          .toLowerCase();
        return haystack.includes(state.query);
      });
    }

    switch (state.sort) {
      case "oldest":
        list.sort((a, b) => a.dateValue - b.dateValue);
        break;
      case "title":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "newest":
      default:
        list.sort((a, b) => b.dateValue - a.dateValue);
    }

    state.filtered = list;
    render();
  }

  function render() {
    const visible = state.filtered.slice(0, state.visibleCount);

    if (els.count) {
      els.count.textContent = state.filtered.length
        ? `${state.filtered.length} message${state.filtered.length === 1 ? "" : "s"} found`
        : "";
    }

    if (!visible.length) {
      els.grid.innerHTML = "";
      if (els.empty) els.empty.hidden = false;
      if (els.loadMore) els.loadMore.hidden = true;
      return;
    }
    if (els.empty) els.empty.hidden = true;

    els.grid.innerHTML = visible.map(cardTemplate).join("");

    if (els.loadMore) {
      els.loadMore.hidden = state.visibleCount >= state.filtered.length;
    }
  }

  function cardTemplate(s) {
    const dateLabel = s.date
      ? new Date(s.dateValue || Date.now()).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "";
    const thumb = s.youtubeId
      ? `https://img.youtube.com/vi/${s.youtubeId}/hqdefault.jpg`
      : "";
    const tags = s.tags
      .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
      .join("");

    return `
      <article class="beam-card sermon-card${s.featured ? " sermon-card--featured" : ""}">
        <div class="sermon-card__media">
          ${
            s.youtubeId
              ? `<button type="button" class="video-facade" data-play="${s.youtubeId}" data-title="${escapeAttr(s.title)}" aria-label="Play sermon: ${escapeAttr(s.title)}">
                  <img src="${thumb}" alt="" loading="lazy" width="480" height="270">
                  <span class="video-facade__play" aria-hidden="true">▶</span>
                  ${s.duration ? `<span class="video-facade__duration">${escapeHtml(s.duration)}</span>` : ""}
                </button>`
              : `<div class="video-facade video-facade--empty" aria-hidden="true"><span>No video linked</span></div>`
          }
        </div>
        <div class="sermon-card__body">
          <p class="sermon-card__meta">${escapeHtml(s.series)} ${dateLabel ? "· " + dateLabel : ""}</p>
          <h3 class="sermon-card__title">${escapeHtml(s.title)}</h3>
          ${s.scripture ? `<p class="sermon-card__scripture">${escapeHtml(s.scripture)}</p>` : ""}
          <p class="sermon-card__desc">${escapeHtml(s.description)}</p>
          <p class="sermon-card__speaker">${escapeHtml(s.speaker)}</p>
          ${tags ? `<div class="chip-row">${tags}</div>` : ""}
        </div>
      </article>`;
  }

  function openModal(youtubeId, title) {
    if (!els.modal || !els.modalBody || !youtubeId) return;
    els.modalBody.innerHTML = `
      <iframe
        src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0"
        title="${escapeAttr(title || "Sermon video")}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>`;
    els.modal.classList.add("is-open");
    els.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (els.modalClose) els.modalClose.focus();
  }

  function closeModal() {
    if (!els.modal) return;
    els.modal.classList.remove("is-open");
    els.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (els.modalBody) els.modalBody.innerHTML = "";
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/`/g, "&#96;");
  }
})();