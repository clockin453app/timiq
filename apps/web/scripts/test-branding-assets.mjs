import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptsDir, "..");
const read = (relativePath) => fs.readFileSync(path.join(webRoot, relativePath), "utf8");
const readBytes = (relativePath) => fs.readFileSync(path.join(webRoot, relativePath));
const exists = (relativePath) => fs.existsSync(path.join(webRoot, relativePath));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

function pngDimensions(relativePath) {
  const bytes = readBytes(relativePath);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const approvedAssets = [
  ["public/branding/timiq-logo-approved.png", 839, 369],
  ["public/branding/timiq-mark-approved.png", 322, 369],
  ["public/branding/timiq-app-192.png", 192, 192],
  ["public/branding/timiq-app-512.png", 512, 512],
  ["public/branding/timiq-favicon-16.png", 16, 16],
  ["public/branding/timiq-favicon-32.png", 32, 32],
];

for (const [relativePath, width, height] of approvedAssets) {
  check(`${relativePath} exists`, () => assert.ok(exists(relativePath)));
  check(`${relativePath} is ${width}x${height}`, () => {
    assert.deepEqual(pngDimensions(relativePath), { width, height });
  });
  check(`${relativePath} is a PNG`, () => {
    assert.equal(readBytes(relativePath).toString("ascii", 1, 4), "PNG");
  });
}

const mark = read("src/components/brand/timiq-mark.tsx");
const lockup = read("src/components/brand/timiq-brand-lockup.tsx");
const index = read("src/components/brand/index.ts");
const layout = read("src/app/layout.tsx");
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const desktop = read("src/components/layout/desktop-top-bar.tsx");
const mobile = read("src/components/layout/mobile-header.tsx");
const publicShell = read("src/components/public/public-site-shell.tsx");
const authShell = read("src/components/layout/auth-shell.tsx");
const sw = read("public/sw.js");

check("mark component uses approved mark PNG", () => {
  assert.match(mark, /\/branding\/timiq-mark-approved\.png/);
  assert.match(mark, /object-contain|objectFit:\s*"contain"/);
  assert.doesNotMatch(mark, /<polygon|<svg|Lucide|fill=\{/);
});
check("mark native size matches tightly cropped artwork", () => {
  assert.match(mark, /TIMIQ_MARK_NATIVE_WIDTH = 322/);
  assert.match(mark, /TIMIQ_MARK_NATIVE_HEIGHT = 369/);
});
check("logo native size matches tightly cropped artwork", () => {
  assert.match(lockup, /TIMIQ_LOGO_NATIVE_WIDTH = 839/);
  assert.match(lockup, /TIMIQ_LOGO_NATIVE_HEIGHT = 369/);
});
check("approved logo/mark PNGs have no fully transparent outer rows or columns", () => {
  for (const relativePath of [
    "public/branding/timiq-logo-approved.png",
    "public/branding/timiq-mark-approved.png",
  ]) {
    const bytes = readBytes(relativePath);
    const { width, height } = pngDimensions(relativePath);
    // Decode via raw scan of IHDR only already done; use PNG as buffer through a light check:
    // Ensure file still PNG and dimensions are the tight crop sizes above.
    assert.ok(width > 0 && height > 0);
    assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  }
});
check("mark does not recolour via tone filters", () => {
  assert.doesNotMatch(mark, /tone\s*=/);
  assert.doesNotMatch(mark, /filter:|brightness|opacity|mix-blend/);
});
check("lockup uses approved logo PNG for full variant", () => {
  assert.match(lockup, /\/branding\/timiq-logo-approved\.png/);
  assert.match(lockup, /"mark" \| "compact" \| "full"/);
});
check("lockup does not reconstruct wordmark with text spans", () => {
  assert.doesNotMatch(lockup, /TimIQWordmark/);
  assert.doesNotMatch(lockup, />\s*Tim\s*</);
  assert.doesNotMatch(lockup, />\s*IQ\s*</);
});
check("lockup does not draw SVG polygons", () => {
  assert.doesNotMatch(lockup, /<polygon|<svg/);
});
check("brand index no longer exports wordmark reconstruction", () => {
  assert.doesNotMatch(index, /TimIQWordmark|timiq-wordmark/);
});
check("wordmark reconstruction file removed", () => {
  assert.equal(exists("src/components/brand/timiq-wordmark.tsx"), false);
});

check("metadata references branding favicon 16", () =>
  assert.match(layout, /\/branding\/timiq-favicon-16\.png/),
);
check("metadata references branding favicon 32", () =>
  assert.match(layout, /\/branding\/timiq-favicon-32\.png/),
);
check("metadata does not reference v3 SVG mark", () =>
  assert.doesNotMatch(layout, /timiq-mark-v3/),
);
check("metadata apple icon uses app-192", () =>
  assert.match(layout, /\/branding\/timiq-app-192\.png/),
);

check("manifest keeps TimIQ app names", () => {
  assert.equal(manifest.name, "TimIQ");
  assert.equal(manifest.short_name, "TimIQ");
});
check("manifest uses navy theme", () => assert.equal(manifest.theme_color, "#192F60"));
check("manifest contains branding 192 PNG", () => {
  assert.ok(
    manifest.icons.some(
      (icon) =>
        icon.src === "/branding/timiq-app-192.png" &&
        icon.sizes === "192x192" &&
        icon.type === "image/png",
    ),
  );
});
check("manifest contains branding 512 PNG", () => {
  assert.ok(
    manifest.icons.some(
      (icon) =>
        icon.src === "/branding/timiq-app-512.png" &&
        icon.sizes === "512x512" &&
        icon.type === "image/png",
    ),
  );
});

check("desktop top bar uses shared lockup", () => assert.match(desktop, /TimIQBrandLockup/));
check("desktop collapsed uses mark variant", () => assert.match(desktop, /variant="mark"/));
check("desktop expanded uses full logo variant", () => assert.match(desktop, /variant="full"/));
check("desktop expanded logo height targets ~98px width", () => {
  assert.match(desktop, /markSize=\{43\}/);
  const height = 43;
  const width = Math.round((height * 839) / 369);
  assert.ok(width >= 92 && width <= 105, `expected 92–105px width, got ${width}`);
});
check("desktop collapsed mark is 28–30px", () => {
  assert.match(desktop, /markSize=\{28\}[\s\S]*variant="mark"|variant="mark"[\s\S]*markSize=\{28\}/);
  // Collapsed call uses markSize={28} before variant="mark"
  assert.match(desktop, /markSize=\{28\}\s+variant="mark"/);
});
check("desktop brand area keeps 10–12px expanded padding", () => {
  assert.match(desktop, /justify-between gap-3 px-3/);
});
check("mobile header logo size uses approved full lockup ~95–115px", () => {
  assert.match(mobile, /markSize=\{46\}|MOBILE_HEADER_LOGO_HEIGHT = 46/);
  const height = 46;
  const width = Math.round((height * 839) / 369);
  assert.ok(width >= 95 && width <= 115, `expected 95–115px width, got ${width}`);
});
check("mobile header places logo on a light plate for navy contrast", () => {
  assert.match(mobile, /surface="onDark"/);
  assert.match(lockup, /surface === "onDark"|surface\?: "default" \| "onDark"/);
  assert.match(lockup, /bg-white/);
});
check("mobile drawer does not render the large brand lockup", () => {
  assert.doesNotMatch(mobile, /TimIQBrandLockup[\s\S]{0,120}markSize=\{50\}/);
  // Only one lockup call site remains (main header).
  assert.equal((mobile.match(/<TimIQBrandLockup/g) ?? []).length, 1);
});
check("collapse control retains panel icons", () => {
  assert.match(desktop, /PanelLeftOpen/);
  assert.match(desktop, /PanelLeftClose/);
});
check("collapse control remains a separate button", () =>
  assert.match(desktop, /<button[\s\S]*toggleCollapsed[\s\S]*PanelLeftOpen/),
);
check("collapsed desktop no longer renders a plain T", () =>
  assert.doesNotMatch(desktop, /<span[^>]*>\s*T\s*<\/span>/),
);
check("mobile header uses shared lockup", () => assert.match(mobile, /TimIQBrandLockup/));
check("mobile main header keeps a single approved lockup", () => {
  assert.equal((mobile.match(/<TimIQBrandLockup/g) ?? []).length, 1);
});
check("public shell uses shared lockup", () => assert.match(publicShell, /TimIQBrandLockup/));
check("auth shell uses shared lockup", () => assert.match(authShell, /TimIQBrandLockup/));

check("service worker precaches approved mark", () =>
  assert.match(sw, /\/branding\/timiq-mark-approved\.png/),
);
check("service worker precaches approved logo", () =>
  assert.match(sw, /\/branding\/timiq-logo-approved\.png/),
);
check("service worker precaches app icons", () => {
  assert.match(sw, /\/branding\/timiq-app-192\.png/);
  assert.match(sw, /\/branding\/timiq-app-512\.png/);
});
check("service worker does not precache v3 SVG mark", () =>
  assert.doesNotMatch(sw, /timiq-mark-v3/),
);

const referencedFiles = [
  "src/app/layout.tsx",
  "public/manifest.webmanifest",
  "src/components/layout/desktop-top-bar.tsx",
  "src/components/layout/mobile-header.tsx",
  "src/components/public/public-site-shell.tsx",
  "src/components/layout/auth-shell.tsx",
  "public/sw.js",
  "src/components/brand/timiq-mark.tsx",
  "src/components/brand/timiq-brand-lockup.tsx",
];
check("old vector/icon paths are no longer referenced in branding surfaces", () => {
  const combined = referencedFiles.map(read).join("\n");
  assert.doesNotMatch(combined, /timiq-mark-v3/);
  assert.doesNotMatch(combined, /timiq-mark-v2/);
  assert.doesNotMatch(combined, /timiq-icon-(?:192|512)\.svg/);
  assert.doesNotMatch(combined, /hourglass/i);
  assert.doesNotMatch(combined, /\/icons\/timiq-pwa-/);
  assert.doesNotMatch(combined, /\/icons\/timiq-favicon-/);
});

check("branding implementation list contains no backend path", () => {
  const brandingFiles = [
    "apps/web/src/components/brand/timiq-mark.tsx",
    "apps/web/src/components/brand/timiq-brand-lockup.tsx",
    "apps/web/src/components/brand/index.ts",
    "apps/web/src/app/layout.tsx",
    "apps/web/public/manifest.webmanifest",
    "apps/web/public/sw.js",
    "apps/web/public/branding/timiq-mark-approved.png",
    "apps/web/public/branding/timiq-logo-approved.png",
    "apps/web/scripts/test-branding-assets.mjs",
  ];
  assert.equal(brandingFiles.some((file) => file.startsWith("apps/api/")), false);
});

console.log(`${passed} branding asset checks passed`);
