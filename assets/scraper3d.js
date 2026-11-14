/*
 * SnatchPicks scraper architecture in 3D (scraper/index.html).
 *
 * Three.js, OrbitControls and CSS2DRenderer come from the page's import map (pinned CDN version)
 * and are imported dynamically, so a device without WebGL 2, a blocked CDN or a start-up error
 * shows the flat SVG in #s3d-fallback instead, quietly. Colours are read from the site's CSS
 * variables and follow light/dark mode; prefers-reduced-motion gives a still scene.
 */

const root = document.getElementById("s3d");

// Fixed partner colours, shared with the legend on the page.
const SOURCE_COLOURS = {
  amazon: "#ff9900",
  flipkart: "#2874f0",
  myntra: "#ff3f6c",
  cuelinks: "#10b981",
  inrdeals: "#ca8a04",
};

const GROUPS = {
  trigger: { name: "Trigger", colour: "--muted" },
  source: { name: "Partner source" },
  fetch: { name: "Adapters", colour: "--accent" },
  check: { name: "Check", colour: "--c-target" },
  store: { name: "Stored data", colour: "--ok" },
  admin: { name: "People", colour: "--warn" },
  output: { name: "Output", colour: "--accent-ink" },
  next: { name: "Improvement", colour: "--c-planned" },
  target: { name: "Target pipeline", colour: "--c-target" },
};

const BADGES = {
  today: { cls: "now", text: "Today" },
  next: { cls: "planned", text: "In progress" },
  target: { cls: "target", text: "Target" },
};

// Pipeline order: this is the Tab order of the labels and the order of the panel's Previous/Next.
// wide = [x, y, z] when the stage is landscape (flow along x); narrow = portrait (flow down y).
const NODES = [
  { id: "schedule", label: "Schedule", group: "trigger", shape: "tetra", layer: "today",
    wide: [-11.25, 1.3, -1.2], narrow: [-1.2, 9.8, 0],
    text: ["A timer can start the scraper every 30 minutes.",
      "It is switched off for now: no partner is connected yet, so a scheduled run would find nothing. Until then the scraper only runs when someone starts it."] },
  { id: "manual", label: "Manual run", short: "Manual", group: "trigger", shape: "tetra", layer: "today",
    wide: [-11.25, 1.3, 1.2], narrow: [1.2, 9.8, 0],
    text: ["A team member can start a run by hand, for every source or for just one.",
      "One script handles the whole run, and each run has a ten-minute limit."] },
  { id: "amazon", label: "Amazon · Keepa", short: "Amazon", group: "source", shape: "box", layer: "today",
    wide: [-8.75, 0, -3.2], narrow: [-3, 6.65, 0],
    text: ["Amazon deals come from Keepa, a price-tracking service with an official API.",
      "Each run asks for recent Amazon.in price drops of at least 20% and takes up to 50 of them. The source is skipped until a partner key is connected."] },
  { id: "flipkart", label: "Flipkart API", short: "Flipkart", group: "source", shape: "cyl", layer: "today",
    wide: [-8.75, 0, -1.6], narrow: [-1.5, 7.65, 0],
    text: ["Flipkart's affiliate API returns its current best offers as structured product data.",
      "Each run takes up to 80 products. The source is skipped until a partner key is connected."] },
  { id: "myntra", label: "Myntra feed", short: "Myntra", group: "source", shape: "cone", layer: "today",
    wide: [-8.75, 0, 0], narrow: [0, 6.65, 0],
    text: ["Myntra has no public deals API, so its products come through an affiliate network's product feed.",
      "Each run takes up to 80 items. The source is skipped until the partner feed is connected."] },
  { id: "cuelinks", label: "Cuelinks offers", short: "Cuelinks", group: "source", shape: "oct", layer: "today",
    wide: [-8.75, 0, 1.6], narrow: [1.5, 7.65, 0],
    text: ["Cuelinks is an affiliate network: one account brings live offers from hundreds of Indian stores.",
      "Each run reads up to 100 offers. The source is skipped until a partner key is connected."] },
  { id: "cuelinks-v3", label: "Offers API v3", short: "API v3", group: "next", shape: "wire", layer: "next",
    wide: [-8.75, 1.9, 2.4], narrow: [3.1, 8.9, 0.8],
    text: ["Cuelinks has retired the version of its offers API that the scraper uses today, so the adapter is moving to version 3.",
      "The new adapter reads offers page by page, with a short pause between pages and a cap on how many it reads, and keeps each offer's categories."] },
  { id: "inrdeals", label: "INRDeals feed", short: "INRDeals", group: "source", shape: "dodec", layer: "today",
    wide: [-8.75, 0, 3.2], narrow: [3, 6.65, 0],
    text: ["INRDeals is another affiliate network, with a deal feed covering many Indian stores.",
      "Each run reads up to 100 deals. The source is skipped until a partner key is connected."] },
  { id: "fetch", label: "Fetch + retries", short: "Fetch", group: "fetch", shape: "torus", layer: "today",
    wide: [-6.25, 0, 0], narrow: [0, 4.75, 0],
    text: ["Each source has a small adapter that calls the partner's API, one source after another.",
      "Every request has a 15-second time limit. If a partner is busy or briefly down, the adapter waits and tries again, up to three more times, waiting longer each time; a clear refusal, such as a rejected key, is not retried."] },
  { id: "logging", label: "Safer logging", short: "Logging", group: "next", shape: "wire", layer: "next",
    wide: [-6.25, 1.9, -1.6], narrow: [-2.2, 4.75, 0.8],
    text: ["Run logs are being tightened so they keep only what is needed to understand a run.",
      "It is a housekeeping change: which deals come in stays the same."] },
  { id: "normalise", label: "Normalise", group: "fetch", shape: "ico", layer: "today",
    wide: [-3.75, 0, 0], narrow: [0, 2.85, 0],
    text: ["Every partner describes a product differently, so the adapter turns each item into one common shape: the source's own ID, title, link, price, original price (MRP), image and category.",
      "Items missing a title, link or ID are left out."] },
  { id: "dedup", label: "Duplicate check", short: "Duplicates", group: "check", shape: "prism", layer: "today",
    wide: [-1.25, 0, 0], narrow: [0, 0.95, 0],
    text: ["Each item's link is compared with every deal that is already live, or waiting for moderation, on SnatchPicks.",
      "The comparison uses the store's address and product path and ignores tracking tags, so the same product isn't added twice. A match is skipped."] },
  { id: "merchant-link", label: "Real merchant link", short: "Merchant link", group: "next", shape: "wire", layer: "next",
    wide: [-1.25, 1.9, -1.6], narrow: [-2.2, 0.95, 0.8],
    text: ["Affiliate networks wrap product links in their own redirect links, and those can look the same for very different products.",
      "The duplicate check will compare the real store link inside the redirect instead. The redirect link is kept separately, so clicks are still credited."] },
  { id: "price", label: "Price check", short: "Prices", group: "check", shape: "prism", layer: "today",
    wide: [1.25, 0, 0], narrow: [0, -0.95, 0],
    text: ["A price of zero or less, or above ₹1 crore, is treated as bad data and the item is dropped.",
      "An MRP that isn't higher than the price is removed, so an item can't show a fake discount. Items with no price at all, such as coupon offers, are allowed through."] },
  { id: "prices", label: "Stricter prices", short: "Stricter", group: "next", shape: "wire", layer: "next",
    wide: [1.25, 1.9, -1.6], narrow: [-2.2, -0.95, 0.8],
    text: ["Some feeds use placeholder prices such as -1 or “N/A”. Today two adapters quietly turn these into “no price”, so the item slips past the price check.",
      "The change passes them on as they are, so the price check drops the item."] },
  { id: "niche", label: "Niche filter", short: "Niche", group: "target", shape: "wire", layer: "target",
    wide: [2.1, 1.6, 1.9], narrow: [2.2, -1.5, 0.8],
    text: ["A planned gate that sets aside items outside the categories SnatchPicks is launching with, starting with beauty and skincare.",
      "Today sources return every category and the reviewer picks one by hand."] },
  { id: "score", label: "Scoring", short: "Score", group: "target", shape: "wire", layer: "target",
    wide: [3.2, 1.6, 1.9], narrow: [2.2, -2.5, 0.8],
    text: ["A planned score, from signals such as discount depth and price history, would sort the review queue so the strongest deals are reviewed first.",
      "Later, high-scoring deals from trusted stores could go live without waiting for review."] },
  { id: "queue", label: "Review queue", short: "Queue", group: "store", shape: "db", layer: "today",
    wide: [3.75, 0, 0], narrow: [0, -2.85, 0],
    text: ["Items that pass the checks are saved to the review queue as “pending review”.",
      "Each item is keyed by its source and that source's own ID. If the same item turns up again, only its price is refreshed, and an item that was already reviewed keeps its decision."] },
  { id: "runlog", label: "Run records", short: "Runs", group: "store", shape: "db", layer: "today",
    wide: [-5, 0, 3], narrow: [2.3, 3.9, 0],
    text: ["Every source gets one run record per run: when it started and ended, whether it completed or failed, how many deals it found and how many were new.",
      "These records are how the team can tell whether deals are flowing."] },
  { id: "failed-runs", label: "Failed runs", short: "Failures", group: "next", shape: "wire", layer: "next",
    wide: [-3.9, 1.6, 3.6], narrow: [3.1, 2.8, 0.8],
    text: ["Today a partner that is down can look like a quiet run that found nothing.",
      "The change records it as a failed run with a short reason, marks sources without a partner key as skipped, and fails the whole job when every connected source fails."] },
  { id: "admin", label: "Admin review", short: "Review", group: "admin", shape: "capsule", layer: "today",
    wide: [6.25, 0, 0], narrow: [0, -4.75, 0],
    text: ["A person checks each pending item, picks its category, and can tidy the title or add a coupon or bank offer before approving or rejecting it.",
      "Nothing from a partner feed goes live without this step."] },
  { id: "live", label: "Live deals", short: "Live", group: "store", shape: "db", layer: "today",
    wide: [8.75, 0, 0], narrow: [0, -6.65, 0],
    text: ["An approved item becomes a normal deal: marked verified, with its discount worked out from the price and MRP, and a first price-history point.",
      "From here it behaves like any other deal on SnatchPicks."] },
  { id: "expiry", label: "Expiry", group: "target", shape: "wire", layer: "target",
    wide: [8.75, 1.9, -1.6], narrow: [-2.2, -6.65, 0.8],
    text: ["Partner offers often have an end date. Carrying it over would take a deal out of the live feed when the offer ends.",
      "Saving Cuelinks offer end dates is already in progress."] },
  { id: "web", label: "Website", group: "output", shape: "sphere", layer: "today",
    wide: [11.25, 0, -2.4], narrow: [-2.4, -8.55, 0],
    text: ["The deal shows up in the web feeds, in search, and on its store and category pages.",
      "From there, community votes and comments decide how high it ranks."] },
  { id: "app", label: "App", group: "output", shape: "sphere", layer: "today",
    wide: [11.25, 0, -0.8], narrow: [-0.8, -9.55, 0],
    text: ["The native app reads the same live deals through the API.",
      "It is built but not yet in the app stores."] },
  { id: "telegram", label: "Telegram", group: "output", shape: "sphere", layer: "today",
    wide: [11.25, 0, 0.8], narrow: [0.8, -8.55, 0],
    text: ["When an admin approves a deal that is at least 20% off, it can be posted to the SnatchPicks Telegram channel straight away.",
      "Free offers and promo codes with no price qualify too."] },
  { id: "alerts", label: "Deal alerts", short: "Alerts", group: "output", shape: "sphere", layer: "today",
    wide: [11.25, 0, 2.4], narrow: [2.4, -9.55, 0],
    text: ["Every 30 minutes the alert job looks at newly approved deals and notifies users whose alerts match.",
      "Alerts go out by email or app push, instantly or as a daily or weekly digest."] },
];

// [from, to, kind]; kind: flow (dots), control (thin, no dots), next and target (shown with "In progress").
const EDGES = [
  ["schedule", "fetch", "control"], ["manual", "fetch", "control"],
  ["amazon", "fetch", "flow"], ["flipkart", "fetch", "flow"], ["myntra", "fetch", "flow"],
  ["cuelinks", "fetch", "flow"], ["inrdeals", "fetch", "flow"],
  ["fetch", "normalise", "flow"], ["fetch", "runlog", "control"],
  ["normalise", "dedup", "flow"], ["dedup", "price", "flow"], ["price", "queue", "flow"],
  ["queue", "admin", "flow"], ["admin", "live", "flow"],
  ["live", "web", "flow"], ["live", "app", "flow"], ["live", "telegram", "flow"], ["live", "alerts", "flow"],
  ["cuelinks-v3", "cuelinks", "next"], ["logging", "fetch", "next"], ["failed-runs", "runlog", "next"],
  ["merchant-link", "dedup", "next"], ["prices", "price", "next"],
  ["price", "niche", "target"], ["niche", "score", "target"], ["score", "queue", "target"],
  ["expiry", "live", "target"],
];

const SOURCES = ["amazon", "flipkart", "myntra", "cuelinks", "inrdeals"];
const OUTPUTS = [["web", 0.35], ["app", 0.25], ["alerts", 0.25], ["telegram", 0.15]];
// Share of dots that drop out at each check, and the colour they turn.
const REJECT = { dedup: [0.18, "--muted"], price: [0.12, "--c-gap"], niche: [0.25, "--muted"], admin: [0.12, "--c-gap"] };
const PARTICLES = 84;
const SWAY_AMP = 0.32; // radians either side
const SWAY_W = (2 * Math.PI) / 44; // one sway every 44 s
const SWAY_IDLE_MS = 8000;

const els = {
  stage: document.getElementById("s3d-stage"),
  panel: document.getElementById("s3d-panel"),
  fallbackMsg: document.getElementById("s3d-fallback-msg"),
};

function showFallback(message) {
  root.classList.remove("is-loading", "is-live");
  root.classList.add("is-failed");
  els.fallbackMsg.textContent = message;
}

function hasWebGL2() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // only probing; free the context
    return !!gl;
  } catch {
    return false;
  }
}

async function boot() {
  root.classList.add("is-loading");
  if (!hasWebGL2()) {
    showFallback("This browser or device doesn't offer WebGL 2, so the 3D view can't run. Here is the same pipeline as a flat diagram.");
    return;
  }
  let modules;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000));
    modules = await Promise.race([
      Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
        import("three/addons/renderers/CSS2DRenderer.js"),
      ]),
      timeout,
    ]);
  } catch {
    showFallback("The 3D library couldn't be loaded (the network or a content blocker may be stopping it). Here is the same pipeline as a flat diagram.");
    return;
  }
  try {
    start(...modules);
  } catch {
    showFallback("The 3D view couldn't start on this device. Here is the same pipeline as a flat diagram.");
  }
}

function start(THREE, { OrbitControls }, { CSS2DRenderer, CSS2DObject }) {
  const { Vector3 } = THREE;
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");

  // ── Colours from the site's CSS variables ──
  const palette = new Map();
  const colour = (name) => {
    if (!palette.has(name)) palette.set(name, new THREE.Color());
    return palette.get(name);
  };
  const readPalette = () => {
    const css = getComputedStyle(document.documentElement);
    for (const [name, c] of palette) c.set(css.getPropertyValue(name).trim() || "#888888");
  };
  for (const name of ["--muted", "--border", "--surface-2", "--accent", "--accent-ink", "--ok", "--warn",
    "--c-target", "--c-planned", "--c-gap"]) colour(name);
  readPalette();
  const sourceColour = Object.fromEntries(SOURCES.map((s) => [s, new THREE.Color(SOURCE_COLOURS[s])]));

  // ── Renderer, labels, camera, controls ──
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "3D model of the scraper pipeline. Use the step labels to explore it.");
  els.stage.prepend(canvas);

  const labelRenderer = new CSS2DRenderer();
  const labelLayer = labelRenderer.domElement;
  labelLayer.className = "s3d-labels";
  labelLayer.setAttribute("role", "group");
  labelLayer.setAttribute("aria-label", "Pipeline steps");
  canvas.after(labelLayer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reducedQuery.matches;
  controls.minDistance = 3;

  const hemi = new THREE.HemisphereLight(0xffffff, colour("--surface-2"), 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(6, 12, 8);
  scene.add(hemi, sun);

  // ── Nodes ──
  const geometries = {
    tetra: new THREE.TetrahedronGeometry(0.55),
    box: new THREE.BoxGeometry(0.85, 0.85, 0.85),
    cyl: new THREE.CylinderGeometry(0.45, 0.45, 0.85, 28),
    cone: new THREE.ConeGeometry(0.52, 0.95, 28),
    oct: new THREE.OctahedronGeometry(0.6),
    dodec: new THREE.DodecahedronGeometry(0.55),
    torus: new THREE.TorusGeometry(0.42, 0.16, 14, 36),
    ico: new THREE.IcosahedronGeometry(0.55),
    prism: new THREE.CylinderGeometry(0.55, 0.55, 0.8, 6),
    db: new THREE.CylinderGeometry(0.6, 0.6, 0.7, 32),
    capsule: new THREE.CapsuleGeometry(0.34, 0.45, 6, 16),
    sphere: new THREE.SphereGeometry(0.45, 24, 16),
    wire: new THREE.IcosahedronGeometry(0.45, 0),
    core: new THREE.SphereGeometry(0.17, 12, 8),
  };

  const byId = new Map();
  const pickable = [];
  const solidMaterials = []; // [material, colour name or null]
  const wireMaterials = [];

  for (const node of NODES) {
    const group = new THREE.Group();
    const tint = node.group === "source" ? sourceColour[node.id] : colour(GROUPS[node.group].colour);
    let mesh;
    if (node.shape === "wire") {
      const wireMat = new THREE.MeshBasicMaterial({ color: tint, wireframe: true });
      const coreMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5 });
      wireMaterials.push([wireMat, tint]);
      solidMaterials.push([coreMat, tint]);
      mesh = new THREE.Mesh(geometries.wire, wireMat);
      group.add(mesh, new THREE.Mesh(geometries.core, coreMat));
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.05, emissive: tint });
      solidMaterials.push([mat, tint]);
      mesh = new THREE.Mesh(geometries[node.shape], mat);
      if (node.shape === "tetra") mesh.rotation.set(0.6, 0, 0.8);
      group.add(mesh);
    }
    mesh.userData.id = node.id;
    pickable.push(mesh);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `s3d-label ${node.layer === "today" ? "" : node.layer}`.trim();
    button.dataset.id = node.id;
    button.setAttribute("aria-controls", "s3d-panel");
    if (node.layer !== "today") button.setAttribute("aria-label", `${node.label} (${BADGES[node.layer].text})`);
    button.addEventListener("click", () => select(node.id));
    labelLayer.append(button); // pre-append so the DOM (and Tab) order follows NODES
    const label = new CSS2DObject(button);
    label.position.set(0, -0.68, 0);
    label.center.set(0.5, 0);
    group.add(label);

    scene.add(group);
    byId.set(node.id, { node, group, mesh, button, spin: ["source", "output", "next", "target"].includes(node.group) });
  }

  const applyNodeColours = () => {
    const dark = darkQuery.matches;
    for (const [mat, tint] of solidMaterials) {
      mat.color.copy(tint);
      if (mat.emissive) { mat.emissive.copy(tint); mat.emissiveIntensity = dark ? 0.28 : 0.08; }
    }
    for (const [mat, tint] of wireMaterials) mat.color.copy(tint);
    hemi.groundColor.copy(colour("--surface-2"));
  };
  applyNodeColours();

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.035, 8, 56),
    new THREE.MeshBasicMaterial({ color: colour("--accent") }),
  );
  halo.visible = false;
  scene.add(halo);

  // ── Edges ──
  const edgeMaterials = {
    flow: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
    control: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false }),
    next: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
    target: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
  };
  const edgeColour = { flow: "--muted", control: "--muted", next: "--c-planned", target: "--c-target" };
  const edgeRadius = { flow: 0.04, control: 0.022, next: 0.03, target: 0.03 };
  const applyEdgeColours = () => {
    for (const kind in edgeMaterials) edgeMaterials[kind].color.copy(colour(edgeColour[kind]));
  };
  applyEdgeColours();

  const edges = EDGES.map(([from, to, kind]) => ({
    from, to, kind,
    layer: kind === "next" || kind === "target" ? "next" : "today",
    curve: new THREE.QuadraticBezierCurve3(new Vector3(), new Vector3(), new Vector3()),
    length: 1,
    mesh: null,
  }));
  const edgeByKey = new Map(edges.map((e) => [`${e.from}>${e.to}`, e]));

  // ── Layout (rebuilt when the stage flips between landscape and portrait) ──
  let mode = null;
  let grid = null;
  const drop = new Vector3();

  function buildGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    const line = colour("--border");
    grid = mode === "wide" ? new THREE.GridHelper(44, 44, line, line) : new THREE.GridHelper(30, 30, line, line);
    if (mode === "wide") grid.position.y = -1.5;
    else { grid.rotation.x = Math.PI / 2; grid.position.z = -1.6; }
    scene.add(grid);
  }

  function layout() {
    for (const { node, group } of byId.values()) group.position.fromArray(node[mode]);
    const lift = mode === "wide" ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    drop.set(...(mode === "wide" ? [0, -1.3, 0] : [-1.3, 0, 0]));
    for (const e of edges) {
      const a = byId.get(e.from).group.position;
      const b = byId.get(e.to).group.position;
      const { v0, v1, v2 } = e.curve;
      v0.copy(a); v2.copy(b);
      const dist = a.distanceTo(b);
      v1.addVectors(a, b).multiplyScalar(0.5).addScaledVector(lift, dist * 0.14 + (e.kind === "control" ? 0.8 : 0));
      e.length = e.curve.getLength();
      const geometry = new THREE.TubeGeometry(e.curve, 28, edgeRadius[e.kind], 6, false);
      if (e.mesh) { e.mesh.geometry.dispose(); e.mesh.geometry = geometry; }
      else { e.mesh = new THREE.Mesh(geometry, edgeMaterials[e.kind]); scene.add(e.mesh); }
      e.mesh.visible = layer === "next" || e.layer === "today";
    }
    buildGrid();
  }

  const viewDir = () => (mode === "wide" ? new Vector3(0.18, 0.6, 1) : new Vector3(0.3, 0.12, 1)).normalize();

  // Distance at which every node (plus its label) fits the current aspect ratio.
  function fitCamera() {
    const points = NODES.map((n) => new Vector3().fromArray(n[mode]));
    const centre = new THREE.Box3().setFromPoints(points).getCenter(new Vector3());
    const z = viewDir();
    const x = new Vector3().crossVectors(new Vector3(0, 1, 0), z).normalize();
    const y = new Vector3().crossVectors(z, x);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    const pad = 1.0;
    let dist = 0;
    for (const p of points) {
      const q = p.sub(centre);
      const depth = q.dot(z);
      dist = Math.max(dist, (Math.abs(q.dot(x)) + pad) / tanH + depth, (Math.abs(q.dot(y)) + pad) / tanV + depth);
    }
    controls.target.copy(centre);
    camera.position.copy(centre).addScaledVector(z, dist * 1.03);
    camera.far = dist * 6;
    camera.updateProjectionMatrix();
    controls.maxDistance = dist * 2.5;
    controls.update();
  }

  // ── Particles: deals moving through the pipeline ──
  const dotMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial(), PARTICLES);
  dotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dotMesh.frustumCulled = false;
  scene.add(dotMesh);
  const dots = Array.from({ length: PARTICLES }, () => ({
    segs: [], seg: 0, u: 0, speed: 2, state: "wait", timer: Math.random() * 7,
    colour: colour("--muted"), rejectAt: -1, rejectColour: null, from: new Vector3(),
  }));
  const matrix = new THREE.Matrix4();
  const tmp = new Vector3();
  for (let i = 0; i < PARTICLES; i++) {
    matrix.makeScale(0, 0, 0);
    dotMesh.setMatrixAt(i, matrix);
    dotMesh.setColorAt(i, colour("--muted"));
  }

  const nextEdges = edges.filter((e) => e.kind === "next");
  const pickOutput = () => {
    let r = Math.random();
    for (const [id, weight] of OUTPUTS) if ((r -= weight) < 0) return id;
    return OUTPUTS[0][0];
  };

  function respawn(d) {
    d.u = 0; d.seg = 0; d.rejectAt = -1; d.state = "move";
    if (layer === "next" && Math.random() < 0.18) {
      d.segs = [nextEdges[Math.floor(Math.random() * nextEdges.length)]];
      d.colour = colour("--c-planned");
      d.speed = 1.2;
      return;
    }
    const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];
    const viaTarget = layer === "next" && Math.random() < 0.5;
    const path = [source, "fetch", "normalise", "dedup", "price",
      ...(viaTarget ? ["niche", "score"] : []), "queue", "admin", "live", pickOutput()];
    d.segs = path.slice(1).map((to, i) => edgeByKey.get(`${path[i]}>${to}`));
    d.colour = sourceColour[source];
    d.speed = 2 + Math.random() * 0.8;
    for (let i = 0; i < d.segs.length; i++) {
      const rule = REJECT[d.segs[i].to];
      if (rule && Math.random() < rule[0]) { d.rejectAt = i; d.rejectColour = colour(rule[1]); break; }
    }
  }

  function stepDots(dt) {
    for (let i = 0; i < PARTICLES; i++) {
      const d = dots[i];
      let scale = 1;
      let c = d.colour;
      if (d.state === "wait") {
        d.timer -= dt;
        if (d.timer <= 0) respawn(d);
      }
      if (d.state === "wait") {
        scale = 0;
      } else if (d.state === "move") {
        const e = d.segs[d.seg];
        d.u += (d.speed * dt) / e.length;
        if (d.u >= 1) {
          d.u = 1;
          if (d.seg === d.rejectAt) { d.state = "dying"; d.timer = 0; e.curve.getPoint(1, d.from); }
          else if (e.to === "queue") { d.state = "dwell"; d.timer = 0.3 + Math.random() * 0.9; }
          else if (d.seg === d.segs.length - 1) { d.state = "wait"; d.timer = Math.random() * 1.5; scale = 0; }
          else { d.seg++; d.u = 0; }
        }
        d.segs[d.seg].curve.getPoint(d.u, tmp);
      } else if (d.state === "dwell") {
        d.timer -= dt;
        d.segs[d.seg].curve.getPoint(1, tmp);
        if (d.timer <= 0) { d.state = "move"; d.seg++; d.u = 0; }
      } else {
        d.timer += dt;
        const k = Math.min(d.timer / 0.9, 1);
        tmp.copy(d.from).addScaledVector(drop, k * k);
        scale = 1 - k;
        c = d.rejectColour;
        if (k >= 1) { d.state = "wait"; d.timer = 0.3 + Math.random() * 1.2; scale = 0; }
      }
      matrix.makeScale(scale, scale, scale).setPosition(tmp);
      dotMesh.setMatrixAt(i, matrix);
      dotMesh.setColorAt(i, c);
    }
    dotMesh.instanceMatrix.needsUpdate = true;
    dotMesh.instanceColor.needsUpdate = true;
  }

  // ── State ──
  let layer = "today";
  let selected = null;
  let paused = false;
  let reduced = reducedQuery.matches;
  let onScreen = true;
  let dead = false;
  let userMoved = false;
  let swayHeld = false;
  let swayTime = 0;
  let swayPrev = 0;
  let resumeTimer = 0;
  let compactLabels = null;
  let raf = 0;
  let last = 0;

  const animating = () => !paused && !reduced;

  const visibleNodes = () => NODES.filter((n) => layer === "next" || n.layer === "today");

  function setLayer(next) {
    layer = next;
    for (const b of root.querySelectorAll("[data-layer]")) b.setAttribute("aria-pressed", String(b.dataset.layer === layer));
    for (const { node, group } of byId.values()) group.visible = layer === "next" || node.layer === "today";
    for (const e of edges) if (e.mesh) e.mesh.visible = layer === "next" || e.layer === "today";
    if (layer === "today") {
      for (const d of dots) if (d.state !== "wait" && d.segs.some((e) => e.layer !== "today")) { d.state = "wait"; d.timer = Math.random(); }
    }
    if (selected && !byId.get(selected).group.visible) select(null);
    else updatePanelNav();
    schedule();
  }

  // ── Info panel ──
  const panelBody = els.panel.querySelector(".s3d-panel-body");
  const introNodes = [...panelBody.childNodes].map((n) => n.cloneNode(true));
  const prevBtn = els.panel.querySelector('[data-step="prev"]');
  const nextBtn = els.panel.querySelector('[data-step="next"]');

  function renderPanel(node) {
    if (!node) { panelBody.replaceChildren(...introNodes.map((n) => n.cloneNode(true))); return; }
    const order = visibleNodes();
    const kicker = document.createElement("p");
    kicker.className = "s3d-kicker";
    kicker.textContent = `${GROUPS[node.group].name} · ${order.indexOf(node) + 1} of ${order.length}`;
    const title = document.createElement("h3");
    title.id = "s3d-panel-title";
    title.textContent = node.label + " ";
    const badge = document.createElement("span");
    badge.className = `badge ${BADGES[node.layer].cls}`;
    badge.textContent = BADGES[node.layer].text;
    title.append(badge);
    const paragraphs = node.text.map((t) => Object.assign(document.createElement("p"), { textContent: t }));
    panelBody.replaceChildren(kicker, title, ...paragraphs);
  }

  function updatePanelNav() {
    const order = visibleNodes();
    const i = selected ? order.findIndex((n) => n.id === selected) : -1;
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i === order.length - 1;
    nextBtn.textContent = i < 0 ? "Start at step 1 →" : "Next step →";
  }

  function select(id, { reveal = false } = {}) {
    if (selected) {
      const old = byId.get(selected);
      old.group.scale.setScalar(1);
      old.button.removeAttribute("aria-current");
    }
    selected = id;
    const entry = id ? byId.get(id) : null;
    halo.visible = !!entry;
    if (entry) {
      entry.group.scale.setScalar(1.15);
      entry.button.setAttribute("aria-current", "true");
      halo.position.copy(entry.group.position);
    }
    renderPanel(entry?.node ?? null);
    updatePanelNav();
    const stacked = els.panel.getBoundingClientRect().top >= els.stage.getBoundingClientRect().bottom - 1;
    if (reveal && stacked) {
      els.panel.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }
    schedule();
  }

  function step(delta) {
    const order = visibleNodes();
    const i = selected ? order.findIndex((n) => n.id === selected) : -1;
    const next = order[Math.min(Math.max(i + delta, 0), order.length - 1)];
    if (next) select(next.id);
  }
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected) select(null); });

  // ── Pointer picking (click or tap without dragging) ──
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  const hit = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const found = raycaster.intersectObjects(pickable.filter((m) => m.parent.visible), false)[0];
    return found ? found.object.userData.id : null;
  };
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const id = hit(e);
    if (id) select(id, { reveal: true });
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons || e.pointerType !== "mouse") return;
    canvas.style.cursor = hit(e) ? "pointer" : "";
  });

  // ── Controls: slow sway that pauses while the user is moving the view ──
  controls.addEventListener("start", () => {
    swayHeld = true;
    userMoved = true;
    clearTimeout(resumeTimer);
  });
  controls.addEventListener("end", () => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      swayHeld = false;
      swayPrev = SWAY_AMP * Math.sin(swayTime * SWAY_W);
      schedule();
    }, SWAY_IDLE_MS);
  });
  controls.addEventListener("change", () => schedule());

  const yAxis = new Vector3(0, 1, 0);
  function sway(dt) {
    swayTime += dt;
    const angle = SWAY_AMP * Math.sin(swayTime * SWAY_W);
    tmp.copy(camera.position).sub(controls.target).applyAxisAngle(yAxis, angle - swayPrev);
    camera.position.copy(controls.target).add(tmp);
    swayPrev = angle;
  }

  function resetView() {
    userMoved = false;
    swayHeld = false;
    clearTimeout(resumeTimer);
    swayTime = 0;
    swayPrev = 0;
    fitCamera();
    schedule();
  }

  // ── Toolbar ──
  const pauseBtn = root.querySelector('[data-action="pause"]');
  root.querySelector('[data-action="reset"]').addEventListener("click", resetView);
  for (const b of root.querySelectorAll("[data-layer]")) b.addEventListener("click", () => setLayer(b.dataset.layer));
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    if (!paused) swayPrev = SWAY_AMP * Math.sin(swayTime * SWAY_W);
    syncMotion();
  });

  function syncMotion() {
    dotMesh.visible = !reduced;
    controls.enableDamping = !reduced;
    pauseBtn.disabled = reduced;
    pauseBtn.setAttribute("aria-pressed", String(paused && !reduced));
    pauseBtn.textContent = reduced ? "Animation off (reduced motion)" : paused ? "Play animation" : "Pause animation";
    schedule();
  }
  reducedQuery.addEventListener("change", () => {
    reduced = reducedQuery.matches;
    if (!reduced) swayPrev = SWAY_AMP * Math.sin(swayTime * SWAY_W);
    syncMotion();
  });
  darkQuery.addEventListener("change", () => {
    readPalette();
    applyNodeColours();
    applyEdgeColours();
    halo.material.color.copy(colour("--accent"));
    buildGrid();
    schedule();
  });

  // ── Size ──
  function resize() {
    const w = els.stage.clientWidth;
    const h = els.stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const compact = w < 620;
    if (compact !== compactLabels) {
      compactLabels = compact;
      for (const { node, button } of byId.values()) button.textContent = compact && node.short ? node.short : node.label;
    }
    const nextMode = w / h < 0.95 ? "narrow" : "wide";
    if (nextMode !== mode) {
      mode = nextMode;
      layout();
      if (selected) halo.position.copy(byId.get(selected).group.position);
      fitCamera();
    } else if (!userMoved) {
      fitCamera();
    }
    schedule();
  }
  new ResizeObserver(resize).observe(els.stage);

  // ── Render loop: runs while animating; otherwise renders only on change ──
  function schedule() {
    if (!raf && !dead && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    const live = animating();
    if (live) {
      stepDots(dt);
      for (const { spin, mesh, group } of byId.values()) if (spin && group.visible) mesh.rotation.y += dt * 0.4;
      if (!swayHeld) sway(dt);
    }
    const moving = controls.update();
    if (halo.visible) halo.quaternion.copy(camera.quaternion);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    if (live || moving) schedule();
    else last = 0;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    else schedule();
  });
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) schedule();
    else { cancelAnimationFrame(raf); raf = 0; last = 0; }
  }).observe(els.stage);

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    dead = true;
    cancelAnimationFrame(raf);
    showFallback("The 3D view stopped because the graphics context was lost. Here is the same pipeline as a flat diagram.");
  });

  // ── Go ──
  resize();
  setLayer("today");
  syncMotion();
  els.stage.querySelector(".s3d-status")?.remove();
  root.classList.remove("is-loading");
  root.classList.add("is-live");
  resize(); // the stage may have changed size once the toolbar appeared
}

if (root) boot();
