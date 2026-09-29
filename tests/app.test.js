// The pages are built from template functions, so one missing variable — a
// block renamed during an edit, a spread left behind — breaks an entire
// section with «Раздел не открылся» while the rest of the app looks healthy.
// That is exactly what «Can't find variable: kitchen» did to the menu. So every
// page is built here for real, in a DOM, with the actual menu.json: a page that
// throws fails the test instead of the guest's screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let jsdom = null;
try {
  jsdom = await import("jsdom");
} catch {
  // «npm install» brings jsdom in as a dev dependency; without it the server
  // tests still run and this file skips the DOM checks.
}

const root = new URL("../", import.meta.url);
const BROKEN = "Раздел не открылся";

async function boot(hash = "#menu") {
  const [{ JSDOM, VirtualConsole }, html, appSource, menu] = await Promise.all([
    Promise.resolve(jsdom),
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("app.js", root), "utf8"),
    readFile(new URL("menu.json", root), "utf8").then(JSON.parse),
  ]);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => {
    // jsdom has no layout: scrollTo and friends are simply not implemented.
    if (!/Not implemented/.test(err.message)) errors.push(err.message);
  });
  const dom = new JSDOM(
    // Telegram's SDK is not reachable from here and is not needed: in a
    // browser without initData the app runs as a plain web page.
    html.replace(/<script src="https:\/\/telegram[^"]*"><\/script>/, ""),
    {
      url: "http://localhost/" + hash,
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole,
    },
  );
  const { window } = dom;
  const doc = window.document;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.fetch = async (url) => {
    const path = String(url);
    const body =
      path.startsWith("/api/menu") || path.startsWith("/menu.json")
        ? menu
        : path.startsWith("/api/coins")
          ? { coins: 0, pending: 0 }
          : {};
    return { ok: true, status: 200, json: async () => body };
  };
  window.addEventListener("error", (e) => errors.push("error: " + e.message));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push("rejection: " + e.reason),
  );
  window.eval(appSource);
  const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(400); // the menu is fetched and rendered
  const main = doc.querySelector("#main");
  const open = async (where) => {
    window.location.hash = "#" + where;
    window.dispatchEvent(new window.Event("hashchange"));
    await wait();
    return main;
  };
  return { window, doc, main, menu, errors, wait, open };
}

test("startup splash shows the brand and a live percent before finishing", { skip: !jsdom }, async () => {
  const app = await boot("#home");
  const splash = app.doc.querySelector("#preloader");
  assert.ok(splash);
  assert.equal(splash.querySelector(".preloader-logo").getAttribute("src"), "assets/logo.png");
  assert.equal(splash.querySelector(".preloader-credit").textContent.trim(), "app by @stonym0ntana");
  assert.equal(splash.querySelector('[role="progressbar"]').getAttribute("aria-valuemax"), "100");
  assert.equal(app.doc.body.classList.contains("is-preloading"), true);
  await app.wait(1850);
  assert.equal(splash.querySelector("#preloaderPercent").textContent, "100%");
  assert.equal(splash.classList.contains("preloader-done"), true);
  assert.equal(app.doc.body.classList.contains("is-preloading"), false);
});

// A broken page keeps the rest of the app alive and only replaces its own
// section, so the error text lives inside #main and has to be read there.
function assertPageWorks(main, label) {
  assert.ok(
    !main.textContent.includes(BROKEN),
    label + ": " + (main.querySelector(".fine")?.textContent.trim() || ""),
  );
}

test("every page builds with the real menu", { skip: !jsdom }, async () => {
  const app = await boot();
  for (const page of ["home", "menu", "coins", "profile"]) {
    const main = await app.open(page);
    assertPageWorks(main, "страница «" + page + "»");
    assert.ok(
      main.querySelector("h1"),
      "страница «" + page + "» без заголовка",
    );
  }
  assert.deepEqual(app.errors, []);
});

test(
  "food follows the paper menu: sandwiches, then the kitchen card",
  { skip: !jsdom },
  async () => {
    const app = await boot("#menu");
    assertPageWorks(app.main, "меню");
    const titles = [...app.main.querySelectorAll(".food-part h3")].map((h) =>
      h.textContent.trim(),
    );
    assert.deepEqual(titles, [
      "Сэндвичи на твой выбор",
      "Готовятся в лепёшке",
      "Завтраки",
      "Салаты и закуски",
      "Супы",
      "Горячее",
      "Наггетсы",
      "Соусы",
    ]);
    // Every dish lands in exactly one block: a spread left in the list twice
    // would silently duplicate it, a filter typo would swallow it.
    const shown = [...app.main.querySelectorAll(".food-part [data-add]")].map(
      (b) => b.dataset.add,
    );
    const food = app.menu.filter((p) => p.category === "Еда").map((p) => p.id);
    assert.equal(shown.length, food.length);
    assert.deepEqual([...shown].sort(), [...food].sort());
    assert.deepEqual(app.errors, []);
  },
);

test(
  "search and categories keep the menu page alive",
  { skip: !jsdom },
  async () => {
    const app = await boot("#menu");
    assertPageWorks(app.main, "меню");
    const search = app.main.querySelector("#search");
    search.value = "том ям";
    search.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.wait(200);
    assertPageWorks(app.main, "поиск «том ям»");
    const names = [...app.main.querySelectorAll(".product-name")].map((b) =>
      b.textContent.trim(),
    );
    assert.deepEqual(names, [
      "Суп «Том Ям» с креветками",
      "Суп «Том Ям» с курицей",
    ]);
    search.value = "";
    search.dispatchEvent(new app.window.Event("input", { bubbles: true }));
    await app.wait(200);
    [...app.main.querySelectorAll("[data-cat]")]
      .find((b) => b.dataset.cat === "Еда")
      .click();
    await app.wait();
    assertPageWorks(app.main, "категория «Еда»");
    assert.deepEqual(
      [...app.main.querySelectorAll(".menu-group h2")].map(
        (h) => h.textContent,
      ),
      ["Еда"],
    );
    assert.deepEqual(app.errors, []);
  },
);

test(
  "a sandwich opens the builder, a drink goes straight to the cart",
  { skip: !jsdom },
  async () => {
    const app = await boot("#menu");
    assertPageWorks(app.main, "меню");
    app.main.querySelector('[data-add="цезарь"]').click();
    await app.wait();
    assertPageWorks(app.main, "конструктор сэндвича");
    const sheet = app.doc.querySelector("#sheet");
    assert.match(sheet.textContent.replace(/\s+/g, " "), /В чём приготовить\?/);
    assert.ok(sheet.querySelector('input[name="bread"]'), "нет выбора хлеба");
    assert.deepEqual(app.errors, []);
  },
);
