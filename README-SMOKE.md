Smoke Test Instructions

This project includes a small Puppeteer smoke-test to validate that the Trade Journal toggles into a full-page dark view and that utility classes are swapped (no !important hacks).

Prerequisites
- Node.js (14+)
- npm

Install dev deps (once):

```powershell
cd "H:\Pribadi\Web management Proyek"
npm init -y
npm install puppeteer --save-dev
```

Run smoke test:

```powershell
node smoke-test.js
```

Notes
- The test loads the local `index.html` via the file:// protocol. If your page loads resources that require an http server (CSP, service worker), run a simple static server (e.g., `npx http-server .`) and update the `file` variable in `smoke-test.js` to the server URL before running.
- The test checks that #trade-section is visible and that at least one element has a `bg-gray-900` class after toggling trade view.
