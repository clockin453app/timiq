/**
 * Behavioural coverage for the mobile navigation drawer.
 *
 * The reducer that owns drawer state is executed for real, driven through a small
 * model of React's render/effect loop, so these checks exercise state transitions
 * rather than class names. DOM-level rendering is verified in the browser.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../src/", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

function loadModule(relative) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports });
  return module.exports;
}

const {
  MOBILE_DRAWER_DESKTOP_MIN_WIDTH,
  createMobileDrawerState,
  mobileDrawerReducer,
} = loadModule("components/layout/mobile-drawer-state.ts");

const { getMobileDrawerNavigationTree, collectNavigationLeaves, omitMobileDrawerFooterLeaves } =
  loadModule("config/navigation.ts");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

/**
 * Models the header's render/effect loop: an effect re-runs when its dependency
 * array changes, and a dispatch that returns the identical state does not
 * schedule another render.
 */
function mountDrawer(initialHref, { legacyRouteEffect = false } = {}) {
  let href = initialHref;
  let state = createMobileDrawerState(initialHref);
  let routeDeps;
  let renders = 0;

  const flush = () => {
    for (let guard = 0; guard < 50; guard += 1) {
      const deps = legacyRouteEffect ? [href, state.open] : [href];
      const changed =
        routeDeps === undefined || deps.some((value, index) => value !== routeDeps[index]);
      if (!changed) return;
      routeDeps = deps;
      const next = legacyRouteEffect
        ? state.open
          ? { ...state, open: false }
          : state
        : mobileDrawerReducer(state, { type: "route", href });
      if (next === state) return;
      state = next;
      renders += 1;
    }
    throw new Error("drawer effect loop did not settle");
  };

  flush();

  return {
    get open() {
      return state.open;
    },
    get renders() {
      return renders;
    },
    toggle() {
      state = mobileDrawerReducer(state, { type: "toggle" });
      flush();
    },
    close() {
      const next = mobileDrawerReducer(state, { type: "close" });
      const rerendered = next !== state;
      state = next;
      flush();
      return rerendered;
    },
    navigate(nextHref) {
      href = nextHref;
      flush();
    },
    rerender() {
      flush();
    },
    resize(width) {
      if (!state.open) return;
      state = mobileDrawerReducer(state, { type: "viewport", width });
      flush();
    },
  };
}

check("breakpoint matches the Tailwind lg shell breakpoint", MOBILE_DRAWER_DESKTOP_MIN_WIDTH === 1024);
check("drawer starts closed", mountDrawer("/dashboard").open === false);

const drawer = mountDrawer("/dashboard");
drawer.toggle();
check("menu button opens the drawer", drawer.open === true);

drawer.rerender();
check("re-rendering the same route keeps the drawer open", drawer.open === true);

drawer.rerender();
drawer.rerender();
check("repeated parent renders never self-close the drawer", drawer.open === true);

check("closing an open drawer re-renders", mountDrawerAndClose().rerendered === true);
function mountDrawerAndClose() {
  const instance = mountDrawer("/dashboard");
  instance.toggle();
  return { rerendered: instance.close(), open: instance.open };
}
check("close leaves the drawer closed", mountDrawerAndClose().open === false);

const idle = mountDrawer("/dashboard");
check("closing an already closed drawer does not re-render", idle.close() === false);

const toggled = mountDrawer("/dashboard");
toggled.toggle();
toggled.toggle();
check("toggle closes an open drawer", toggled.open === false);
toggled.toggle();
check("toggle re-opens after closing", toggled.open === true);
toggled.close();
toggled.toggle();
check("the drawer can be reopened repeatedly", toggled.open === true);

const routed = mountDrawer("/dashboard");
routed.toggle();
routed.navigate("/timesheets");
check("selecting a different route closes the drawer", routed.open === false);
routed.toggle();
check("the drawer can be reopened after navigation", routed.open === true);
routed.navigate("/dashboard");
check("navigating back closes the drawer again", routed.open === false);

const resized = mountDrawer("/dashboard");
resized.toggle();
resized.resize(1023);
check("resizing below 1024 keeps the drawer open", resized.open === true);
resized.resize(1024);
check("resizing to 1024 closes the drawer", resized.open === false);
resized.toggle();
resized.resize(1440);
check("resizing to a wide desktop closes the drawer", resized.open === false);

const settled = mountDrawer("/dashboard");
settled.toggle();
settled.navigate("/clock");
settled.rerender();
settled.rerender();
check("state settles without an effect loop", settled.renders < 10);

const legacy = mountDrawer("/dashboard", { legacyRouteEffect: true });
legacy.toggle();
check("the pre-fix route effect reproduced the reported defect", legacy.open === false);

const reducerState = createMobileDrawerState("/dashboard");
check(
  "route action for the current href returns the identical state",
  mobileDrawerReducer(reducerState, { type: "route", href: "/dashboard" }) === reducerState,
);
check(
  "route action for a new href returns a closed state",
  mobileDrawerReducer({ open: true, href: "/a" }, { type: "route", href: "/b" }).open === false,
);
check(
  "viewport action below the breakpoint returns the identical state",
  mobileDrawerReducer(reducerState, { type: "viewport", width: 800 }) === reducerState,
);
check(
  "unknown actions leave state untouched",
  mobileDrawerReducer(reducerState, { type: "unknown" }) === reducerState,
);

const header = read("components/layout/mobile-header.tsx");
check(
  "route sync effect depends only on the active route",
  /dispatch\(\{ type: "route", href: activeHref \}\);\s*\}, \[activeHref\]\);/.test(header),
);
check(
  "the self-closing effect is gone",
  !/if \(menuOpen\) closeMenu\(false\)/.test(header),
);
check("menu button is wired to the toggle", /onClick=\{toggleMenu\}/.test(header));
check("aria-expanded reflects drawer state", /aria-expanded=\{menuOpen\}/.test(header));
check(
  "focus returns to the trigger without waiting for a frame",
  /if \(restoreFocus\) menuButtonRef\.current\?\.focus\(\);/.test(header),
);
check(
  "backdrop sits under the drawer and over the header row",
  /menuOpen \? "z-40" : "z-\[60\]"/.test(header) && /fixed inset-0 z-50/.test(header),
);
check("orientation changes are handled", /orientationchange/.test(header));
check("background content is made inert", /appMain\.inert = true/.test(header));
check("drawer uses flex column shell", /flex-col overflow-hidden/.test(header));
check("drawer account header is fixed", /timiq-mobile-drawer-header/.test(header) && /safe-area-inset-top/.test(header));
check("drawer header shows email and role, not the logo", /timiq-mobile-drawer-header[\s\S]*user\.email/.test(header) && !/timiq-mobile-drawer-header[\s\S]*TimIQBrandLockup/.test(header));
check("main header hosts the large approved logo", /MOBILE_HEADER_LOGO_HEIGHT = 46/.test(header) && /surface="onDark"/.test(header));
check("drawer does not repeat the brand lockup", (header.match(/<TimIQBrandLockup/g) ?? []).length === 1);
check("single scroll container holds nav and account actions", /timiq-mobile-drawer-scroll[\s\S]*min-h-0 flex-1 overflow-x-hidden overflow-y-auto/.test(header));
check("there is no fixed footer navigation block", !/timiq-mobile-drawer-footer/.test(header));
check("Profile lives in the scrollable menu", /timiq-mobile-drawer-scroll[\s\S]*href="\/profile"/.test(header));
check("Settings is gated for limited users", /showAccountExtras \? \([\s\S]*href="\/settings"/.test(header));
check("Help is gated for limited users", /showAccountExtras \? \([\s\S]*href="\/help"/.test(header));
check("Logout appears as a menu row in the scrollable menu", /timiq-mobile-drawer-scroll[\s\S]*appearance="menuRow"/.test(header));
check("account identity is not duplicated below the header", !/timiq-mobile-drawer-scroll[\s\S]*UserAvatar/.test(header));
check("account leaves are omitted from the NavTree", /omitMobileDrawerFooterLeaves/.test(header));
check("drawer width is min(100vw-1.25rem, 360px)", /w-\[min\(100vw-1\.25rem,360px\)\]/.test(header));
check("drawer avoids forced 300px min-width overflow", !/min-w-\[min\(100%,300px\)\]/.test(header));
check("close control has a large touch target", /h-11 w-11/.test(header));
check("account links use black active indicator", /border-l-black bg-\[var\(--color-sidebar-page-active-bg\)\]/.test(header));
check("backdrop has test id", /data-testid="timiq-mobile-drawer-backdrop"/.test(header));
check("body overscroll locked while open", /overscrollBehavior = "none"/.test(header));
check("drawer header truncates name and email", /formatAuthUserDisplayName/.test(header) && /truncate text-\[14px\]/.test(header));
check("logout confirmation remains wired", /LogoutButton/.test(header));
check("top bar avatar is not a duplicate account menu", !/<UserAvatar[\s\S]{0,200}menuButtonRef/.test(header.split("{menuOpen")[0] ?? ""));

const overview = read("app/(app)/overview/overview-client.tsx");
const pageGuide = read("components/layout/page-location-guide.tsx");
check("Overview client no longer duplicates a mobile page title", !/overview\.page_title/.test(overview));
check("root destinations use a single semantic heading in the page guide", /usePageHeading[\s\S]*<h1/.test(pageGuide));

const employeeTree = getMobileDrawerNavigationTree("employee");
const limitedTree = getMobileDrawerNavigationTree("employee", { limitedAccess: true });
const adminTree = getMobileDrawerNavigationTree("admin");
const administratorTree = getMobileDrawerNavigationTree("administrator");
const hrefs = (nodes) => collectNavigationLeaves(nodes).map((leaf) => leaf.href);

check("employee drawer exposes employee pages", hrefs(employeeTree).includes("/clock"));
check("employee drawer hides management pages", !hrefs(employeeTree).includes("/employees"));
check("admin drawer exposes management pages", hrefs(adminTree).includes("/employees"));
check("administrator drawer exposes companies", hrefs(administratorTree).includes("/companies"));
check("no drawer tree links to workplaces", !hrefs(administratorTree).includes("/workplaces"));
const limitedHrefs = hrefs(limitedTree);
check(
  "limited access drawer is a strict subset of the employee drawer",
  limitedHrefs.length < hrefs(employeeTree).length &&
    limitedHrefs.every((href) => hrefs(employeeTree).includes(href)),
);
check("limited access drawer excludes PAYE pay history", !limitedHrefs.includes("/paye-pay-history"));
check("limited access drawer excludes the clock", !limitedHrefs.includes("/clock"));
check("limited access drawer excludes management pages", !limitedHrefs.includes("/employees"));

const employeeFooterTree = omitMobileDrawerFooterLeaves(employeeTree);
const limitedFooterTree = omitMobileDrawerFooterLeaves(limitedTree);
const footerHrefs = (nodes) => collectNavigationLeaves(nodes).map((leaf) => leaf.href);
check(
  "employee scroll tree omits profile/settings/help",
  !footerHrefs(employeeFooterTree).includes("/profile") &&
    !footerHrefs(employeeFooterTree).includes("/settings") &&
    !footerHrefs(employeeFooterTree).includes("/help"),
);
check(
  "limited scroll tree omits profile",
  !footerHrefs(limitedFooterTree).includes("/profile"),
);
check(
  "omitting footer leaves keeps other employee routes",
  footerHrefs(employeeFooterTree).includes("/clock") || footerHrefs(employeeFooterTree).includes("/messages"),
);

const logoutButton = read("features/auth/logout-button.tsx");
check("LogoutButton supports menuRow appearance", /appearance === "menuRow"/.test(logoutButton));
check("menuRow logout still opens confirmation", /appearance === "menuRow"[\s\S]*openConfirm/.test(logoutButton));
check("menuRow logout is not a boxed Button variant", /appearance === "menuRow"[\s\S]*<button[\s\S]*LogOut/.test(logoutButton));

console.log(`${passed} mobile drawer checks passed`);
