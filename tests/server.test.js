import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { once } from "node:events";

let process, directory, base;
before(async () => {
  // Isolated server: test orders never touch the app's data or Telegram.
  directory = await mkdtemp(join(tmpdir(), "bk-test-"));
  for (const file of [
    "server.js",
    "package.json",
    "index.html",
    "style.css",
    "app.js",
    "menu.json",
    "assets",
  ]) {
    await cp(new URL("../" + file, import.meta.url), join(directory, file), {
      recursive: true,
    });
  }
  await writeFile(join(directory, ".env"), "TEST_SECRET=not-public");
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  process = spawn(globalThis.process.execPath, ["server.js"], {
    cwd: directory,
    env: {
      ...globalThis.process.env,
      PORT: String(port),
      BOT_TOKEN: "",
      ADMIN_IDS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await Promise.race([
    once(process.stdout, "data"),
    once(process, "exit").then(() => {
      throw new Error("Test server exited before startup");
    }),
  ]);
});
after(async () => {
  if (process && process.exitCode === null) {
    const exited = once(process, "exit");
    process.kill();
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("menu and public assets load with correct MIME types", async () => {
  const menu = await (await fetch(base + "/api/menu")).json();
  assert.equal(menu.length, 97);
  assert.equal(new Set(menu.map((item) => item.id)).size, menu.length);
  for (const item of menu.filter((p) => p.category !== "Еда"))
    assert.ok(item.art, "drink has an illustration: " + item.id);
  assert.equal(menu.find((item) => item.id === "большой-латте").price, 200);
  for (const [url, type] of [
    ["/", "text/html"],
    ["/app.js", "text/javascript"],
    ["/style.css", "text/css"],
    ["/assets/logo.png", "image/png"],
    ...[...new Set(menu.filter((p) => p.art).map((p) => p.art))].map((art) => [
      `/assets/drinks/${encodeURIComponent(art)}.webp`,
      "image/webp",
    ]),
    ["/assets/fonts/manrope-cyrillic-wght-normal.woff2", "font/woff2"],
  ]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get("content-type").startsWith(type), url);
  }
});

test("missing files return 404 without crashing; private files are not served", async () => {
  for (const path of [
    "/assets/missing.png",
    "/favicon.ico",
    "/server.js",
    "/.env",
    "/data/orders.json",
    "/.git/HEAD",
    "/assets/../server.js",
    "/assets/%2e%2e%2fserver.js",
  ]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + "/%E0%A4%A")).status, 400);
  assert.equal((await fetch(base + "/api/health")).status, 200);
});

test("checkout computes price and coins on the server, not from client input", async () => {
  const response = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "большой-латте", qty: 2, price: 1 }],
      total: 2,
      type: "here",
      branch: "Волжский",
      customer: { name: "Тест", phone: "+7 900 000-00-00" },
    }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.total, 400);
  assert.equal(result.coinsEarned, 20);
  const orders = JSON.parse(
    await readFile(join(directory, "data/orders.json"), "utf8"),
  );
  assert.equal(orders.length, 1);
  assert.equal(orders[0].type, "here");
  assert.equal((await fetch(base + "/data/orders.json")).status, 404);
});

test("empty or invalid checkout is rejected", async () => {
  for (const body of [
    "{invalid",
    JSON.stringify({ items: [], customer: {}, branch: "Волжский" }),
  ]) {
    assert.equal(
      (await fetch(base + "/api/orders", { method: "POST", body })).status,
      400,
    );
  }
});

test("coins are credited only by the admin after payment", async () => {
  const placed = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "эспрессо", qty: 2 }],
      type: "pickup",
      branch: "Волгоград",
      customer: { name: "Тест", phone: "+7 (999) 111-22-33" },
    }),
  });
  const result = await placed.json();
  assert.equal(result.total, 280);
  assert.equal(result.coinsEarned, 14);
  // Until the admin confirms the payment the balance stays zero: the client
  // only sees how many coins are promised after payment.
  const before = await (
    await fetch(
      base + "/api/coins?phone=" + encodeURIComponent("+7 999 111 22 33"),
    )
  ).json();
  assert.deepEqual(before, { coins: 0, pending: 14 });
  // The client cannot credit itself: no write endpoint for coins exists.
  assert.equal(
    (await fetch(base + "/api/coins", { method: "POST", body: "{}" })).status,
    405,
  );
  const orders = JSON.parse(
    await readFile(join(directory, "data/orders.json"), "utf8"),
  );
  assert.equal(orders.at(-1).credited, false);
  // The bot is what credits: only an admin may press the payment button.
  const source = await readFile(join(directory, "server.js"), "utf8");
  assert.match(source, /admins\.includes\(String\(q\.from\.id\)\)/);
  assert.match(source, /callback_data: "paid:" \+ order\.id/);
  assert.match(source, /Начислять коины может только администратор/);
  assert.match(source, /function markPaid\(/);
  assert.doesNotMatch(
    source,
    /url\.pathname === "\/api\/coins" && req\.method === "POST"/,
  );
});

test("sandwich builder: bread is required, extras are priced on the server", async () => {
  const menu = await (await fetch(base + "/api/menu")).json();
  const caesar = menu.find((item) => item.id === "цезарь");
  assert.deepEqual(
    caesar.breads.map((b) => b.id),
    ["лепешка", "хлеб", "булочка"],
  );
  assert.equal(menu.find((item) => item.id === "клаб").breads.length, 1);
  assert.ok(!menu.some((item) => item.id === "мясо"), "add-ons live in the builder");
  const order = (items) =>
    fetch(base + "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        type: "pickup",
        branch: "Волжский",
        customer: { name: "Тест", phone: "+7 900 000-00-00" },
      }),
    });
  const missing = await order([{ id: "цезарь", qty: 1 }]);
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /Цезарь/);
  assert.equal(
    (await order([{ id: "цезарь", qty: 1, bread: "багет" }])).status,
    400,
  );
  const ok = await order([
    { id: "цезарь", qty: 2, bread: "хлеб", extras: ["мясо", "мясо", "соус-гриль", "золото"] },
    { id: "клаб", qty: 1 },
  ]);
  assert.equal(ok.status, 201);
  // (250 + 70 + 40) × 2 + 285
  assert.equal((await ok.json()).total, 1005);
  const orders = JSON.parse(
    await readFile(join(directory, "data/orders.json"), "utf8"),
  );
  const saved = orders.at(-1).items;
  assert.equal(saved[0].bread, "В хлебе");
  assert.deepEqual(saved[0].extras, ["Мясо", "Соус гриль"]);
  assert.equal(saved[1].bread, "В лепёшке");
});

// The cart is the part of the app that broke most in the field: a browser that
// blocks storage must not stop adding to the cart, and the sheet actions must
// stay visible on a phone screen.
test("interface keeps working when the browser blocks storage", async () => {
  const source = await readFile(join(directory, "app.js"), "utf8");
  const direct = source
    .split("\n")
    .map((line, index) => [index + 1, line.trim()])
    .filter(([, line]) => /localStorage\.(get|set|remove)Item/.test(line));
  assert.equal(direct.length, 3, "localStorage is used only by the safe store");
  const start = source.split("\n").findIndex((l) => l.includes("const store = {")) + 1;
  const end = source
    .split("\n")
    .findIndex((l, i) => i > start && l === "};");
  assert.ok(
    direct.every(([line]) => line > start && line < end),
    "every localStorage call sits inside the safe store helper",
  );
  assert.match(source, /cart = store\.getJSON\("bk-cart"/);
  assert.match(source, /if \(!store\.set\("bk-cart"/);
  // The success path must not depend on the write: persist draws the cart first.
  const persist = source.slice(source.indexOf("function persist()"));
  assert.ok(
    persist.indexOf("drawCart()") < persist.indexOf("store.set(\"bk-cart\""),
    "persist redraws the cart before saving it",
  );
});

test("sheet actions are pinned to the bottom of the sheet", async () => {
  const app = await readFile(join(directory, "app.js"), "utf8");
  const style = await readFile(join(directory, "style.css"), "utf8");
  assert.match(app, /class="sheet-footer"><button class="primary full" id="submitOrder"/);
  assert.match(app, /class="sheet-footer"><div class="builder-summary"/);
  assert.match(style, /\.sheet-footer \{[^}]*position: sticky/s);
});

test("index.html links versioned app.js/style.css so Telegram cannot reuse a stale copy", async () => {
  const response = await fetch(base + "/");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  const js = html.match(/src="app\.js\?v=([0-9a-f]{10})"/);
  const css = html.match(/href="style\.css\?v=([0-9a-f]{10})"/);
  assert.ok(js && css, "both files carry a content hash");
  // The versioned URL is still served as the plain file.
  const asset = await fetch(`${base}/app.js?v=${js[1]}`);
  assert.equal(asset.status, 200);
  assert.ok(asset.headers.get("content-type").startsWith("text/javascript"));
});

test("sheets fit the screen in older Telegram WebViews", async () => {
  const app = await readFile(join(directory, "app.js"), "utf8");
  const style = await readFile(join(directory, "style.css"), "utf8");
  // Syntax that makes an older WebView reject the whole script, or throws there.
  for (const [pattern, name] of [
    [/\|\|=|&&=|\?\?=/, "logical assignment"],
    [/\.at\(/, "Array.prototype.at"],
    [/behavior:\s*"instant"/, 'scroll behavior "instant"'],
  ])
    assert.doesNotMatch(app, pattern, name);
  // dvh only through the variable with a 100vh fallback; without it the sheet
  // grew past the top of the screen and could not be scrolled or closed.
  assert.match(style, /--app-height: 100vh;/);
  assert.match(style, /@supports \(height: 100dvh\)/);
  const withoutFallback = style
    .replace(/--app-height: 100dvh;/g, "")
    .replace(/@supports \(height: 100dvh\)/g, "");
  assert.doesNotMatch(withoutFallback, /\d+dvh/);
  assert.match(style, /\.sheet \{[^}]*max-height: calc\(var\(--app-height\)/s);
  assert.match(style, /\.overlay \{[^}]*height: var\(--app-height\)/s);
  // In Telegram the visible height comes from the client, swipes stay inside.
  assert.match(app, /viewportStableHeight/);
  assert.match(app, /disableVerticalSwipes/);
});

test("profile shows the version of the deployed build", async () => {
  const app = await readFile(join(directory, "app.js"), "utf8");
  const style = await readFile(join(directory, "style.css"), "utf8");
  // The same content hash the server puts into app.js?v=… names the build.
  assert.match(app, /const APP_VERSION = /);
  // The tag is matched by file name: /telegram-web-app.js also contains
  // «app.js» and used to win, so the profile showed «dev» instead of the hash.
  assert.match(app, /document\.querySelectorAll\("script\[src\]"\)/);
  assert.match(app, /\/\(\^\|\\\/\)app\\\.js\$\/\.test\(url\.pathname\)/);
  assert.doesNotMatch(app, /querySelector\('script\[src\*="app\.js"\]'\)/);
  assert.match(app, /searchParams\.get\("v"\)/);
  assert.match(app, /class="fine app-version">Версия \$\{APP_VERSION\}/);
  assert.match(style, /\.app-version \{/);
});

test("app errors reach the bot with the exact text", async () => {
  const source = await readFile(join(directory, "server.js"), "utf8");
  assert.match(source, /⚠️ Ошибка в приложении/);
  const app = await readFile(join(directory, "app.js"), "utf8");
  // The toast keeps the exact error text in parentheses for a screenshot.
  assert.match(app, /reportError/);
  assert.match(app, /\(\$\{message\.slice\(0, 140\)\}\)/);
  assert.match(app, /fail\("click", err, "Что-то пошло не так"\)/);
  assert.match(app, /fail\("order", err, "Заказ не отправлен"\)/);
  const send = (body) =>
    fetch(base + "/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  const ok = await send(
    JSON.stringify({
      message: "TypeError: true.map is not a function",
      where: "click",
      page: "menu",
      version: "2026.09.27 · abcdef1234",
    }),
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  // The same tap repeating the error must not flood the bot…
  const again = await send(
    JSON.stringify({
      message: "TypeError: true.map is not a function",
      where: "click",
    }),
  );
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  // …while a new message, an empty one and broken JSON are handled safely.
  const other = await send(JSON.stringify({ message: "Другая ошибка" }));
  assert.equal(other.status, 200);
  assert.equal((await send(JSON.stringify({ message: "  " }))).status, 400);
  assert.equal((await send("{")).status, 400);
});

// The catalogue also ships as a plain file. A host without a running Node
// server, or an API blocked by a proxy, must still open the menu — and with it
// food, the sandwich builder and the cart — instead of «Не получилось
// загрузить меню».
test("the menu works without the API", async () => {
  const response = await fetch(base + "/menu.json");
  assert.equal(response.status, 200);
  assert.ok(
    response.headers.get("content-type").startsWith("application/json"),
    "menu.json is served as JSON",
  );
  const file = await response.json();
  const api = await (await fetch(base + "/api/menu")).json();
  assert.deepEqual(
    file.map((item) => item.id),
    api.map((item) => item.id),
    "the file and the API serve the same catalogue",
  );
  const app = await readFile(join(directory, "app.js"), "utf8");
  assert.match(app, /const sources = \["\/api\/menu", "\/menu\.json"\]/);
  assert.match(app, /menuSource = url/);
  const source = await readFile(join(directory, "server.js"), "utf8");
  assert.match(source, /const menu = JSON\.parse\(fs\.readFileSync/);
});

// «The same errors came back» usually means the WebView still runs an old
// cached app.js, not that the fix failed: the running build asks the server
// which build is current and reloads itself with a cache-busting URL.
test("a stale running build can detect and refresh itself", async () => {
  const version = await (await fetch(base + "/api/version")).json();
  assert.match(version.hash, /^[0-9a-f]{10}$/);
  const html = await (await fetch(base + "/")).text();
  assert.equal(version.hash, html.match(/src="app\.js\?v=([0-9a-f]{10})"/)[1]);
  assert.equal(
    version.style,
    html.match(/href="style\.css\?v=([0-9a-f]{10})"/)[1],
  );
  const app = await readFile(join(directory, "app.js"), "utf8");
  assert.match(app, /fetch\("\/api\/version\?t=" \+ Date\.now\(\)/);
  assert.match(app, /location\.pathname \+ "\?build=" \+ Date\.now\(\)/);
  assert.match(app, /async function checkVersion/);
  assert.match(app, /data-action="update"/);
  assert.match(app, /data-action="reloadNow"/);
  // A second reload for the same build is refused: no reload loop.
  assert.match(app, /previous === latest/);
});

// The sheet is where cart, food and coin info broke in the field: heights are
// compared and the smallest wins, the overlay scrolls as a safety net, and a
// failed page or order never leaves a dead screen.
test("sheets follow the visible area and failures never dead-end", async () => {
  const app = await readFile(join(directory, "app.js"), "utf8");
  const style = await readFile(join(directory, "style.css"), "utf8");
  assert.match(app, /function measureViewport/);
  assert.match(app, /Math\.min\.apply\(null, list\)/);
  assert.match(app, /setProperty\("--vv-top"/);
  assert.match(app, /\["resize", "orientationchange"\]\.forEach/);
  assert.match(app, /visualViewport\?\.addEventListener\("resize", measureViewport\)/);
  assert.ok(
    app.indexOf("measureViewport();") < app.indexOf('$("#sheet").innerHTML = html'),
    "the sheet is measured right before it opens",
  );
  assert.match(style, /\.overlay \{[^}]*overflow-y: auto/s);
  assert.match(style, /\.overlay \{[^}]*top: var\(--vv-top/s);
  assert.match(style, /\.sheet \{[^}]*margin: auto/s);
  // A page that cannot be built shows why instead of a blank screen.
  assert.match(app, /reportError\("page:" \+ page, err\)/);
  // A failed order keeps the cart, retries once and can leave without the API.
  assert.match(app, /async function postOrder/);
  assert.match(app, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
  assert.match(app, /function showOrderProblem/);
  assert.match(app, /id="orderProblem"/);
  assert.match(app, /data-action="copyOrder"/);
  assert.match(app, /function copyText/);
  // Diagnostics: the environment and the exact error text in one screenshot.
  assert.match(app, /function diagnosticsReport/);
  assert.match(app, /data-action="diagnostics"/);
  assert.match(app, /logError\(where, message\)/);
  assert.match(app, /class="fine app-version">Версия \$\{APP_VERSION\}/);
});
