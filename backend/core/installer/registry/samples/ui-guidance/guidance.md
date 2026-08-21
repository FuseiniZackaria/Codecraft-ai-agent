# UI/UX Design Guidance

When building or reviewing UI, apply these rules in priority order.

## 1. Accessibility (CRITICAL)
- Minimum 4.5:1 color contrast ratio for normal text
- Visible focus rings on all interactive elements
- Descriptive alt text for meaningful images
- aria-label on icon-only buttons
- Tab order matches visual order
- Every form input has a real `<label for="...">`, not just a placeholder

## 2. Touch & Interaction (CRITICAL)
- Minimum 44x44px touch targets
- Disable buttons during async operations, with visible loading state
- Clear error messages placed near the problem, not just at the top of the form
- `cursor-pointer` on every clickable element

## 3. Performance & Layout (HIGH)
- Lazy-load and size images correctly (WebP, srcset)
- Reserve space for async content so nothing jumps in after load
- `width=device-width, initial-scale=1` viewport meta
- Minimum 16px body text on mobile
- No horizontal scroll at any breakpoint
- Define a real z-index scale (10, 20, 30, 50) instead of guessing values

## 4. Typography & Color (MEDIUM)
- Line-height 1.5-1.75 for body text
- 65-75 characters per line max
- Heading and body fonts should feel like they belong together, not clash

## 5. Common mistakes that make UI look unprofessional
- No emoji icons - use a real SVG icon set (Heroicons, Lucide) consistently sized
- Hover states should use color/opacity transitions, not scale transforms that shift layout
- In light mode: `bg-white/80`+ for glass cards (not `bg-white/10`, too transparent),
  `#0F172A` for body text (not gray-400), visible borders (`border-gray-200`, not `border-white/10`)
- Floating navbars need real spacing from the edges (`top-4 left-4 right-4`), not stuck at `top-0`
- Keep container max-width consistent across a page (`max-w-6xl` or `max-w-7xl`, not a mix)

## Pre-delivery checklist
- [ ] No emoji-as-icon anywhere
- [ ] Hover states don't shift layout
- [ ] Light mode text and borders have real contrast, not just dark mode
- [ ] Nothing hidden behind a fixed navbar
- [ ] Responsive at 375px, 768px, 1024px, 1440px with no horizontal scroll
- [ ] All images have alt text, all inputs have labels
- [ ] `prefers-reduced-motion` respected for any animation
