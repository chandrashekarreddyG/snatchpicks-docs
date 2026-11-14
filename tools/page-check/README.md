# page-check

Headless Chromium (Playwright) checks for the docs pages. Runs in GitHub Actions
(`.github/workflows/page-check.yml`) on every pull request and on manual dispatch.
Not site content; GitHub Pages publishes this folder, which is harmless.

## What it checks

Each page runs in 4 contexts: desktop 1280x800 and mobile 390x844, each in light and dark.

- page errors, console errors, navigation failures;
- failed requests to the site itself and to known CDN hosts (`cdn.jsdelivr.net`, ...);
  other external failures are listed in the report but do not fail the check;
- mermaid blocks rendered vs. blocks present, and syntax errors;
- horizontal overflow (`scrollWidth > innerWidth`);
- WebGL availability (software WebGL via SwiftShader).

## Run locally

```
cd tools/page-check
npm ci
npx playwright install --with-deps chromium
python3 -m http.server 8000 --bind 127.0.0.1 --directory ../..   # in another shell
node check.mjs http://127.0.0.1:8000/index.html
node check.mjs --list=pages.txt --click='#menu-button'   # one URL per line
```

Options: `--list=<file>`, `--wait=<ms>` (settle time after load, default 3000),
`--click=<css>` (repeatable; reports whether visible state changed).

## Output

`out/<slug>.json` per page, `out/<slug>-<ctx>.png` screenshots, `out/summary.json`.
Exit code: 0 all pages pass, 1 problems found, 2 usage or launch error.
