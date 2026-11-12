// Interactive visuals: "follow one deal" walkthrough and "trace a request" architecture map.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
};

/* ───────────────────────── Follow one deal ───────────────────────── */

const BASE = {
  status: "DRAFT", checks: {}, up: 0, down: 0, working: 0, comments: 0,
  hot: null, badge: null, toast: null, clicks: 0,
};

const JOURNEY = [
  {
    icon: "👀", title: "Spotted", actor: "Priya, a shopper",
    text: "Priya notices boAt Airdopes 141 on Flipkart for ₹799, down from ₹2,990, and wants to share it.",
    tech: ["Flipkart product page"],
    state: {},
  },
  {
    icon: "📝", title: "Posted", actor: "Priya → SnatchPicks web/app",
    text: "She taps Post and fills in the link, price, original price, category and expiry. The deal is saved as PENDING with its first price-history point.",
    tech: ["Middleware: sign-in + rate limit", "POST /api/deals", "Postgres"],
    state: { status: "PENDING" },
  },
  {
    icon: "🛡️", title: "Safety checks", actor: "Moderation pipeline",
    text: "No malware or phishing on the link, no live deal with the same URL, and ₹2,990 is 3.7× the price, under the 5× fake-MRP limit. All three checks pass.",
    tech: ["Google Safe Browsing", "Duplicate check", "Price sanity"],
    state: { status: "PENDING", checks: { url: 1, dup: 1, price: 1 } },
    stagger: ["url", "dup", "price"],
  },
  {
    icon: "🤖", title: "AI review", actor: "gpt-4o-mini",
    text: "The AI reads the title, description and link: legit, confidence 0.91. That's above the 0.82 bar, so it's auto-approved and goes live. A less certain verdict would wait for an admin.",
    tech: ["OpenAI gpt-4o-mini", "status → ACTIVE"],
    state: { status: "ACTIVE", checks: { url: 1, dup: 1, price: 1, ai: 1 } },
  },
  {
    icon: "🔔", title: "Alerted", actor: "send-alerts job → Rahul",
    text: "Rahul has an alert for “earbuds”, at least 50% off. Within 30 minutes the alert job matches the new deal and sends it to him: by email today, and as a phone push once app push is configured for the store builds.",
    tech: ["Vercel cron (every 30 min)", "Expo Push", "Resend email"],
    state: { status: "ACTIVE", checks: { url: 1, dup: 1, price: 1, ai: 1 }, toast: true },
  },
  {
    icon: "🗳️", title: "Community", actor: "Other shoppers",
    text: "Over two hours shoppers upvote it, confirm it still works, and swap card-offer tips in the comments. Priya earns +1 reputation for every upvote.",
    tech: ["POST /api/votes", "Status votes", "Comments"],
    state: { status: "ACTIVE", checks: { url: 1, dup: 1, price: 1, ai: 1 }, up: 24, down: 2, working: 12, comments: 5 },
  },
  {
    icon: "🔥", title: "Ranked", actor: "Hot score",
    text: "Hot score = (24 − 2) ÷ (2 h + 2)^1.5 = 22 ÷ 8 = 2.75. Above 2 means 🔥 HOT, so it climbs near the top of the Hot feed.",
    tech: ["Recomputed on every vote", "Hourly recalc job"],
    state: { status: "ACTIVE", checks: { url: 1, dup: 1, price: 1, ai: 1 }, up: 24, down: 2, working: 12, comments: 5, hot: 2.75, badge: "🔥 HOT" },
  },
  {
    icon: "🛒", title: "Bought", actor: "Rahul → Flipkart",
    text: "Rahul taps through to Flipkart and buys it. The outbound click is counted and carries an affiliate tag, which is how SnatchPicks earns.",
    tech: ["Click tracking", "Affiliate link"],
    state: { status: "ACTIVE", checks: { url: 1, dup: 1, price: 1, ai: 1 }, up: 31, down: 2, working: 15, comments: 7, hot: 2.75, badge: "🔥 HOT", clicks: 1 },
  },
  {
    icon: "⌛", title: "Expired", actor: "expire-deals job",
    text: "The sale ends. A job running every 15 minutes sees the expiry time has passed, marks the deal EXPIRED and it leaves the feeds. The community can also retire a deal: 10+ EXPIRED votes that outnumber WORKING 2 to 1.",
    tech: ["Vercel cron (every 15 min)", "status → EXPIRED"],
    state: { status: "EXPIRED", checks: { url: 1, dup: 1, price: 1, ai: 1 }, up: 31, down: 2, working: 15, comments: 7, hot: 2.75, clicks: 1 },
  },
];

const CHECKS = [
  ["url", "🛡️ Safe link"],
  ["dup", "🔁 Not a duplicate"],
  ["price", "💰 Honest price"],
  ["ai", "🤖 AI approved"],
];

function initJourney(root) {
  const track = el("div", { class: "j-track", role: "tablist", "aria-label": "Deal journey steps" });
  const fill = el("div", { class: "j-fill" });
  track.append(el("div", { class: "j-rail" }, fill));
  const stops = JOURNEY.map((s, i) => {
    const b = el("button", { class: "j-stop", role: "tab", type: "button", "aria-label": `Step ${i + 1}: ${s.title}` },
      el("span", { class: "j-dot" }, s.icon), el("span", { class: "j-label" }, s.title));
    b.addEventListener("click", () => { stop(); go(i); });
    track.append(b);
    return b;
  });

  const card = el("div", { class: "deal-card" });
  card.innerHTML = `
    <div class="dc-toast" aria-hidden="true"><b>🔔 SnatchPicks · now</b><span>New deal for “earbuds”: boAt Airdopes 141 at ₹799 (73% off)</span></div>
    <div class="dc-top"><span class="dc-store">Flipkart</span><span class="dc-status"></span></div>
    <div class="dc-body">
      <div class="dc-img">🎧</div>
      <div>
        <div class="dc-title">boAt Airdopes 141 TWS Earbuds</div>
        <div class="dc-price"><b>₹799</b> <s>₹2,990</s> <span class="dc-off">73% off</span></div>
        <div class="dc-badge"></div>
      </div>
    </div>
    <div class="dc-checks">${CHECKS.map(([k, label]) => `<span class="chk" data-k="${k}">${label}</span>`).join("")}</div>
    <div class="dc-stats">
      <span>👍 <b data-f="up">0</b></span><span>👎 <b data-f="down">0</b></span>
      <span>✔️ <b data-f="working">0</b> working</span><span>💬 <b data-f="comments">0</b></span>
      <span class="dc-hot">Hot score <b data-f="hot">–</b></span>
    </div>
    <div class="dc-click">🛒 Clicked out to Flipkart</div>`;

  const detail = el("div", { class: "j-detail", "aria-live": "polite" });
  const prev = el("button", { class: "btn", type: "button" }, "◀ Back");
  const play = el("button", { class: "btn primary", type: "button" }, "▶ Play");
  const next = el("button", { class: "btn", type: "button" }, "Next ▶");
  const counter = el("span", { class: "j-count" });
  prev.addEventListener("click", () => { stop(); go(Math.max(0, current - 1)); });
  next.addEventListener("click", () => { stop(); go(Math.min(JOURNEY.length - 1, current + 1)); });
  play.addEventListener("click", () => (timer ? stop() : start()));

  root.append(track, el("div", { class: "j-stage" }, card, detail), el("div", { class: "j-controls" }, prev, play, next, counter));

  let current = 0;
  let timer = null;
  let renderToken = 0;

  async function render(step) {
    const token = ++renderToken;
    const st = { ...BASE, ...step.state, checks: { ...(step.state.checks || {}) } };
    const status = card.querySelector(".dc-status");
    status.textContent = st.status === "DRAFT" ? "not posted yet" : st.status;
    status.dataset.s = st.status;
    card.classList.toggle("expired", st.status === "EXPIRED");
    card.classList.toggle("toasting", !!st.toast);
    card.classList.toggle("clicked", st.clicks > 0);
    for (const f of ["up", "down", "working", "comments"]) animateNumber(card.querySelector(`[data-f="${f}"]`), st[f]);
    card.querySelector('[data-f="hot"]').textContent = st.hot == null ? "–" : st.hot.toFixed(2);
    const badge = card.querySelector(".dc-badge");
    badge.textContent = st.badge || "";
    badge.classList.toggle("on", !!st.badge);

    const staggered = new Set(step.stagger || []);
    for (const [k] of CHECKS) {
      const chip = card.querySelector(`.chk[data-k="${k}"]`);
      if (!staggered.has(k)) chip.classList.toggle("ok", !!st.checks[k]);
      else chip.classList.remove("ok");
    }
    for (const k of step.stagger || []) {
      if (!reducedMotion) await sleep(450);
      if (token !== renderToken) return;
      card.querySelector(`.chk[data-k="${k}"]`).classList.add("ok");
    }
  }

  function go(i) {
    current = i;
    const step = JOURNEY[i];
    stops.forEach((b, j) => {
      b.classList.toggle("done", j < i);
      b.classList.toggle("active", j === i);
      b.setAttribute("aria-selected", String(j === i));
    });
    fill.style.width = `${(i / (JOURNEY.length - 1)) * 100}%`;
    detail.innerHTML = "";
    detail.append(
      el("div", { class: "j-step-no" }, `Step ${i + 1} of ${JOURNEY.length}`),
      el("h4", {}, `${step.icon} ${step.title}`),
      el("div", { class: "j-actor" }, step.actor),
      el("p", {}, step.text),
      el("div", { class: "j-tech" }, ...step.tech.map((t) => el("span", { class: "pill" }, t))),
    );
    counter.textContent = `${i + 1} / ${JOURNEY.length}`;
    prev.disabled = i === 0;
    next.disabled = i === JOURNEY.length - 1;
    render(step);
  }

  function start() {
    if (current === JOURNEY.length - 1) go(0);
    play.textContent = "⏸ Pause";
    timer = setInterval(() => {
      if (current === JOURNEY.length - 1) return stop();
      go(current + 1);
    }, 4800);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    play.textContent = "▶ Play";
  }

  go(0);
  if (!reducedMotion) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { threshold: 0.5 });
    io.observe(root);
  }
}

function animateNumber(node, to) {
  const from = Number(node.textContent) || 0;
  if (reducedMotion || from === to) { node.textContent = String(to); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / 700);
    node.textContent = String(Math.round(from + (to - from) * p));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ───────────────────────── Trace a request ───────────────────────── */

const W = 200, H = 60;
const NODES = {
  browser: { x: 20, y: 60, icon: "🌐", label: "Browser / PWA", sub: "shoppers & admins", g: "client" },
  app: { x: 20, y: 180, icon: "📲", label: "Expo app", sub: "iOS · Android", g: "client" },
  ext: { x: 20, y: 300, icon: "🧩", label: "Chrome extension", sub: "on retailer sites", g: "client" },
  mw: { x: 270, y: 60, icon: "🚦", label: "Middleware", sub: "roles · rate limits", g: "vercel" },
  redis: { x: 270, y: 300, icon: "⚡", label: "Upstash Redis", sub: "rate-limit counters", g: "data" },
  db: { x: 270, y: 440, icon: "🗄️", label: "Neon Postgres", sub: "Prisma · 33 models", g: "data" },
  web: { x: 520, y: 60, icon: "▲", label: "Web app & API", sub: "Next.js on Vercel", g: "vercel" },
  cron: { x: 520, y: 300, icon: "⏰", label: "Vercel cron", sub: "8 scheduled jobs", g: "vercel" },
  scraper: { x: 520, y: 440, icon: "🕷️", label: "Scraper", sub: "GitHub Actions", g: "jobs" },
  openai: { x: 770, y: 0, icon: "🤖", label: "OpenAI", sub: "gpt-4o-mini", g: "ext" },
  gsb: { x: 770, y: 75, icon: "🛡️", label: "Safe Browsing", sub: "URL reputation", g: "ext" },
  push: { x: 770, y: 180, icon: "🔔", label: "Expo & Web Push", sub: "notifications", g: "ext" },
  mail: { x: 770, y: 255, icon: "✉️", label: "Resend", sub: "email & digests", g: "ext" },
  tg: { x: 770, y: 330, icon: "✈️", label: "Telegram", sub: "channel & bot", g: "ext" },
  feeds: { x: 770, y: 440, icon: "📦", label: "Partner feeds", sub: "Keepa · Flipkart · Cuelinks…", g: "ext" },
};
const LINKS = [
  ["browser", "mw"], ["app", "mw"], ["ext", "mw"], ["mw", "web"], ["mw", "redis"], ["web", "db"],
  ["web", "openai"], ["web", "gsb"], ["web", "push"], ["web", "mail"], ["web", "tg"], ["cron", "web"],
  ["scraper", "feeds"], ["scraper", "db"], ["push", "app"],
];

const SCENARIOS = [
  {
    id: "submit", label: "📝 Submit a deal",
    steps: [
      ["browser", "mw", "Priya submits the deal form. Middleware sees a signed-in user on a write endpoint."],
      ["mw", "redis", "It checks the per-IP rate limit for submissions in Redis."],
      ["mw", "web", "The request reaches POST /api/deals, which also caps each user at 3 deals an hour."],
      ["web", "db", "The deal is saved as PENDING, along with its first price-history point."],
      ["web", "gsb", "Moderation step 1: is the link malware or phishing?"],
      ["web", "db", "Steps 2–3: is the URL already live, and is the price honest (no fake MRP)?"],
      ["web", "openai", "Step 4: gpt-4o-mini classifies it as legit, spam, malicious or unclear."],
      ["web", "db", "A confident “legit” sets it ACTIVE; unclear goes to the admin queue."],
      ["web", "browser", "Priya immediately sees whether it's live or awaiting review."],
    ],
  },
  {
    id: "alert", label: "🔔 Instant alert",
    steps: [
      ["cron", "web", "Every 30 minutes Vercel cron calls the send-alerts job."],
      ["web", "db", "It loads deals that went live in the last 31 minutes and every active alert."],
      ["web", "web", "Each deal is matched on keyword, category, store and minimum discount."],
      ["web", "push", "Matching users' devices are notified through Expo Push, in batches of 100."],
      ["push", "app", "Rahul's phone buzzes (once app push is configured). Opening the deal from the notification is still being fixed."],
      ["web", "mail", "He also gets one email summarising his matches."],
    ],
  },
  {
    id: "vote", label: "👍 Upvote",
    steps: [
      ["app", "mw", "Rahul taps 👍 in the app. The request carries his Bearer token."],
      ["mw", "redis", "Middleware applies the per-IP rate limit for votes…"],
      ["mw", "web", "…and turns the Bearer token into a normal session for POST /api/votes."],
      ["web", "db", "The vote is upserted, totals recounted, the hot score recomputed and the poster's reputation updated."],
      ["web", "tg", "If the hot score just crossed 10, the deal is auto-posted to the Telegram channel."],
      ["web", "app", "The new counts come back and the app updates instantly."],
    ],
  },
  {
    id: "scraper", label: "🕷️ Scraper import",
    steps: [
      ["scraper", "feeds", "A GitHub Actions run asks each partner feed (Keepa, Flipkart, Myntra, Cuelinks, INRDeals) for offers."],
      ["feeds", "scraper", "Offers come back; prices are normalized and sanity-checked, and links already live are skipped."],
      ["scraper", "db", "New offers land in the ScrapedDeal review queue as PENDING_REVIEW."],
      ["browser", "mw", "An admin opens /admin/scraper; middleware verifies the ADMIN role."],
      ["mw", "web", "The admin picks a category and approves."],
      ["web", "db", "A verified ACTIVE deal is created from the scraped offer."],
      ["web", "tg", "Qualifying deals are posted to Telegram."],
    ],
  },
  {
    id: "signin", label: "🔑 App sign-in",
    steps: [
      ["app", "mw", "The app opens /api/mobile/auth in an in-app browser with a random state value."],
      ["mw", "web", "The user signs in with Google or email and password."],
      ["web", "db", "NextAuth loads the account and role."],
      ["web", "app", "The browser redirects to snatchpicks://auth with the session token and the same state."],
      ["app", "app", "The app checks the state and stores the token in the device's SecureStore."],
      ["app", "mw", "Every later API call sends it as a Bearer header; middleware converts it to a session."],
    ],
  },
  {
    id: "extension", label: "🧩 Extension lookup",
    steps: [
      ["ext", "mw", "On a product page (say Amazon.in), the extension asks SnatchPicks about this URL. (The unpublished build still points at an old domain; that is fixed before publishing.)"],
      ["mw", "web", "GET /api/extension handles the lookup."],
      ["web", "db", "It finds a matching live deal, its price history and the store's cashback."],
      ["web", "ext", "The toolbar badge shows the discount; the popup shows price history and coupons."],
    ],
  },
];

const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const center = (n) => ({ x: n.x + W / 2, y: n.y + H / 2 });

// Point where the segment from the centre of `n` towards `p` leaves its box.
function exitPoint(n, p) {
  const c = center(n);
  const dx = p.x - c.x, dy = p.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? (W / 2 + 4) / Math.abs(dx) : Infinity, dy ? (H / 2 + 4) / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
function segment(a, b) {
  const A = NODES[a], B = NODES[b];
  return [exitPoint(A, center(B)), exitPoint(B, center(A))];
}

function initTracer(root) {
  const svg = svgEl("svg", { viewBox: "0 -10 980 530", class: "tracer-svg", role: "img", "aria-label": "SnatchPicks architecture map" });
  const linkLayer = svgEl("g", { class: "t-links" });
  const hotLayer = svgEl("g", { class: "t-hot" });
  const nodeLayer = svgEl("g", { class: "t-nodes" });
  svg.append(linkLayer, hotLayer, nodeLayer);

  for (const [a, b] of LINKS) {
    const [p, q] = segment(a, b);
    linkLayer.append(svgEl("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: "t-link" }));
  }
  const nodeEls = {};
  for (const [id, n] of Object.entries(NODES)) {
    const g = svgEl("g", { class: `t-node g-${n.g}`, transform: `translate(${n.x},${n.y})` });
    g.append(svgEl("rect", { width: W, height: H, rx: 12 }));
    const icon = svgEl("text", { x: 14, y: 38, class: "t-icon" });
    icon.textContent = n.icon;
    const label = svgEl("text", { x: 48, y: 27, class: "t-label" });
    label.textContent = n.label;
    const sub = svgEl("text", { x: 48, y: 45, class: "t-sub" });
    sub.textContent = n.sub;
    g.append(icon, label, sub);
    nodeLayer.append(g);
    nodeEls[id] = g;
  }

  const buttons = el("div", { class: "t-buttons", role: "group", "aria-label": "Scenarios" });
  const list = el("ol", { class: "t-steps" });
  const caption = el("div", { class: "t-caption", "aria-live": "polite" }, "Pick a scenario to watch the request travel through the system.");
  root.append(buttons, caption, el("div", { class: "t-canvas" }, svg), list);

  let run = 0;
  const btns = SCENARIOS.map((sc) => {
    const b = el("button", { class: "btn", type: "button" }, sc.label);
    b.addEventListener("click", () => play(sc));
    buttons.append(b);
    return b;
  });

  async function play(sc) {
    const my = ++run;
    btns.forEach((b, i) => b.classList.toggle("primary", SCENARIOS[i] === sc));
    hotLayer.replaceChildren();
    Object.values(nodeEls).forEach((g) => g.classList.remove("active", "visited"));
    list.replaceChildren();
    caption.textContent = "";
    root.classList.add("playing");

    for (const [i, [a, b, text]] of sc.steps.entries()) {
      if (my !== run) return;
      const li = el("li", { class: "active" }, text);
      list.querySelectorAll("li.active").forEach((x) => x.classList.remove("active"));
      list.append(li);
      caption.replaceChildren(el("b", {}, `${i + 1}/${sc.steps.length}`), " ", text);
      Object.values(nodeEls).forEach((g) => g.classList.remove("active"));
      nodeEls[a].classList.add("active", "visited");
      nodeEls[b].classList.add("active", "visited");

      if (a !== b) {
        const [p, q] = segment(a, b);
        hotLayer.querySelectorAll(".t-path.now").forEach((x) => x.classList.remove("now"));
        const path = svgEl("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: "t-path now" });
        const num = svgEl("text", { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - 6, class: "t-num" });
        num.textContent = String(i + 1);
        const dot = svgEl("circle", { r: 8, class: "t-packet", cx: p.x, cy: p.y });
        hotLayer.append(path, num, dot);
        await travel(dot, p, q, my);
        dot.remove();
      } else {
        await sleep(reducedMotion ? 0 : 500);
      }
      await sleep(reducedMotion ? 0 : 1100);
    }
    if (my === run) {
      Object.values(nodeEls).forEach((g) => g.classList.remove("active"));
      root.classList.remove("playing");
    }
  }

  function travel(dot, p, q, my) {
    if (reducedMotion) return Promise.resolve();
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (t) => {
        if (my !== run) return resolve();
        const k = Math.min(1, (t - t0) / 900);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        dot.setAttribute("cx", p.x + (q.x - p.x) * e);
        dot.setAttribute("cy", p.y + (q.y - p.y) * e);
        k < 1 ? requestAnimationFrame(tick) : resolve();
      };
      requestAnimationFrame(tick);
    });
  }
}

document.querySelectorAll("[data-journey]").forEach(initJourney);
document.querySelectorAll("[data-tracer]").forEach(initTracer);
