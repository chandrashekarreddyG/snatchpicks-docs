#!/usr/bin/env node
// Page checker for CI.
// Usage: node check.mjs [--list=<file>] [--wait=ms] [--click=<css>]... [url...]
// --list: file with one URL per line (blank lines and lines starting with # are skipped).
// Each URL runs in 4 contexts: desktop 1280x800 and mobile 390x844, each light and dark.
// Writes out/<slug>.json, out/<slug>-<ctx>.png and out/summary.json.
// Exit: 0 all pages pass, 1 any page has problems, 2 usage or launch error.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');

const CONTEXTS = [
  { name: 'desktop-light', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'desktop-dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
  { name: 'mobile-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
];

// Software WebGL for headless CI runners (no GPU).
const LAUNCH_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

// Hosts the pages depend on at runtime. A failed request to one of these fails the check.
// Failed requests to other hosts are listed in the report but do not fail it.
const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.skypack.dev',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

function parseArgs(argv) {
  const urls = [];
  const clicks = [];
  let wait = 3000;
  let list = null;
  for (const a of argv) {
    if (a.startsWith('--wait=')) wait = Number(a.slice('--wait='.length));
    else if (a.startsWith('--click=')) clicks.push(a.slice('--click='.length));
    else if (a.startsWith('--list=')) list = a.slice('--list='.length);
    else if (a.startsWith('--')) throw new Error(`unknown option: ${a}`);
    else urls.push(a);
  }
  if (!Number.isFinite(wait) || wait < 0) throw new Error(`invalid --wait: ${wait}`);
  return { urls, list, wait, clicks };
}

async function collectUrls(opts) {
  const urls = [...opts.urls];
  if (opts.list) {
    const lines = (await readFile(opts.list, 'utf8')).split('\n');
    urls.push(...lines.map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
  }
  if (urls.length === 0) {
    throw new Error('usage: node check.mjs [--list=<file>] [--wait=ms] [--click=<css>]... [url...]');
  }
  return urls;
}

function slugOf(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, '') || '/index';
  return (u.host + path).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Page-side metrics, collected after details are opened and the page has settled.
function collectMetrics() {
  const mermaidBlocks = [...new Set([...document.querySelectorAll('pre.mermaid, .mermaid')])];
  const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
    width: c.width,
    height: c.height,
    nonZero: c.width > 0 && c.height > 0,
  }));
  const gl2 = !!document.createElement('canvas').getContext('webgl2');
  const gl1 = !!document.createElement('canvas').getContext('webgl');
  return {
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((e) => e.textContent.trim()),
    h2: [...document.querySelectorAll('h2')].map((e) => e.textContent.trim()),
    mermaid: {
      preMermaid: document.querySelectorAll('pre.mermaid').length,
      blocks: mermaidBlocks.length,
      renderedBlocks: mermaidBlocks.filter((b) => b.querySelector('svg')).length,
      svgInsideMermaid: document.querySelectorAll('.mermaid svg, pre.mermaid svg').length,
      errorBlocks: mermaidBlocks.filter((b) => /Syntax error|Parse error/i.test(b.textContent)).length,
    },
    canvas: {
      count: canvases.length,
      nonZero: canvases.filter((c) => c.nonZero).length,
      details: canvases,
    },
    webgl: { webgl2: gl2, webgl1: gl1, webgl: gl2 || gl1 },
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
}

// Snapshot used to decide whether a click changed something visible.
function clickSnapshot() {
  return {
    text: document.body ? document.body.innerText : '',
    expanded: [...document.querySelectorAll('[aria-expanded]')]
      .map((e) => e.getAttribute('aria-expanded'))
      .join(','),
    openDetails: document.querySelectorAll('details[open]').length,
  };
}

async function snapshot(page) {
  try {
    return JSON.stringify(await page.evaluate(clickSnapshot));
  } catch {
    return null;
  }
}

async function runClicks(page, selectors) {
  const results = [];
  for (const selector of selectors) {
    const rec = { selector, found: false, clicked: false, changed: false };
    const count = await page.locator(selector).count();
    if (count === 0) {
      rec.error = 'no match';
      results.push(rec);
      continue;
    }
    rec.found = true;
    const before = await snapshot(page);
    try {
      await page.locator(selector).first().click({ timeout: 5000 });
      rec.clicked = true;
    } catch (e) {
      rec.error = String(e.message).split('\n')[0];
    }
    await page.waitForTimeout(800);
    await page.waitForLoadState('networkidle').catch(() => {});
    const after = await snapshot(page);
    rec.changed = before !== null && after !== null && before !== after;
    results.push(rec);
  }
  return results;
}

function isCdn(host) {
  return CDN_HOSTS.includes(host);
}

// Turns one context's raw results into a list of problems (empty = pass).
function problemsOf(ctxResult) {
  const name = ctxResult.context;
  const problems = [];
  if (ctxResult.error) problems.push(`${name}: navigation/check failed: ${ctxResult.error}`);
  for (const e of ctxResult.pageErrors || []) problems.push(`${name}: pageerror: ${e}`);
  for (const m of ctxResult.consoleMessages || []) {
    if (m.type === 'error') {
      problems.push(`${name}: console error: ${m.text}${m.location ? ` (${m.location})` : ''}`);
    }
  }
  for (const r of ctxResult.failedRequests || []) {
    const host = new URL(r.url).host;
    const origin = new URL(r.url).origin;
    if (origin === ctxResult.pageOrigin || isCdn(host)) {
      problems.push(`${name}: failed request ${r.status ?? r.error} ${r.url}`);
    }
  }
  const mm = ctxResult.mermaid;
  if (mm && (mm.renderedBlocks !== mm.blocks || mm.errorBlocks > 0)) {
    problems.push(
      `${name}: mermaid ${mm.renderedBlocks}/${mm.blocks} rendered, ${mm.errorBlocks} with syntax errors`
    );
  }
  if (ctxResult.overflowX) {
    problems.push(`${name}: horizontal overflow ${ctxResult.scrollWidth}px > ${ctxResult.innerWidth}px`);
  }
  return problems;
}

async function runContext(browser, ctx, url, opts, slug) {
  const context = await browser.newContext({
    viewport: ctx.viewport,
    colorScheme: ctx.colorScheme,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageOrigin = new URL(url).origin;
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (m) => {
    const type = m.type();
    if (type === 'error' || type === 'warning') {
      consoleMessages.push({ type, text: m.text(), location: m.location()?.url || undefined });
    }
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (r) =>
    failedRequests.push({ url: r.url(), error: r.failure()?.errorText })
  );
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() });
  });

  const result = {
    context: ctx.name,
    viewport: ctx.viewport,
    colorScheme: ctx.colorScheme,
    pageOrigin,
  };
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    result.mainStatus = resp ? resp.status() : null;
    await page.waitForTimeout(opts.wait);
    result.openedDetails = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('details')];
      ds.forEach((d) => (d.open = true));
      return ds.length;
    });
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle').catch(() => {});
    Object.assign(result, await page.evaluate(collectMetrics));
    const shotPath = join(OUT, `${slug}-${ctx.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    result.screenshot = shotPath;
    result.clicks = await runClicks(page, opts.clicks);
  } catch (e) {
    result.error = String(e.message).split('\n')[0];
  } finally {
    result.consoleMessages = consoleMessages;
    result.pageErrors = pageErrors;
    result.failedRequests = failedRequests;
    await context.close().catch(() => {});
  }
  result.problems = problemsOf(result);
  return result;
}

async function checkUrl(browser, url, opts) {
  const started = Date.now();
  const slug = slugOf(url);
  const contexts = [];
  for (const ctx of CONTEXTS) {
    contexts.push(await runContext(browser, ctx, url, opts, slug));
  }
  const problems = contexts.flatMap((c) => c.problems);
  const external = contexts.flatMap((c) =>
    (c.failedRequests || [])
      .filter((r) => new URL(r.url).origin !== c.pageOrigin && !isCdn(new URL(r.url).host))
      .map((r) => `${c.context}: ${r.status ?? r.error} ${r.url}`)
  );
  return {
    url,
    slug,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    wait: opts.wait,
    clicks: opts.clicks,
    passed: problems.length === 0,
    problems,
    externalFailures: [...new Set(external)],
    contexts,
  };
}

function describe(report) {
  const rows = report.contexts.map((c) => {
    const m = c.mermaid;
    const mer = m ? `${m.renderedBlocks}/${m.blocks}` : '-';
    return `    ${c.context.padEnd(14)} mermaid ${mer.padEnd(5)} webgl ${c.webgl?.webgl ? 'yes' : 'no '} overflow ${c.overflowX ? 'YES' : 'no'}`;
  });
  return rows.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const urls = await collectUrls(opts);
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const reports = [];
  try {
    for (const url of urls) {
      const report = await checkUrl(browser, url, opts);
      reports.push(report);
      await writeFile(join(OUT, `${report.slug}.json`), JSON.stringify(report, null, 2) + '\n');
      console.log(`${report.passed ? 'PASS' : 'FAIL'} ${url}`);
      console.log(describe(report));
      for (const p of report.problems) console.log(`  problem: ${p}`);
      for (const f of report.externalFailures) console.log(`  external (not failing): ${f}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const summary = reports.map((r) => ({
    url: r.url,
    passed: r.passed,
    problems: r.problems.length,
    externalFailures: r.externalFailures.length,
    webgl: r.contexts.every((c) => c.webgl?.webgl === true),
    overflowX: r.contexts.filter((c) => c.overflowX).map((c) => c.context),
    mermaid: r.contexts.map((c) => `${c.context} ${c.mermaid?.renderedBlocks ?? 0}/${c.mermaid?.blocks ?? 0}`),
  }));
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const failed = reports.filter((r) => !r.passed).length;
  console.log(`${reports.length - failed}/${reports.length} pages passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
