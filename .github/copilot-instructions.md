# Copilot Instructions for BuyO! Shopping PWA

## Project Overview
- This is a Progressive Web App (PWA) for shopping, with a focus on mobile-first, offline support, and fast user experience.
- The app is built using vanilla HTML, CSS, and JavaScript (no frameworks).
- All business logic and UI are handled client-side; there is no backend integration in this codebase.

## Key Structure
- `index.html`, `about.html`, `cart.html`, etc.: Each page is a standalone HTML file, following a consistent header/nav/search/right-nav pattern.
- `assets/`: Contains icons and images. Use relative paths (e.g., `assets/icons/logo2.png`).
- `css/style.css`: All styling is centralized here. Follow existing class naming conventions (e.g., `.nav-left`, `.search-box`).
- `js/app.js`: Main JavaScript for UI logic and interactivity. Use unobtrusive JS (no inline event handlers in HTML).
- `js/sw.js` and `service-worker.js`: Service worker logic for offline support and caching. Register the service worker in `app.js`.
- `manifest.json`: PWA manifest. Update icons and metadata here for branding.
- `data/`: Contains static JSON files for categories, users, and wishlist. These are fetched client-side for dynamic content.

## Patterns & Conventions
- Navigation: The header/nav is repeated across pages. If updating navigation, ensure consistency in all HTML files.
- Use semantic HTML where possible. Accessibility (alt text, labels) is prioritized.
- All images/icons use forward slashes (`/`) in paths for cross-platform compatibility.
- For new features, add corresponding HTML, update navigation, and add supporting JS/CSS as needed.
- No build step is required; all files are served statically.

## PWA/Service Worker
- Register the service worker in `js/app.js`.
- Update `service-worker.js` for caching new assets or pages.
- Test PWA features (installability, offline) using Chrome DevTools.

## Data Handling
- Fetch data from `data/*.json` using `fetch()` in JS.
- Do not hardcode data in HTML; use JS to render dynamic lists (e.g., categories, wishlist).

## Example: Adding a New Page
1. Create `newpage.html` with the standard header/nav/search/right-nav structure.
2. Add navigation link in all relevant HTML files.
3. Add any new assets to `assets/` and reference with relative paths.
4. Add supporting JS in `js/app.js` if needed.

## Testing & Debugging
- Open `index.html` directly in a browser or use a simple static server (e.g., `npx serve .`).
- Use browser DevTools for debugging JS, inspecting service worker, and testing PWA features.

---

If you are unsure about a pattern, check similar files (e.g., for nav structure or data fetching) and follow the established approach.
