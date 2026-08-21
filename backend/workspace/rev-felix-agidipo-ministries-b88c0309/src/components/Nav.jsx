import { useState, useEffect } from "react";
import { NavLink, Link } from "react-router-dom";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/activities", label: "Activities" },
  { to: "/events", label: "Events" },
  { to: "/sermons", label: "Sermons" },
  { to: "/gallery", label: "Gallery" },
  { to: "/news", label: "News" },
  { to: "/contact", label: "Contact" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [window.location.pathname]);

  return (
    <header className={`site-nav ${scrolled ? "site-nav--scrolled" : ""}`}>
      <div className="site-nav__inner">
        <Link to="/" className="site-nav__brand" onClick={() => setOpen(false)}>
          <span className="site-nav__mark" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
              <path
                d="M15 2 C15 2 8 12 8 18 C8 23 11 27 15 27 C19 27 22 23 22 18 C22 12 15 2 15 2 Z"
                stroke="#C9A24B"
                strokeWidth="1.6"
                fill="rgba(201,162,75,0.15)"
              />
            </svg>
          </span>
          <span className="site-nav__brand-text">
            <span className="site-nav__brand-title">Rev. Felix Agidipo</span>
            <span className="site-nav__brand-sub">Ministries</span>
          </span>
        </Link>

        <nav className="site-nav__links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) =>
                "site-nav__link" + (isActive ? " site-nav__link--active" : "")
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="site-nav__actions">
          <Link to="/sermons" className="btn btn--gold site-nav__cta">
            Watch Sermons
          </Link>

          <button
            type="button"
            className={`site-nav__hamburger ${open ? "is-open" : ""}`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>

      <nav
        id="mobile-nav"
        className={`site-nav__mobile ${open ? "site-nav__mobile--open" : ""}`}
        aria-label="Mobile"
        aria-hidden={!open}
      >
        {NAV_LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === "/"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              "site-nav__mobile-link" + (isActive ? " site-nav__mobile-link--active" : "")
            }
          >
            {l.label}
          </NavLink>
        ))}
        <Link to="/sermons" className="btn btn--gold site-nav__mobile-cta" onClick={() => setOpen(false)}>
          Watch Sermons
        </Link>
      </nav>
    </header>
  );
}