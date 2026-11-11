import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
mermaid.initialize({
  startOnLoad: true,
  theme: dark ? "dark" : "base",
  themeVariables: dark
    ? {}
    : {
        primaryColor: "#fff3e8",
        primaryBorderColor: "#f97316",
        primaryTextColor: "#1c1917",
        lineColor: "#c2410c",
        secondaryColor: "#fef9c3",
        tertiaryColor: "#ffffff",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      },
  flowchart: { htmlLabels: true, curve: "basis" },
  securityLevel: "strict",
});

// Highlight the TOC entry for the section in view.
const links = new Map(
  [...document.querySelectorAll("nav.toc a[href^='#']")].map((a) => [a.getAttribute("href").slice(1), a]),
);
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of links.values()) a.classList.remove("active");
      links.get(entry.target.id)?.classList.add("active");
    }
  },
  { rootMargin: "-20% 0px -70% 0px" },
);
for (const id of links.keys()) {
  const el = document.getElementById(id);
  if (el) observer.observe(el);
}
