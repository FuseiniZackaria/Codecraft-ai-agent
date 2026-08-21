// ============================================================
// CodeCraft — Blueprint Interactions
// Handles: SVG signature line-draw animation, mobile nav toggle,
// and a subtle parallax drift on the drafting grid backdrop.
// ============================================================

(function () {
  'use strict';

  /* ----------------------------------------------------------
     1. MOBILE NAV TOGGLE
  ---------------------------------------------------------- */
  function initNavToggle() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.nav-links');
    const header = document.querySelector('.site-header') || document.body;

    if (!toggle || !nav) return;

    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      toggle.classList.toggle('is-active', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      header.classList.toggle('nav-open', isOpen);
      document.body.classList.toggle('no-scroll', isOpen);
    });

    // Close menu when a link is clicked (mobile UX)
    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('is-open');
        toggle.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
        header.classList.remove('nav-open');
        document.body.classList.remove('no-scroll');
      });
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
        header.classList.remove('nav-open');
        document.body.classList.remove('no-scroll');
        toggle.focus();
      }
    });
  }

  /* ----------------------------------------------------------
     2. SIGNATURE SVG LINE-DRAW ANIMATION
     Draws every path/line/polyline/circle/rect stroke in the
     hero blueprint like a pen tracing a technical drawing,
     then reveals dimension lines and brass pushpin callouts
     in sequence.
  ---------------------------------------------------------- */
  function initBlueprintDraw() {
    const svg = document.querySelector('#hero-blueprint, .blueprint-svg');
    if (!svg) return;

    const drawables = svg.querySelectorAll(
      '.draw-path, path, line, polyline, circle:not(.pushpin-head), rect.draw-path'
    );
    const dimensionLines = svg.querySelectorAll('.dimension-line');
    const pushpins = svg.querySelectorAll('.pushpin, .pushpin-callout');
    const labels = svg.querySelectorAll('.callout-label');

    let hasRun = false;

    function prepElement(el, index) {
      let length = 100;
      try {
        if (typeof el.getTotalLength === 'function') {
          length = el.getTotalLength();
        }
      } catch (err) {
        length = 100;
      }
      el.style.strokeDasharray = length;
      el.style.strokeDashoffset = length;
      el.style.transition = 'none';
      el.dataset.drawLength = length;
      el.dataset.drawIndex = index;
    }

    function prepDimension(el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(4px)';
      el.style.transition = 'none';
    }

    function prepPushpin(el) {
      el.style.opacity = '0';
      el.style.transform = 'scale(0.4)';
      el.style.transformOrigin = 'center';
      el.style.transition = 'none';
    }

    // Reduced motion: reveal everything instantly, no animation.
    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (prefersReduced) {
      drawables.forEach((el) => {
        el.style.strokeDasharray = 'none';
        el.style.strokeDashoffset = '0';
      });
      dimensionLines.forEach((el) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
      pushpins.forEach((el) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
      labels.forEach((el) => {
        el.style.opacity = '1';
      });
      svg.classList.add('is-drawn');
      return;
    }

    drawables.forEach(prepElement);
    dimensionLines.forEach(prepDimension);
    pushpins.forEach(prepPushpin);
    labels.forEach((el) => {
      el.style.opacity = '0';
      el.style.transition = 'none';
    });

    function runAnimation() {
      if (hasRun) return;
      hasRun = true;
      svg.classList.add('is-drawing');

      const strokeSpeed = 900; // ms per path segment budget
      const staggerPerPath = 90;

      drawables.forEach((el, i) => {
        const length = parseFloat(el.dataset.drawLength) || 100;
        const duration = Math.min(Math.max(length * 1.6, 400), strokeSpeed);
        const delay = i * staggerPerPath;

        window.setTimeout(() => {
          el.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.65, 0, 0.35, 1)`;
          el.style.strokeDashoffset = '0';
        }, delay);
      });

      const drawableFinish =
        drawables.length * staggerPerPath + strokeSpeed + 100;

      // Dimension lines fade/slide in after the main drawing settles
      dimensionLines.forEach((el, i) => {
        window.setTimeout(() => {
          el.style.transition =
            'opacity 500ms ease, transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1)';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, drawableFinish + i * 120);
      });

      const dimensionFinish =
        drawableFinish + dimensionLines.length * 120 + 200;

      // Pushpins pop in with the label callouts, staggered like
      // someone pinning notes onto the drawing sheet.
      pushpins.forEach((el, i) => {
        window.setTimeout(() => {
          el.style.transition =
            'opacity 350ms ease, transform 450ms cubic-bezier(0.34, 1.56, 0.64, 1)';
          el.style.opacity = '1';
          el.style.transform = 'scale(1)';
        }, dimensionFinish + i * 150);
      });

      labels.forEach((el, i) => {
        window.setTimeout(() => {
          el.style.transition = 'opacity 400ms ease';
          el.style.opacity = '1';
        }, dimensionFinish + i * 150 + 80);
      });

      window.setTimeout(() => {
        svg.classList.remove('is-drawing');
        svg.classList.add('is-drawn');
      }, dimensionFinish + pushpins.length * 150 + 500);
    }

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              runAnimation();
              observer.disconnect();
            }
          });
        },
        { threshold: 0.25 }
      );
      observer.observe(svg);
    } else {
      // Fallback: just run on load
      window.addEventListener('load', runAnimation);
    }
  }

  /* ----------------------------------------------------------
     3. SCROLL-REVEAL FOR BLUEPRINT PANELS
     Section cards fade/rise into place like drawings being
     pinned onto the sheet as you scroll, using a shared
     observer to keep things light.
  ---------------------------------------------------------- */
  function initPanelReveal() {
    const panels = document.querySelectorAll(
      '.blueprint-panel, .reveal-on-scroll'
    );
    if (!panels.length) return;

    if (!('IntersectionObserver' in window)) {
      panels.forEach((p) => p.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    panels.forEach((panel) => observer.observe(panel));
  }

  /* ----------------------------------------------------------
     4. SUBTLE PARALLAX DRIFT ON DRAFTING GRID BACKDROP
     Mouse movement and scroll position gently nudge the
     background grid, giving the impression of a drawing
     sheet floating just beneath the surface. Reduced-motion
     users get a static grid.
  ---------------------------------------------------------- */
  function initGridParallax() {
    const grid = document.querySelector('.drafting-grid, .grid-backdrop');
    if (!grid) return;

    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (prefersReduced) return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let ticking = false;

    const maxShift = 14; // px, kept subtle

    function onPointerMove(e) {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const nx = (e.clientX / w) * 2 - 1; // -1 to 1
      const ny = (e.clientY / h) * 2 - 1;
      targetX = nx * maxShift;
      targetY = ny * maxShift;
      requestTick();
    }

    function onScroll() {
      const scrollY = window.scrollY || window.pageYOffset || 0;
      targetY = -(scrollY * 0.03) % (maxShift * 4);
      requestTick();
    }

    function requestTick() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    function update() {
      currentX += (targetX - currentX) *