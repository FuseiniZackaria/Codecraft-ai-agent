// ============================================================
// CodeCraft — script.js
// Mobile nav toggle, scroll-reveal, blueprint draw-in animation
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  /* -----------------------------------------------------------
     1. MOBILE NAV TOGGLE
  ----------------------------------------------------------- */
  const navToggle = document.querySelector('.nav-toggle');
  const siteNav = document.querySelector('.site-nav') || document.querySelector('.nav-links');
  const body = document.body;

  if (navToggle && siteNav) {
    navToggle.setAttribute('aria-expanded', 'false');

    const openNav = () => {
      siteNav.classList.add('is-open');
      navToggle.classList.add('is-active');
      navToggle.setAttribute('aria-expanded', 'true');
      body.classList.add('nav-open');
    };

    const closeNav = () => {
      siteNav.classList.remove('is-open');
      navToggle.classList.remove('is-active');
      navToggle.setAttribute('aria-expanded', 'false');
      body.classList.remove('nav-open');
    };

    navToggle.addEventListener('click', () => {
      const isOpen = siteNav.classList.contains('is-open');
      isOpen ? closeNav() : openNav();
    });

    // Close nav when a link inside it is clicked (mobile UX)
    siteNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closeNav());
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (
        siteNav.classList.contains('is-open') &&
        !siteNav.contains(e.target) &&
        !navToggle.contains(e.target)
      ) {
        closeNav();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && siteNav.classList.contains('is-open')) {
        closeNav();
        navToggle.focus();
      }
    });

    // Reset nav state on resize back to desktop
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth > 800) closeNav();
      }, 150);
    });
  }

  /* -----------------------------------------------------------
     2. SCROLL-REVEAL FOR SECTIONS
  ----------------------------------------------------------- */
  const revealTargets = document.querySelectorAll(
    '.reveal, .panel, .section, [data-reveal]'
  );

  if ('IntersectionObserver' in window && revealTargets.length) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.15,
        rootMargin: '0px 0px -60px 0px',
      }
    );

    revealTargets.forEach((el) => revealObserver.observe(el));
  } else {
    // Fallback: no IO support — reveal everything immediately
    revealTargets.forEach((el) => el.classList.add('is-visible'));
  }

  /* -----------------------------------------------------------
     3. BLUEPRINT HERO — DIMENSION LINE DRAW-IN
  ----------------------------------------------------------- */
  const blueprint = document.querySelector('.blueprint-hero');

  const runBlueprintAnimation = (container) => {
    if (!container || container.classList.contains('is-drawn')) return;
    container.classList.add('is-drawn');

    // Animate SVG dimension lines (dashed lines w/ tick arrows)
    const lines = container.querySelectorAll(
      '.dim-line, .dim-path, svg [data-draw]'
    );

    lines.forEach((line, i) => {
      // measure real length for a precise draw-in, fallback to a large number
      let length = 300;
      try {
        if (typeof line.getTotalLength === 'function') {
          length = line.getTotalLength();
        }
      } catch (err) {
        length = 300;
      }

      line.style.strokeDasharray = `${length}`;
      line.style.strokeDashoffset = `${length}`;
      line.style.transition = 'none';

      // stagger each line slightly
      const delay = i * 180;

      requestAnimationFrame(() => {
        setTimeout(() => {
          line.style.transition =
            'stroke-dashoffset 900ms cubic-bezier(0.65, 0, 0.35, 1)';
          line.style.strokeDashoffset = '0';
        }, delay);
      });
    });

    // Reveal craft-vocabulary callouts staggered after their lines
    const callouts = container.querySelectorAll(
      '.callout, .blueprint-callout, [data-callout]'
    );

    callouts.forEach((callout, i) => {
      setTimeout(() => {
        callout.classList.add('is-labeled');
      }, 400 + i * 260);
    });

    // Arrowhead / tick marks pop in with the lines
    const ticks = container.querySelectorAll('.dim-tick, [data-tick]');
    ticks.forEach((tick, i) => {
      setTimeout(() => {
        tick.classList.add('is-visible');
      }, 300 + i * 180);
    });
  };

  if (blueprint) {
    if ('IntersectionObserver' in window) {
      const heroObserver = new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              runBlueprintAnimation(entry.target);
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.3 }
      );
      heroObserver.observe(blueprint);
    }

    // Also trigger on initial load in case hero is already in viewport
    window.addEventListener('load', () => {
      const rect = blueprint.getBoundingClientRect();
      const inView = rect.top < window.innerHeight && rect.bottom > 0;
      if (inView) runBlueprintAnimation(blueprint);
    });
  }

  /* -----------------------------------------------------------
     4. SMOOTH ANCHOR SCROLL (respects reduced-motion)
  ----------------------------------------------------------- */
  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = document.querySelector(targetId);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  });

  /* -----------------------------------------------------------
     5. CURRENT YEAR (footer stamp, if present)
  ----------------------------------------------------------- */
  const yearEl = document.querySelector('[data-year]');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
});