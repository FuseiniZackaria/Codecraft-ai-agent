// script.js
// CodeCraft AI - Landing Page Interactions
// Handles: mobile nav toggle, smooth scroll, FAQ accordion,
// scroll-triggered fade-in animations, and pricing monthly/yearly toggle.

document.addEventListener('DOMContentLoaded', function () {
  initMobileNav();
  initSmoothScroll();
  initFaqAccordion();
  initScrollFadeIn();
  initPricingToggle();
});

/* ------------------------------------------------------------------ */
/* Mobile Nav Toggle                                                   */
/* ------------------------------------------------------------------ */
function initMobileNav() {
  var navToggle = document.querySelector('.nav-toggle');
  var navMenu = document.querySelector('.nav-menu');
  var body = document.body;

  if (!navToggle || !navMenu) return;

  navToggle.addEventListener('click', function () {
    var isOpen = navMenu.classList.toggle('open');
    navToggle.classList.toggle('active', isOpen);
    navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    body.classList.toggle('nav-open', isOpen);
  });

  // Close menu when a nav link is clicked (useful on mobile)
  var navLinks = navMenu.querySelectorAll('a');
  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      if (navMenu.classList.contains('open')) {
        navMenu.classList.remove('open');
        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
        body.classList.remove('nav-open');
      }
    });
  });

  // Close menu when clicking outside of it
  document.addEventListener('click', function (e) {
    var isClickInsideNav = navMenu.contains(e.target) || navToggle.contains(e.target);
    if (!isClickInsideNav && navMenu.classList.contains('open')) {
      navMenu.classList.remove('open');
      navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
      body.classList.remove('nav-open');
    }
  });

  // Close menu on escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && navMenu.classList.contains('open')) {
      navMenu.classList.remove('open');
      navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
      body.classList.remove('nav-open');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Smooth Scroll for Anchor Links                                      */
/* ------------------------------------------------------------------ */
function initSmoothScroll() {
  var anchorLinks = document.querySelectorAll('a[href^="#"]');

  anchorLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');

      if (!targetId || targetId === '#' || targetId.length < 2) return;

      var targetEl = document.querySelector(targetId);
      if (!targetEl) return;

      e.preventDefault();

      var header = document.querySelector('.header, .site-header, nav');
      var offset = header ? header.offsetHeight : 0;

      var targetPosition =
        targetEl.getBoundingClientRect().top + window.pageYOffset - offset - 16;

      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });

      // Update URL hash without jumping
      if (history.pushState) {
        history.pushState(null, null, targetId);
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* FAQ Accordion                                                       */
/* ------------------------------------------------------------------ */
function initFaqAccordion() {
  var faqItems = document.querySelectorAll('.faq-item');
  if (!faqItems.length) return;

  faqItems.forEach(function (item) {
    var question = item.querySelector('.faq-question');
    var answer = item.querySelector('.faq-answer');

    if (!question || !answer) return;

    // Prepare initial collapsed state
    answer.style.maxHeight = null;
    item.classList.remove('active');

    question.setAttribute('role', 'button');
    question.setAttribute('tabindex', '0');
    question.setAttribute('aria-expanded', 'false');

    function toggleItem() {
      var isActive = item.classList.contains('active');

      // Close all other FAQ items (single-open accordion behavior)
      faqItems.forEach(function (otherItem) {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
          var otherAnswer = otherItem.querySelector('.faq-answer');
          var otherQuestion = otherItem.querySelector('.faq-question');
          if (otherAnswer) otherAnswer.style.maxHeight = null;
          if (otherQuestion) otherQuestion.setAttribute('aria-expanded', 'false');
        }
      });

      if (isActive) {
        item.classList.remove('active');
        answer.style.maxHeight = null;
        question.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('active');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        question.setAttribute('aria-expanded', 'true');
      }
    }

    question.addEventListener('click', toggleItem);
    question.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleItem();
      }
    });
  });

  // Recalculate open answer heights on window resize
  window.addEventListener('resize', function () {
    faqItems.forEach(function (item) {
      if (item.classList.contains('active')) {
        var answer = item.querySelector('.faq-answer');
        if (answer) {
          answer.style.maxHeight = answer.scrollHeight + 'px';
        }
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Scroll-Triggered Fade-In Animations                                 */
/* ------------------------------------------------------------------ */
function initScrollFadeIn() {
  var fadeElements = document.querySelectorAll(
    '.fade-in, section, .section, .card, .pricing-card, .feature'
  );

  if (!fadeElements.length) return;

  if (!('IntersectionObserver' in window)) {
    // Fallback: show everything immediately
    fadeElements.forEach(function (el) {
      el.classList.add('visible');
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -50px 0px'
    }
  );

  fadeElements.forEach(function (el) {
    el.classList.add('fade-in');
    observer.observe(el);
  });
}

/* ------------------------------------------------------------------ */
/* Pricing Toggle (Monthly / Yearly)                                    */
/* ------------------------------------------------------------------ */
function initPricingToggle() {
  var pricingToggle = document.querySelector('.pricing-toggle input[type="checkbox"]');
  var pricingSwitchButtons = document.querySelectorAll('.pricing-toggle-btn');
  var priceElements = document.querySelectorAll('[data-monthly][data-yearly]');

  if (!priceElements.length) return;

  function updatePrices(showYearly) {
    priceElements.forEach(function (el) {
      var monthly = el.getAttribute('data-monthly');
      var yearly = el.getAttribute('data-yearly');
      el.textContent = showYearly ? yearly : monthly;
    });

    document.body.classList.toggle('yearly-active', showYearly);
    document.body.classList.toggle('monthly-active', !showYearly);

    var yearlyLabel = document.querySelector('.pricing-label-yearly');
    var monthlyLabel = document.querySelector('.pricing-label-monthly');

    if (yearlyLabel) yearlyLabel.classList.toggle('active', showY