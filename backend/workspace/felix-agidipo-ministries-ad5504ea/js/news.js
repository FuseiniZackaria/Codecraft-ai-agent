/* ==========================================================================
   Rev. Felix Agidipo Ministries — News listing render & category filter
   Reads from the shared CMS layer (js/data.js / admin.js) when available,
   falls back to seeded content, and stays live-synced with the admin panel
   via the "storage" event (cross-tab) and a "cms:updated" custom event
   (same-tab, dispatched by js/admin.js after a save).
   ========================================================================== */

(function () {
  "use strict";

  const GRID_SEL = "#news-grid";
  const FEATURED_SEL = "#news-featured";
  const FILTER_SEL = "#news-filters";
  const SEARCH_SEL = "#news-search";
  const EMPTY_SEL = "#news-empty";
  const LOAD_MORE_SEL = "#news-load-more";
  const MODAL_SEL = "#news-modal";
  const PAGE_SIZE = 6;

  const TAG_COLORS = {
    "Church News": "var(--gold)",
    "Outreach": "var(--green)",
    "Testimonies": "var(--wine)",
    "Announcements": "var(--gold)",
    "Missions": "var(--green)",
    "Building Project": "var(--wine)",
  };

  const SEED_NEWS = [
    {
      id: "n-001",
      title: "Thousands Gather for the 2024 “Light of Nations” Crusade",
      category: "Outreach",
      date: "2024-11-17",
      author: "Ministry Press Desk",
      image: "",
      excerpt:
        "Over four nights on the Ilesa fairground, Rev. Felix Agidipo led a citywide crusade that drew record crowds, with hundreds responding to the altar call on the closing night.",
      body:
        "The 2024 edition of Light of Nations Crusade brought together believers from across Osun State and beyond for four nights of worship, teaching, and healing prayer. Rev. Felix Agidipo preached on the theme 'Arise, Shine' drawn from Isaiah 60, calling the church to carry gospel light into homes, marketplaces, and government. Ministry volunteers coordinated free medical screenings, a children's tent, and a resource table distributing Bibles and discipleship booklets. On the final night, an estimated 600 first-time decisions for Christ were recorded, and follow-up teams have since begun home-cell integration for new converts across twelve partner parishes.",
    },
    {
      id: "n-002",
      title: "Foundation Laid for New Sanctuary in Ile-Ife",
      category: "Building Project",
      date: "2024-09-02",
      author: "Building Committee",
      image: "",
      excerpt:
        "Ground was broken this month on a 1,200-seat worship centre that will serve as the ministry's second permanent home in Osun State.",
      body:
        "In a ceremony attended by community leaders, partner pastors, and hundreds of members, the ministry laid the foundation stone for its new Ile-Ife sanctuary. The building, projected for completion in phases over eighteen months, will house a 1,200-seat auditorium, a children's wing, and a community outreach hall. Rev. Felix Agidipo described the project as 'a house built not for a name, but for the harvest still coming.' Partnership giving toward the project remains open through the ministry's building fund, with quarterly progress updates to be shared here and at Sunday services.",
    },
    {
      id: "n-003",
      title: "Testimony: Healed After Eleven Years of Chronic Illness",
      category: "Testimonies",
      date: "2024-07-21",
      author: "Sister Deborah A.",
      image: "",
      excerpt:
        "A long-standing member shares her journey from a decade-long diagnosis to complete healing following the ministry's monthly healing service.",
      body:
        "Sister Deborah Adeyemi had lived with a chronic kidney condition for eleven years, cycling through hospitals across three states. During the ministry's monthly Wednesday healing service, she came forward for prayer during a session led by Rev. Felix Agidipo on faith and persistent believing. Two weeks later, follow-up tests at her local hospital showed no trace of the condition. 'I am not the same woman who walked in that night,' she shared during a recent Sunday testimony segment. The ministry continues to hold its healing service on the last Wednesday of every month, open to members and first-time visitors alike.",
    },
    {
      id: "n-004",
      title: "Missions Team Returns from Outreach in Northern Nigeria",
      category: "Missions",
      date: "2024-06-04",
      author: "Missions Department",
      image: "",
      excerpt:
        "A twelve-member team spent two weeks planting a fellowship, training local leaders, and distributing relief supplies in an underserved community.",
      body:
        "The ministry's missions arm completed a two-week outreach trip to a rural community in northern Nigeria, where a small fellowship of forty believers had been meeting without consistent pastoral covering. The team, led by Associate Pastor Grace Fatunmbi, conducted leadership training sessions, distributed food and clothing donated by the home congregation, and helped formally establish the group as a partner fellowship under the ministry's oversight. 'Every outreach reminds us that the field is wider than our walls,' Rev. Agidipo remarked during the team's welcome-back service.",
    },
    {
      id: "n-005",
      title: "Annual Youth Conference Set for December",
      category: "Announcements",
      date: "2024-10-29",
      author: "Youth Ministry",
      image: "",
      excerpt:
        "Registration is now open for this year's 'Ignite' youth conference, three days of worship, mentorship tracks, and a talent showcase for ages 13–25.",
      body:
        "This year's Ignite Youth Conference runs from December 27–29 under the theme 'Carriers of Fire.' The program includes morning mentorship tracks on purpose, career, and relationships, nightly worship and teaching sessions, and a closing talent showcase produced entirely by the youth department. Early registration closes December 15. Interested participants can register at the church office or through the ministry's contact form.",
    },
    {
      id: "n-006",
      title: "Widows' Support Programme Marks Second Anniversary",
      category: "Outreach",
      date: "2024-05-12",
      author: "Compassion Ministry",
      image: "",
      excerpt:
        "The monthly welfare initiative has now provided food, school fees, and skills training to over 80 widows in the local community.",
      body:
        "Launched in 2022, the ministry's Widows' Support Programme marked two years of service this month with a small celebration attended by beneficiaries and volunteers. The programme provides monthly food packages, covers school fees for beneficiaries' children, and runs a quarterly skills-acquisition workshop in tailoring and soap-making. 'Pure religion is this — to visit the widow in her affliction,' Rev. Agidipo reminded the congregation, encouraging continued partnership through the compassion fund.",
    },
    {
      id: "n-007",
      title: "Church Choir Releases First Live Worship Recording",
      category: "Church News",
      date: "2024-03-08",
      author: "Media Department",
      image: "",
      excerpt:
        "Recorded during the Easter vigil service, the ministry's first official worship album is now available to members through the media desk.",
      body:
        "The ministry's resident choir has released 'Break Forth,' a nine-track live recording captured during last year's Easter vigil service. The project features original compositions alongside reimagined hymns and was produced entirely by volunteer musicians within the congregation. Copies are available at the media desk after Sunday services, with proceeds directed toward the youth conference scholarship fund.",
    },
  ];

  const state = {
    all: [],
    filtered: [],
    activeCategory: "All",
    searchTerm: "",
    visibleCount: PAGE_SIZE,
  };

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (e) {
      return dateStr;
    }
  }

  function loadNewsData() {
    if (window.MinistryCMS && typeof window.MinistryCMS.getItems === "function") {
      try {
        const items = window.MinistryCMS.getItems("news");
        if (Array.isArray(items) && items.length) return items;
      } catch (e) {
        /* fall through to storage lookups */
      }
    }
    const keysToTry = ["ministryData", "ram_data", "ram_news", "cms_news"];
    for (const key of keysToTry) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
        if (parsed && Array.isArray(parsed.news) && parsed.news.length) return parsed.news;
      } catch (e) {
        /* ignore malformed entries and continue */
      }
    }
    return SEED_NEWS.slice();
  }

  function uniqueCategories(items) {
    const set = new Set(items.map((n) => n.category).filter(Boolean));
    return ["All", ...Array.from(set)];
  }

  function applyFilters() {
    const term = state.searchTerm.trim().toLowerCase();
    state.filtered = state.all.filter((item) => {
      const matchesCategory =
        state.activeCategory === "All" || item.category === state.activeCategory;
      const haystack = `${item.title} ${item.excerpt}`.toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      return matchesCategory && matchesSearch;
    });
    state.filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function tagStyle(category) {
    const color = TAG_COLORS[category] || "var(--gold)";
    return `style="--tag-color:${color}"`;
  }

  function cardTemplate(item) {
    const hasImage = item.image && item.image.trim().length > 0;
    const media = hasImage
      ? `<div class="news-card__media" style="background-image:url('${item.image}')"></div>`
      : `<div class="news-card__media news-card__media--beam" aria-hidden="true"></div>`;
    return `
      <article class="news-card beam-corner" data-id="${item.id}" tabindex="0">
        ${media}
        <div class="news-card__body">
          <span class="news-card__tag" ${tagStyle(item.category)}>${item.category}</span>
          <time class="news-card__date" datetime="${item.date}">${formatDate(item.date)}</time>
          <h3 class="news-card__title">${item.title}</h3>
          <p class="news-card__excerpt">${item.excerpt}</p>
          <button type="button" class="news-card__link" data-action="read-more" data-id="${item.id}">
            Read full story <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </article>`;
  }

  function featuredTemplate(item) {
    if (!item) return "";
    const hasImage = item.image && item.image.trim().length > 0;
    return `
      <article class="news-featured beam-corner" data-id="${item.id}">
        <div class="news-featured__media${hasImage ? "" : " news-featured__media--beam"}"
             ${hasImage ? `style="background-image:url('${item.image}')"` : ""} aria-hidden="true"></div>
        <div class="news-featured__body">
          <span class="news-card__tag" ${tagStyle(item.category)}>${item.category}</span>
          <h2 class="news-featured__title">${item.title}</h2>
          <p class="news-featured__excerpt">${item.excerpt}</p>
          <div class="news-featured__meta">
            <time datetime="${item.date}">${formatDate(item.date)}</time>
            <span>&middot;</span>
            <span>${item.author || "Ministry Press Desk"}</span>
          </div>
          <button type="button" class="news-card__link" data-action="read-more" data-id="${item.id}">
            Read full story <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </article>`;
  }

  function renderFilters() {
    const wrap = document.querySelector(FILTER_SEL);
    if (!wrap) return;
    const categories = uniqueCategories(state.all);
    wrap.innerHTML = categories
      .map(
        (cat) => `
        <button type="button"
          class="pill-filter${cat === state.activeCategory ? " is-active" : ""}"
          data-category="${cat}"
          aria-pressed="${cat === state.activeCategory}">
          ${cat}
        </button>`
      )
      .join("");
  }

  function renderFeatured() {
    const wrap = document.querySelector(FEATURED_SEL);
    if (!wrap) return;
    if (state.activeCategory !== "All" || state.searchTerm) {
      wrap.innerHTML = "";
      wrap.hidden = true;
      return;
    }
    const featured = state.all
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    wrap.hidden = !featured;
    wrap.innerHTML = featuredTemplate(featured);
  }

  function renderGrid() {
    const grid = document.querySelector(GRID_SEL);
    const empty = document.querySelector(EMPTY_SEL);
    const loadMoreBtn = document.querySelector(LOAD_MORE_SEL);
    if (!grid) return;

    const visibleItems = state.filtered.slice(0, state.visibleCount);

    if (!visibleItems.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      if (loadMoreBtn) loadMoreBtn.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = visibleItems.map(cardTemplate).join("");

    if (loadMoreBtn) {
      loadMoreBtn.hidden = state.visibleCount >= state.filtered.length;
    }
  }

  function renderAll() {
    applyFilters();
    renderFilters();
    renderFeatured();
    renderGrid();
  }

  function openModal(id) {
    const item = state.all.find((n) => n.id === id);
    if (!item) return;
    let modal = document.querySelector(MODAL_SEL);

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "news-modal";
      modal.className = "news-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="news-modal__backdrop" data-action="close-modal"></div>
      <div class="news-modal__panel beam-corner" role="document">
        <button type="button" class="news-modal__close" data-action="close-modal" aria-label="Close article">&times;</button>
        <span class="news-card__tag" ${tagStyle(item.category)}>${item.category}</span>
        <h2 class="news-modal__title">${item.title}</h2>
        <div class="news-featured__meta">
          <time datetime="${item.date}">${formatDate(item.date)}</time>
          <span>&middot;</span>
          <span>${item.author || "Ministry Press Desk"}</span>
        </div>
        <p class="news-modal__body">${item.body || item.excerpt}</p>
      </div>`;

    modal.classList.add("is-open");
    document.body.classList.add("no-scroll");
    modal.querySelector(".news-modal__close").focus();
  }

  function closeModal() {
    const modal = document.querySelector(MODAL_SEL);
    if (!modal) return;
    modal.classList.remove("is-open");
    document.body.classList.remove("no-scroll");
  }

  function bindEvents() {
    const filterWrap = document.querySelector(FILTER_SEL);
    if (filterWrap) {
      filterWrap.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-category]");
        if (!btn) return;
        state.activeCategory = btn.dataset.category;
        state.visibleCount = PAGE_SIZE;
        renderAll();
      });
    }

    const searchInput = document.querySelector(SEARCH_SEL);
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchTerm = e.target.value;
          state.visibleCount = PAGE_SIZE;
          renderAll();
        }, 200);
      });
    }

    const loadMoreBtn = document.querySelector(LOAD_MORE_SEL);
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", () => {
        state.visibleCount += PAGE_SIZE;
        renderGrid();
      });
    }

    document.addEventListener("click", (e) => {
      const readMore = e.target.closest('[data-action="read-more"]');
      if (readMore) {
        openModal(readMore.dataset.id);
        return;
      }
      if (e.target.closest('[data-action="close-modal"]')) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const card = e.target.closest(".news-card");
        if (card) openModal(card.dataset.id);
      }
      if (e.key === "Escape") closeModal();
    });

    window.addEventListener("storage", (e) => {
      if (!e.key || /news|ministryData|ram_data|cms_news/i.test(e.key)) {
        state.all = loadNewsData();
        state.visibleCount = PAGE_SIZE;
        renderAll();
      }
    });

    window.addEventListener("cms:updated", (e) => {
      if (!e.detail || e.detail.type === "news") {
        state.all = loadNewsData();
        state.visibleCount = PAGE_SIZE;
        renderAll();
      }
    });
  }

  function init() {
    if (!document.querySelector(GRID_SEL)) return;
    state.all = loadNewsData();
    bindEvents();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.NewsPage = { refresh: () => { state.all = loadNewsData(); renderAll(); } };
})();