import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCollection } from "../data/store";
import SectionDivider from "../components/SectionDivider";

export default function Gallery() {
  const photos = useCollection("gallery");
  const [activeCategory, setActiveCategory] = useState("All");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const closeBtnRef = useRef(null);

  const categories = useMemo(() => {
    const set = new Set(photos.map((p) => p.category).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [photos]);

  const filtered = useMemo(() => {
    if (activeCategory === "All") return photos;
    return photos.filter((p) => p.category === activeCategory);
  }, [photos, activeCategory]);

  const openLightbox = (idx) => setLightboxIndex(idx);
  const closeLightbox = () => setLightboxIndex(null);
  const showPrev = () =>
    setLightboxIndex((i) => (i - 1 + filtered.length) % filtered.length);
  const showNext = () =>
    setLightboxIndex((i) => (i + 1) % filtered.length);

  useEffect(() => {
    if (lightboxIndex === null) return;
    closeBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightboxIndex, filtered.length]);

  const current = lightboxIndex !== null ? filtered[lightboxIndex] : null;

  return (
    <div className="page page-gallery">
      <header className="page-hero page-hero--indigo">
        <div className="container">
          <p className="eyebrow">The Gallery of Grace</p>
          <h1>Moments Anointed &amp; Remembered</h1>
          <p className="lede">
            From crusade grounds to baptismal waters, every photograph here is
            a testimony frozen in time — evidence of what God has done among
            His people through the ministry of Rev. Felix Agidipo.
          </p>
        </div>
      </header>

      <SectionDivider />

      <section className="section section--champagne">
        <div className="container">
          <div className="gallery-filters" role="tablist" aria-label="Filter photos by category">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={activeCategory === cat}
                className={
                  "filter-chip" + (activeCategory === cat ? " filter-chip--active" : "")
                }
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <p>No photographs have been added to this category yet.</p>
              <p className="empty-state__hint">
                Ministry admins can add images from the Admin dashboard.
              </p>
            </div>
          ) : (
            <div className="gallery-grid">
              {filtered.map((photo, idx) => (
                <button
                  type="button"
                  key={photo.id}
                  className={
                    "gallery-card" +
                    (idx % 7 === 0 ? " gallery-card--feature" : "") +
                    (idx % 5 === 3 ? " gallery-card--tall" : "")
                  }
                  onClick={() => openLightbox(idx)}
                  aria-label={`View photo: ${photo.title || "Ministry photo"}`}
                >
                  <img
                    src={photo.image}
                    alt={photo.caption || photo.title || "Rev. Felix Agidipo Ministries"}
                    loading="lazy"
                  />
                  <span className="gallery-card__overlay">
                    <span className="gallery-card__title">{photo.title}</span>
                    {photo.category && (
                      <span className="gallery-card__tag">{photo.category}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {current && (
        <div
          className="lightbox-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={current.title || "Photo viewer"}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLightbox();
          }}
        >
          <div className="lightbox-content">
            <button
              ref={closeBtnRef}
              type="button"
              className="lightbox-close"
              onClick={closeLightbox}
              aria-label="Close photo viewer"
            >
              ✕
            </button>

            {filtered.length > 1 && (
              <button
                type="button"
                className="lightbox-nav lightbox-nav--prev"
                onClick={showPrev}
                aria-label="Previous photo"
              >
                ‹
              </button>
            )}

            <figure className="lightbox-figure">
              <img src={current.image} alt={current.caption || current.title || ""} />
              <figcaption>
                <span className="lightbox-title">{current.title}</span>
                {current.caption && <span className="lightbox-caption">{current.caption}</span>}
                <span className="lightbox-meta">
                  {current.category}
                  {current.date &&
                    ` · ${new Date(current.date).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}`}
                </span>
              </figcaption>
            </figure>

            {filtered.length > 1 && (
              <button
                type="button"
                className="lightbox-nav lightbox-nav--next"
                onClick={showNext}
                aria-label="Next photo"
              >
                ›
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}