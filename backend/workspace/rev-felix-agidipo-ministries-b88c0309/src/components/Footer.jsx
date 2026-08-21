import { Link } from "react-router-dom";
import SectionDivider from "./SectionDivider";

const quickLinks = [
  { label: "Home", to: "/" },
  { label: "About", to: "/about" },
  { label: "Activities", to: "/activities" },
  { label: "Events", to: "/events" },
  { label: "Sermons", to: "/sermons" },
  { label: "Gallery", to: "/gallery" },
  { label: "News", to: "/news" },
  { label: "Contact", to: "/contact" },
];

const socials = [
  {
    label: "Facebook",
    href: "https://facebook.com/revfelixagidipo",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.95.3-1.6 1.7-1.6h1.8V3.9c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v2.2H7.2v3.3h2.8V22h3.5Z" />
      </svg>
    ),
  },
  {
    label: "YouTube",
    href: "https://youtube.com/@revfelixagidipo",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22 8.4s-.2-1.6-.8-2.3c-.8-.9-1.7-.9-2.1-1C16.4 4.9 12 4.9 12 4.9h0s-4.4 0-7.1.2c-.4 0-1.3.1-2.1 1C2.2 6.8 2 8.4 2 8.4S1.8 10.3 1.8 12.2v1.6c0 1.9.2 3.8.2 3.8s.2 1.6.8 2.3c.8.9 1.9.9 2.4 1 1.7.2 7.3.2 7.3.2s4.4 0 7.1-.2c.4 0 1.3-.1 2.1-1 .6-.7.8-2.3.8-2.3s.2-1.9.2-3.8v-1.6c0-1.9-.2-3.8-.2-3.8ZM9.9 15.6V9.4l5.6 3.1-5.6 3.1Z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com/revfelixagidipo",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.2c2.7 0 3 0 4 .1 1 0 1.6.2 2 .4.5.2.9.4 1.3.8.4.4.6.8.8 1.3.2.4.3 1 .4 2 0 1 .1 1.3.1 4s0 3-.1 4c0 1-.2 1.6-.4 2-.2.5-.4.9-.8 1.3-.4.4-.8.6-1.3.8-.4.2-1 .3-2 .4-1 0-1.3.1-4 .1s-3 0-4-.1c-1 0-1.6-.2-2-.4-.5-.2-.9-.4-1.3-.8-.4-.4-.6-.8-.8-1.3-.2-.4-.3-1-.4-2 0-1-.1-1.3-.1-4s0-3 .1-4c0-1 .2-1.6.4-2 .2-.5.4-.9.8-1.3.4-.4.8-.6 1.3-.8.4-.2 1-.3 2-.4 1 0 1.3-.1 4-.1Zm0 1.8c-2.6 0-2.9 0-3.9.1-.8 0-1.3.2-1.6.3-.4.1-.7.3-1 .6-.3.3-.5.6-.6 1-.1.3-.3.8-.3 1.6-.1 1-.1 1.3-.1 3.9s0 2.9.1 3.9c0 .8.2 1.3.3 1.6.1.4.3.7.6 1 .3.3.6.5 1 .6.3.1.8.3 1.6.3 1 .1 1.3.1 3.9.1s2.9 0 3.9-.1c.8 0 1.3-.2 1.6-.3.4-.1.7-.3 1-.6.3-.3.5-.6.6-1 .1-.3.3-.8.3-1.6.1-1 .1-1.3.1-3.9s0-2.9-.1-3.9c0-.8-.2-1.3-.3-1.6-.1-.4-.3-.7-.6-1-.3-.3-.6-.5-1-.6-.3-.1-.8-.3-1.6-.3-1-.1-1.3-.1-3.9-.1Zm0 3.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm0 1.8a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm5.8-3.1a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0Z" />
      </svg>
    ),
  },
  {
    label: "X",
    href: "https://x.com/revfelixagidipo",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.9 3H21.9L15.4 10.4 23.1 21H16.9L11.9 14.3 6.2 21H3.2L10.1 13.1 2.7 3H9.1L13.6 9.1 18.9 3Zm-1.1 16.3H19.7L8.3 4.6H6.5L17.8 19.3Z" />
      </svg>
    ),
  },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <SectionDivider variant="footer" />
      <div className="site-footer__inner">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <p className="site-footer__mark">Rev. Felix Agidipo Ministries</p>
            <p className="site-footer__tagline">
              Carrying the anointing, pouring out the Word &mdash; raising a
              generation marked by the oil of consecration.
            </p>
            <div className="site-footer__socials" aria-label="Social media links">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={s.label}
                  className="site-footer__social"
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          <nav className="site-footer__links" aria-label="Quick links">
            <h3 className="site-footer__heading">Quick Links</h3>
            <ul>
              {quickLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-footer__contact">
            <h3 className="site-footer__heading">Reach Us</h3>
            <address>
              <p>Chapel of the Anointing,<br />12 Consecration Close,<br />Ikeja, Lagos, Nigeria</p>
              <p>
                <a href="tel:+2348012345678">+234 801 234 5678</a>
              </p>
              <p>
                <a href="mailto:info@felixagidipoministries.org">
                  info@felixagidipoministries.org
                </a>
              </p>
            </address>
          </div>

          <div className="site-footer__admin">
            <h3 className="site-footer__heading">Ministry Portal</h3>
            <p>Content shepherds and administrators sign in here.</p>
            <Link to="/admin" className="site-footer__admin-link">
              Admin Console &rarr;
            </Link>
          </div>
        </div>

        <div className="site-footer__base">
          <p>
            &copy; {year} Rev. Felix Agidipo Ministries. All rights reserved.
          </p>
          <p className="site-footer__verse">
            &ldquo;Thou anointest my head with oil; my cup runneth over.&rdquo;
            &mdash; Psalm 23:5
          </p>
        </div>
      </div>
    </footer>
  );
}