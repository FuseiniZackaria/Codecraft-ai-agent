/* ==========================================================================
   Rev. Felix Agidipo Ministries — js/gallery.js
   Album filtering + accessible lightbox for the gallery page.
   Reads gallery entries from the shared FAM data store (js/data.js) and
   re-renders live when the admin panel publishes changes (storage / custom
   event), simulating real-time publishing.
   ========================================================================== */

(function () {
  "use strict";

  var grid = document.getElementById("galleryGrid");
  var filterBar = document.getElementById("galleryFilters");
  var emptyState = document.getElementById("galleryEmpty");

  // Gallery only runs on pages that actually have the grid markup.
  if (!grid) return;

  var STORE_KEY = "gallery";
  var state = { items: [], activeAlbum: "All", lightboxIndex: -1, lastFocused: null };

  var FALLBACK_ITEMS = [
    { id: "g1", album: "Crusades", title: "Dawn of Grace Crusade", date: "2024-03-15",
      image: "", caption: "Light broke over the field as thousands rose for the altar call." },
    { id: "g2", album: "Youth Ministry", title: "Young Voices Retreat", date: "2024-05-02",
      image: "", caption: "Teens and young adults gathered for a weekend of worship and mentorship." },
    { id: "g3", album: "Outreach", title: "Bread of Life Food Drive", date: "2024-06-21",
      image: "", caption: "Volunteers packaged over 800 meals for families across the community." },
    { id: "g4", album: "Worship Nights", title: "Songs in the Dark", date: "2024-08-09",
      image: "", caption: "A candlelit evening of praise closing with testimonies of healing." }
  ];

  /* ---------- data access -------------------------------------------- */

  function loadItems() {
    if (window.FAM && typeof window.FAM.get === "function") {
      var data = window.FAM.get(STORE_KEY);
      if (Array.isArray(data) && data.length) return data;
    }
    return FALLBACK_ITEMS;
  }

  function getAlbums(items) {
    var seen = {};
    var albums = ["All"];
    items.forEach(function (item) {
      var a = item.album || "General";
      if (!seen[a]) {
        seen[a] = true;
        albums.push(a);
      }
    });
    return albums;
  }

  function filteredItems() {
    if (state.activeAlbum === "All") return state.items;
    return state.items.filter(function (item) {
      return (item.album || "General") === state.activeAlbum;
    });
  }

  /* ---------- rendering ------------------------------------------------ */

  function render() {
    state.items = loadItems();
    renderFilters();
    renderGrid();
  }

  function renderFilters() {
    if (!filterBar) return;
    var albums = getAlbums(state.items);

    if (albums.indexOf(state.activeAlbum) === -1) state.activeAlbum = "All";

    filterBar.innerHTML = "";
    albums.forEach(function (album) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gallery-filter-btn" + (album === state.activeAlbum ? " is-active" : "");
      btn.setAttribute("aria-pressed", album === state.activeAlbum ? "true" : "false");
      btn.textContent = album;
      btn.addEventListener("click", function () {
        state.activeAlbum = album;
        renderFilters();
        renderGrid();
      });
      filterBar.appendChild(btn);
    });
  }

  function placeholderMarkup(title) {
    return (
      '<div class="beam-card-placeholder" aria-hidden="true">' +
      '<span class="beam-card-placeholder-glyph">✦</span>' +
      '<span class="beam-card-placeholder-title">' + escapeHtml(title) + "</span>" +
      "</div>"
    );
  }

  function renderGrid() {
    var items = filteredItems();
    grid.innerHTML = "";

    if (!items.length) {
      if (emptyState) emptyState.hidden = false;
      return;
    }
    if (emptyState) emptyState.hidden = true;

    items.forEach(function (item, index) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "beam-card gallery-card";
      card.setAttribute("data-index", String(index));
      card.setAttribute("aria-label", "Open photo: " + (item.title || "Gallery image"));

      var media = document.createElement("span");
      media.className = "gallery-card-media";

      if (item.image) {
        var img = document.createElement("img");
        img.src = item.image;
        img.alt = item.title || "";
        img.loading = "lazy";
        img.onerror = function () {
          media.innerHTML = placeholderMarkup(item.title || "");
        };
        media.appendChild(img);
      } else {
        media.innerHTML = placeholderMarkup(item.title || "");
      }

      var meta = document.createElement("span");
      meta.className = "gallery-card-meta";
      meta.innerHTML =
        '<span class="gallery-card-album">' + escapeHtml(item.album || "General") + "</span>" +
        '<span class="gallery-card-title">' + escapeHtml(item.title || "") + "</span>";

      card.appendChild(media);
      card.appendChild(meta);

      card.addEventListener("click", function () {
        openLightbox(index, card);
      });

      grid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* ---------- lightbox --------------------------------------------------- */

  var lightbox = null;

  function buildLightbox() {
    if (lightbox) return lightbox;

    var overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Gallery image viewer");
    overlay.hidden = true;

    overlay.innerHTML =
      '<div class="lightbox-content">' +
        '<button type="button" class="lightbox-close" aria-label="Close photo viewer">&times;</button>' +
        '<button type="button" class="lightbox-nav lightbox-prev" aria-label="Previous photo">&#8249;</button>' +
        '<figure class="lightbox-figure">' +
          '<div class="lightbox-image-wrap"><img class="lightbox-image" alt="" /></div>' +
          '<figcaption class="lightbox-caption">' +
            '<span class="lightbox-title"></span>' +
            '<span class="lightbox-date"></span>' +
            '<p class="lightbox-desc"></p>' +
            '<span class="lightbox-counter"></span>' +
          "</figcaption>" +
        "</figure>" +
        '<button type="button" class="lightbox-nav lightbox-next" aria-label="Next photo">&#8250;</button>' +
      "</div>";

    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeLightbox();
    });
    overlay.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    overlay.querySelector(".lightbox-prev").addEventListener("click", function () { stepLightbox(-1); });
    overlay.querySelector(".lightbox-next").addEventListener("click", function () { stepLightbox(1); });

    var touchStartX = 0;
    overlay.addEventListener("touchstart", function (e) {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    overlay.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) stepLightbox(dx > 0 ? -1 : 1);
    }, { passive: true });

    lightbox = overlay;
    return overlay;
  }

  function openLightbox(index, triggerEl) {
    var el = buildLightbox();
    state.lightboxIndex = index;
    state.lastFocused = triggerEl || document.activeElement;
    populateLightbox();
    el.hidden = false;
    document.body.classList.add("lightbox-locked");
    document.addEventListener("keydown", onLightboxKeydown);
    var closeBtn = el.querySelector(".lightbox-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    document.body.classList.remove("lightbox-locked");
    document.removeEventListener("keydown", onLightboxKeydown);
    if (state.lastFocused && typeof state.lastFocused.focus === "function") {
      state.lastFocused.focus();
    }
  }

  function stepLightbox(direction) {
    var items = filteredItems();
    if (!items.length) return;
    state.lightboxIndex = (state.lightboxIndex + direction + items.length) % items.length;
    populateLightbox();
  }

  function populateLightbox() {
    var items = filteredItems();
    var item = items[state.lightboxIndex];
    if (!item || !lightbox) return;

    var imgWrap = lightbox.querySelector(".lightbox-image-wrap");
    var img = lightbox.querySelector(".lightbox-image");

    if (item.image) {
      img.hidden = false;
      img.src = item.image;
      img.alt = item.title || "";
      img.onerror = function () {
        img.hidden = true;
        imgWrap.querySelector(".beam-card-placeholder") && imgWrap.querySelector(".beam-card-placeholder").remove();
        imgWrap.insertAdjacentHTML("beforeend", placeholderMarkup(item.title || ""));
      };
    } else {
      img.hidden = true;
      var existing = imgWrap.querySelector(".beam-card-placeholder");
      if (existing) existing.remove();
      imgWrap.insertAdjacentHTML("beforeend", placeholderMarkup(item.title || ""));
    }

    lightbox.querySelector(".lightbox-title").textContent = item.title || "";
    lightbox.querySelector(".lightbox-date").textContent = item.date
      ? new Date(item.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "";
    lightbox.querySelector(".lightbox-desc").textContent = item.caption || "";
    lightbox.querySelector(".lightbox-counter").textContent =
      (state.lightboxIndex + 1) + " of " + items.length + " — " + (item.album || "General");
  }

  function onLightboxKeydown(e) {
    if (e.key === "Escape") { closeLightbox(); return; }
    if (e.key === "ArrowLeft") { stepLightbox(-1); return; }
    if (e.key === "ArrowRight") { stepLightbox(1); return; }
    if (e.key === "Tab") trapFocus(e);
  }

  function trapFocus(e) {
    var focusable = lightbox.querySelectorAll("button");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ---------- live updates from admin panel ------------------------------ */

  window.addEventListener("storage", function (e) {
    if (!e.key || e.key.indexOf(STORE_KEY) !== -1) render();
  });

  document.addEventListener("fam:update", function (e) {
    if (!e.detail || e.detail.type === STORE_KEY) render();
  });

  /* ---------- init ------------------------------------------------------- */

  document.addEventListener("DOMContentLoaded", render);
  if (document.readyState === "complete" || document.readyState === "interactive") {
    render();
  }
})();