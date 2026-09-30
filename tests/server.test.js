import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import http from "node:http";
import { once } from "node:events";
import { createHmac } from "node:crypto";

let process, directory, base, fakeTelegram;
const telegramCalls = [];
const telegramCallListeners = new Set();
// The admin menu is driven by button presses, so most of these updates are
// callback queries against the menu message.
const telegramUpdates = [
  {
    update_id: 1,
    message: {
      chat: { id: 222222, type: "private" },
      from: { id: 222222, first_name: "Гость" },
      text: "/start",
    },
  },
  {
    update_id: 2,
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "/start",
    },
  },
  {
    update_id: 3,
    callback_query: {
      id: "cb-orders",
      from: { id: 123456789, first_name: "Босс" },
      data: "m:orders",
      message: { chat: { id: 123456789 }, message_id: 11, text: "меню" },
    },
  },
  {
    update_id: 4,
    callback_query: {
      id: "cb-guest",
      from: { id: 222222, first_name: "Гость" },
      data: "m:main",
      message: { chat: { id: 222222 }, message_id: 12, text: "меню" },
    },
  },
];
let nextUpdateId = 100;
// Tests push new updates while the bot is polling: the same long-poll loop
// picks them up, exactly like a real person tapping.
function pushUpdate(update) {
  telegramUpdates.push({ update_id: nextUpdateId++, ...update });
}
// Telegram signs everything it hands to a Mini App; the test signs initData
// with the same bot token, so the server can check it the way it checks a real
// /staff page opened from the bot.
function makeInitData(user) {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", "AAHdF6IQAAAAAN0XohDhrOrc");
  params.set("user", JSON.stringify(user));
  const pairs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  const secret = createHmac("sha256", "WebAppData").update("test-token").digest();
  params.set(
    "hash",
    createHmac("sha256", secret).update(pairs.join("\n")).digest("hex"),
  );
  return params.toString();
}
function waitForTelegramCall(predicate, timeout = 5000) {
  const found = telegramCalls.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      telegramCallListeners.delete(listener);
      reject(new Error("Timed out waiting for a Telegram API call"));
    }, timeout);
    const listener = (call) => {
      if (!predicate(call)) return;
      clearTimeout(timer);
      telegramCallListeners.delete(listener);
      resolve(call);
    };
    telegramCallListeners.add(listener);
  });
}
before(async () => {
  // Isolated server and local Telegram stub: tests never reach real Telegram or app data.
  directory = await mkdtemp(join(tmpdir(), "bk-test-"));
  for (const file of [
    "server.js",
    "package.json",
    "index.html",
    "style.css",
    "app.js",
    "menu.json",
    "staff.html",
    "staff.js",
    "staff.css",
    "assets",
  ]) {
    await cp(new URL("../" + file, import.meta.url), join(directory, file), {
      recursive: true,
    });
  }
  await writeFile(join(directory, ".env"), "TEST_SECRET=not-public");
  fakeTelegram = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, "http://telegram.test");
    const method = url.pathname.split("/").pop();
    let result = true;
    if (method === "getUpdates") {
      const offset = Number(url.searchParams.get("offset") || 0);
      result = telegramUpdates.filter((update) => update.update_id >= offset);
    } else {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      const call = { method, body };
      telegramCalls.push(call);
      for (const listener of [...telegramCallListeners]) listener(call);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  });
  fakeTelegram.listen(0, "127.0.0.1");
  await once(fakeTelegram, "listening");
  const telegramApiUrl = `http://127.0.0.1:${fakeTelegram.address().port}`;
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
      BOT_TOKEN: "test-token",
      ADMIN_IDS: "123456789",
      APP_URL: "https://app.example.test/miniapp",
      TELEGRAM_API_URL: telegramApiUrl,
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
  if (fakeTelegram) await new Promise((resolve) => fakeTelegram.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("Telegram welcomes guests and hands admins an inline menu", async () => {
  const welcome = await waitForTelegramCall(
    (call) => call.method === "sendMessage" && call.body.chat_id === 222222,
  );
  assert.match(welcome.body.text, /синюю кнопку/);
  assert.equal(
    welcome.body.reply_markup.inline_keyboard[0][0].web_app.url,
    "https://app.example.test/miniapp",
  );
  const menuButton = await waitForTelegramCall(
    (call) => call.method === "setChatMenuButton",
  );
  assert.equal(menuButton.body.menu_button.text, "Открыть приложение");
  assert.equal(menuButton.body.menu_button.web_app.url, "https://app.example.test/miniapp");
  // The admin gets a menu of buttons instead of a list of commands to memorise.
  const menu = await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 123456789 &&
      String(call.body.text).includes("меню администратора"),
  );
  const buttons = menu.body.reply_markup.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text).join(" ");
  for (const label of ["📋 Заказы", "💳 Оплатить", "🛑 Стоп-лист", "🏁 Гоу-лист", "👥 Админы", "➕ Добавить админа", "❓ Помощь"])
    assert.ok(labels.includes(label), "the menu offers " + label);
  assert.ok(!buttons.some((button) => /управление меню/i.test(button.text)), "catalog editing is not offered in the bot");
  // The team page opens straight from the chat, no password involved.
  const staff = buttons.find((button) => button.web_app?.url);
  assert.equal(staff.web_app.url, "https://app.example.test/staff");
  const screens = buttons.map((button) => button.callback_data);
  assert.ok(screens.includes("m:orders") && screens.includes("m:admins"));
  // Tapping a button edits the same message instead of piling up new ones.
  const orders = await waitForTelegramCall(
    (call) => call.method === "editMessageText" && call.body.message_id === 11,
  );
  assert.match(orders.body.text, /Последние заказы|Заказов пока нет/);
  assert.ok(
    orders.body.reply_markup.inline_keyboard
      .flat()
      .some((button) => button.callback_data === "m:main"),
    "every screen has a way back",
  );
  // A guest pressing the same buttons is refused.
  const refused = await waitForTelegramCall(
    (call) => call.method === "answerCallbackQuery" && call.body.callback_query_id === "cb-guest",
  );
  assert.match(refused.body.text, /только для администраторов/);
});

test("admins are added by id, by @nickname or from a reply — and get everything", async () => {
  // A future admin writes to the bot once, so the bot knows both his id and
  // his nickname; that is what makes «/addadmin @ivan» resolvable.
  pushUpdate({
    message: {
      chat: { id: 555000111, type: "private" },
      from: { id: 555000111, first_name: "Иван", username: "ivan" },
      text: "/start",
    },
  });
  await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 555000111 &&
      /синюю кнопку/.test(String(call.body.text)),
  );
  // By nickname.
  pushUpdate({
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "/addadmin @ivan",
    },
  });
  const added = await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 123456789 &&
      String(call.body.text).includes("Админ добавлен"),
  );
  assert.match(added.body.text, /Иван @ivan · id 555000111/);
  // He is told himself, and the menu opens for him right away.
  const told = await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 555000111 &&
      String(call.body.text).includes("добавили администратором"),
  );
  assert.match(told.body.text, /\/menu/);
  pushUpdate({
    message: {
      chat: { id: 555000111, type: "private" },
      from: { id: 555000111, first_name: "Иван", username: "ivan" },
      text: "/menu",
    },
  });
  const hisMenu = await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 555000111 &&
      String(call.body.text).includes("меню администратора"),
  );
  assert.ok(
    hisMenu.body.reply_markup.inline_keyboard
      .flat()
      .some((button) => button.callback_data === "m:admins"),
    "a newly added admin gets the same menu",
  );
  // By id, even for somebody who never wrote to the bot.
  pushUpdate({
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "/addadmin 555000222",
    },
  });
  await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 123456789 &&
      /Админ добавлен[\s\S]*555000222/.test(String(call.body.text)),
  );
  // By answering somebody's message.
  pushUpdate({
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "/addadmin",
      reply_to_message: {
        message_id: 7,
        from: { id: 555000333, first_name: "Оля", username: "olya" },
        text: "привет",
      },
    },
  });
  await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 123456789 &&
      /Админ добавлен[\s\S]*555000333/.test(String(call.body.text)),
  );
  // The main admin from ADMIN_IDS cannot be removed from the bot.
  pushUpdate({
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "/deladmin 123456789",
    },
  });
  const refused = await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 123456789 &&
      /ADMIN_IDS/.test(String(call.body.text)),
  );
  assert.match(refused.body.text, /ADMIN_IDS/);
  // Everybody else can.
  pushUpdate({
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "/deladmin 555000222",
    },
  });
  await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 123456789 &&
      String(call.body.text).includes("Админ удалён"),
  );
  const stored = JSON.parse(await readFile(join(directory, "data/admins.json"), "utf8"));
  assert.deepEqual(
    stored.admins.map((admin) => admin.id).sort(),
    ["555000111", "555000333"],
  );
  assert.equal((await fetch(base + "/data/admins.json")).status, 404);
  // Whoever wrote to the bot can be picked from the menu; the list stays on
  // the server and is never served as a file.
  const people = JSON.parse(await readFile(join(directory, "data/people.json"), "utf8"));
  assert.ok(
    people.people.some((p) => p.id === "555000111" && p.username === "ivan"),
    "the bot remembers who wrote to it",
  );
  assert.equal((await fetch(base + "/data/people.json")).status, 404);
});

test("menu and public assets load with correct MIME types", async () => {
  const menu = await (await fetch(base + "/api/menu")).json();
  assert.equal(menu.length, 122);
  assert.equal(new Set(menu.map((item) => item.id)).size, menu.length);
  for (const item of menu.filter((p) => p.category !== "Еда"))
    assert.ok(item.art, "drink has an illustration: " + item.id);
  assert.equal(menu.find((item) => item.id === "большой-латте").price, 200);
  // The kitchen card added from the photographed paper menu: breakfasts,
  // salads, soups and mains, each with a weight in the description.
  for (const [group, id, price] of [
    ["Завтраки", "сырники", 320],
    ["Завтраки", "английский-завтрак", 420],
    ["Салаты", "салат-с-креветками", 350],
    ["Салаты", "хумус", 320],
    ["Супы", "том-ям-с-креветками", 410],
    ["Горячее", "паста-с-тигровыми-креветками", 575],
  ]) {
    const item = menu.find((p) => p.id === id);
    assert.ok(item, id);
    assert.equal(item.group, group, id);
    assert.equal(item.price, price, id);
    assert.equal(item.category, "Еда", id);
    assert.match(item.desc, / г$/, id + " lists its weight");
  }
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
  assert.match(source, /if \(!isAdmin\(userId\)\)/);
  assert.match(source, /callback_data: "paid:" \+ order\.id/);
  assert.match(source, /Начислять коины может только администратор/);
  assert.doesNotMatch(source, /\/api\/staff\/login/);
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
  assert.match(source, /let menu = JSON\.parse\(fs\.readFileSync\(path\.join\(root, "menu\.json"\)/);
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

// ---------------------------------------------------------------------------
// Team tools: no logins and no passwords. An admin opens /staff from the bot,
// Telegram signs who it is, and the admin gets every list and every card.
const adminUser = { id: 123456789, first_name: "Босс", username: "boss" };
test("the team page signs an admin in with Telegram — no passwords anywhere", async () => {
  const source = await readFile(join(directory, "server.js"), "utf8");
  assert.match(source, /function telegramUserFromInitData\(/);
  assert.match(source, /web_app: \{ url: staffUrl \}/);
  assert.doesNotMatch(source, /\/api\/staff\/login/);
  assert.doesNotMatch(source, /scryptSync/);
  assert.doesNotMatch(source, /STAFF_PIN/);
  // Without a session nothing is readable and nothing is writable.
  assert.equal((await fetch(base + "/api/staff/state")).status, 401);
  assert.equal(
    (
      await staffPost("", "/api/staff/stop", {
        name: "Без входа",
        station: "Кухня",
      })
    ).status,
    401,
  );
  // The old password entrance is gone for good, not merely disabled: the
  // route does not exist any more, so a posted password reaches no handler.
  const old = await fetch(base + "/api/staff/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "admin", password: "test-staff-pin" }),
  });
  assert.equal(old.status, 401, "there is no password route to talk to");
  // A forged signature does not pass.
  const forged = await fetch(base + "/api/staff/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      initData: makeInitData(adminUser).replace(/hash=[^&]+/, "hash=deadbeef"),
    }),
  });
  assert.equal(forged.status, 401);
  // A stranger who really is in Telegram is still not an admin.
  const stranger = await fetch(base + "/api/staff/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      initData: makeInitData({ id: 999111222, first_name: "Кто-то" }),
    }),
  });
  assert.equal(stranger.status, 403);
  assert.match((await stranger.json()).error, /не администратор/);
  // A session left over from the password era is dead: it has a login instead
  // of a Telegram id, so it must not open the page any more.
  const filename = join(directory, "data/staff.json");
  let legacy = {};
  try {
    legacy = JSON.parse(await readFile(filename, "utf8"));
  } catch {}
  legacy.accounts = [
    { login: "old", name: "Старый", role: "админ", salt: "x", hash: "y" },
  ];
  legacy.sessions = {
    ...(legacy.sessions || {}),
    "old-token": { login: "old", exp: Date.now() + 1000000 },
  };
  await writeFile(filename, JSON.stringify(legacy, null, 2));
  assert.equal(
    (
      await fetch(base + "/api/staff/state", {
        headers: { "X-Staff-Token": "old-token" },
      })
    ).status,
    401,
    "an old login session no longer opens the team page",
  );
  // The real admin is in and has every right.
  const login = await fetch(base + "/api/staff/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: makeInitData(adminUser) }),
  });
  assert.equal(login.status, 200);
  const data = await login.json();
  assert.ok(data.token, "a session token comes back");
  assert.deepEqual(data.me.permissions.manageStations, ["Кухня", "Бар"]);
  const state = await (
    await fetch(base + "/api/staff/state", {
      headers: { "X-Staff-Token": data.token },
    })
  ).json();
  assert.equal(state.me.name, "Босс");
  assert.equal(state.permissions.recipes, true);
});

let staffToken = "";
async function staffLogin() {
  if (staffToken) return staffToken;
  const response = await fetch(base + "/api/staff/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: makeInitData(adminUser) }),
  });
  assert.equal(response.status, 200);
  staffToken = (await response.json()).token;
  return staffToken;
}
const staffPost = (token, path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Staff-Token": token },
    body: JSON.stringify(body),
  });

test("a one-time link opens /staff in a plain browser", async () => {
  pushUpdate({
    callback_query: {
      id: "cb-link",
      from: { id: 123456789, first_name: "Босс" },
      data: "m:link",
      message: { chat: { id: 123456789 }, message_id: 21, text: "меню" },
    },
  });
  const link = await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      call.body.chat_id === 123456789 &&
      /Ссылка на страницу команды/.test(String(call.body.text)),
  );
  const url = link.body.reply_markup.inline_keyboard[0][0].url;
  assert.match(url, /^https:\/\/app\.example\.test\/staff#key=/);
  const key = new URL(url).hash.replace("#key=", "");
  const ok = await fetch(base + "/api/staff/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(
    (
      await fetch(base + "/api/staff/state", {
        headers: { "X-Staff-Token": data.token },
      })
    ).status,
    200,
  );
  // One use only, and a made-up key is refused.
  assert.equal(
    (
      await fetch(base + "/api/staff/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/staff/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "нет-такого" }),
      })
    ).status,
    401,
  );
});

test("every admin has every right: no roles, no stations split by role", async () => {
  const source = await readFile(join(directory, "server.js"), "utf8");
  assert.doesNotMatch(source, /staffRoles/);
  assert.doesNotMatch(source, /manageStations\.includes/);
  const token = await staffLogin();
  // Both stations are editable by the same person.
  for (const [station, itemId] of [["Кухня", "сырники"], ["Бар", "большой-латте"]]) {
    const response = await staffPost(token, "/api/staff/stop", {
      itemId,
      station,
    });
    assert.equal(response.status, 200, station);
    const stop = (await response.json()).stop;
    assert.equal(stop[0].station, station);
    assert.equal(stop[0].itemId, itemId);
    await staffPost(token, "/api/staff/stop", {
      action: "remove",
      id: stop[0].id,
    });
  }
  // Recipe cards are open too, and the algorithm reaches the bot with the order.
  const recipe = await staffPost(token, "/api/staff/recipes", {
    itemId: "сырники",
    text: "1. Подготовить ингредиенты.\n2. Приготовить и проверить подачу.",
  });
  assert.equal(recipe.status, 200);
  assert.equal((await recipe.json()).recipes["сырники"].by, "Босс");
  const placed = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "сырники", qty: 1 }],
      type: "pickup",
      branch: "Волжский",
      customer: { name: "Тест", phone: "+7 900 000-00-02" },
    }),
  });
  assert.equal(placed.status, 201);
  const placedOrder = await placed.json();
  const instructions = await waitForTelegramCall(
    (call) =>
      call.method === "sendMessage" &&
      String(call.body.text).includes(
        `Алгоритм действий по блюдам заказа #${placedOrder.id}`,
      ),
  );
  assert.match(instructions.body.text, /Сырники × 1/);
  assert.match(instructions.body.text, /Подготовить ингредиенты/);
  // Logins, roles and password hashes are gone from the stored data.
  const stored = JSON.parse(await readFile(join(directory, "data/staff.json"), "utf8"));
  assert.equal(stored.accounts, undefined);
  assert.ok(
    !Object.values(stored.sessions || {}).some((session) => session.login),
    "sessions are Telegram sessions now",
  );
});

// Stop/go entries are selected from the existing menu by a keyword search.
test("the inline menu searches menu products for the stop list", async () => {
  const orders = JSON.parse(
    await readFile(join(directory, "data/orders.json"), "utf8"),
  );
  const unpaid = orders.filter((order) => !order.credited).at(-1);
  pushUpdate({
    callback_query: {
      id: "cb-pay",
      from: { id: 123456789, first_name: "Босс" },
      data: "pay:" + unpaid.id,
      message: { chat: { id: 123456789 }, message_id: 31, text: "оплата" },
    },
  });
  const paid = await waitForTelegramCall(
    (call) => call.method === "answerCallbackQuery" && /коинов/i.test(String(call.body.text)),
  );
  assert.match(paid.body.text, new RegExp("#" + unpaid.id));

  pushUpdate({
    callback_query: {
      id: "cb-new-stop",
      from: { id: 123456789, first_name: "Босс" },
      data: "new:stop",
      message: { chat: { id: 123456789 }, message_id: 32, text: "стоп" },
    },
  });
  const asked = await waitForTelegramCall(
    (call) => call.method === "sendMessage" && call.body.chat_id === 123456789 && /ключевые слова/.test(String(call.body.text)),
  );
  assert.ok(asked.body.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === "cancel"));
  pushUpdate({
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "сырн",
    },
  });
  const results = await waitForTelegramCall(
    (call) => call.method === "sendMessage" && call.body.chat_id === 123456789 && /Найдено в меню/.test(String(call.body.text)),
  );
  const pick = results.body.reply_markup.inline_keyboard.flat().find((button) => button.callback_data === "pick:stop:сырники");
  assert.ok(pick, "keyword search returns the exact menu item as a button");
  pushUpdate({
    callback_query: {
      id: "cb-pick-stop",
      from: { id: 123456789, first_name: "Босс" },
      data: pick.callback_data,
      message: { chat: { id: 123456789 }, message_id: 33, text: "выбрать" },
    },
  });
  const done = await waitForTelegramCall(
    (call) => call.method === "sendMessage" && call.body.chat_id === 123456789 && /снято с продажи/.test(String(call.body.text)),
  );
  assert.match(done.body.text, /Сырники/);
  const stopped = JSON.parse(await readFile(join(directory, "data/staff.json"), "utf8"));
  assert.equal(stopped.stop[0].name, "Сырники");
  assert.equal(stopped.stop[0].itemId, "сырники");
  assert.equal(stopped.stop[0].station, "Кухня");
  assert.equal(stopped.stop[0].by, "Босс");

  pushUpdate({
    message: {
      chat: { id: 123456789, type: "private" },
      from: { id: 123456789, first_name: "Босс", username: "boss" },
      text: "/stoplist",
    },
  });
  await waitForTelegramCall(
    (call) => call.method === "sendMessage" && call.body.chat_id === 123456789 && /Стоп-лист:/.test(String(call.body.text)),
  );
  pushUpdate({
    callback_query: {
      id: "cb-rm",
      from: { id: 123456789, first_name: "Босс" },
      data: "rm:stop:" + stopped.stop[0].id,
      message: { chat: { id: 123456789 }, message_id: 34, text: "стоп" },
    },
  });
  const back = await waitForTelegramCall(
    (call) => call.method === "answerCallbackQuery" && /Вернули в продажу/.test(String(call.body.text)),
  );
  assert.ok(back);
  const after = JSON.parse(await readFile(join(directory, "data/staff.json"), "utf8"));
  assert.equal(after.stop.length, 0);
});
test("stop list removes an item from sale until the team returns it", async () => {
  const token = await staffLogin();
  const added = await staffPost(token, "/api/staff/stop", {
    itemId: "сырники",
    name: "Сырники",
    station: "Кухня",
  });
  assert.equal(added.status, 200);
  const stopped = (await added.json()).stop;
  assert.equal(stopped[0].name, "Сырники");
  assert.equal(stopped[0].by, "Босс", "the change is signed by the admin");
  // The customer menu now carries the flag…
  const menu = await (await fetch(base + "/api/menu")).json();
  assert.equal(menu.find((p) => p.id === "сырники").stop, true);
  assert.ok(!menu.find((p) => p.id === "большой-латте").stop);
  // …and checkout refuses the stopped item with a clear reason.
  const refused = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "сырники", qty: 1 }],
      type: "here",
      branch: "Волжский",
      customer: { name: "Тест", phone: "+7 900 000-00-00" },
    }),
  });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /стоп-лист/);
  // The same item cannot be stopped twice for the same station.
  assert.equal(
    (
      await staffPost(token, "/api/staff/stop", {
        itemId: "сырники",
        name: "Сырники",
        station: "Кухня",
      })
    ).status,
    409,
  );
  // Back on sale: the flag disappears and the order goes through.
  const removed = await staffPost(token, "/api/staff/stop", {
    action: "remove",
    id: stopped[0].id,
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).stop.length, 0);
  const fresh = await (await fetch(base + "/api/menu")).json();
  assert.ok(!fresh.find((p) => p.id === "сырники").stop);
  const ok = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "сырники", qty: 1 }],
      type: "here",
      branch: "Волжский",
      customer: { name: "Тест", phone: "+7 900 000-00-00" },
    }),
  });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).total, 320);
});

test("go list, shift roster and question board work end to end", async () => {
  const token = await staffLogin();
  // Arbitrary free text is refused; menu ids are canonical list entries.
  const invalidGo = await staffPost(token, "/api/staff/go", {
    name: "Пирог дня",
    station: "Бар",
    note: "Срок до вечера",
  });
  assert.equal(invalidGo.status, 400);
  const go = await staffPost(token, "/api/staff/go", {
    itemId: "большой-латте",
    name: "неверное имя клиента",
    station: "Бар",
    note: "Срок до вечера",
  });
  assert.equal(go.status, 200);
  const goList = (await go.json()).go;
  assert.equal(goList[0].note, "Срок до вечера");
  assert.equal(goList[0].itemId, "большой-латте");
  assert.equal(goList[0].name, "Большой латте", "the API uses the canonical catalog name");
  await staffPost(token, "/api/staff/go", { action: "remove", id: goList[0].id });
  // Shift roster: added for today, duplicates refused.
  const shift = await staffPost(token, "/api/staff/shift", {
    name: "Аня",
    role: "Бар",
  });
  assert.equal(shift.status, 200);
  assert.equal((await shift.json()).shift[0].name, "Аня");
  assert.equal(
    (await staffPost(token, "/api/staff/shift", { name: "Аня", role: "Бар" }))
      .status,
    409,
  );
  // Board: add, resolve, delete.
  const note = await staffPost(token, "/api/staff/board", {
    text: "Заканчивается альтернативное молоко",
  });
  assert.equal(note.status, 200);
  const board = (await note.json()).board;
  assert.equal(board[0].done, false);
  const toggled = await staffPost(token, "/api/staff/board", {
    action: "toggle",
    id: board[0].id,
  });
  assert.equal((await toggled.json()).board[0].done, true);
  await staffPost(token, "/api/staff/board", { action: "remove", id: board[0].id });
  // Logout kills the token.
  await staffPost(token, "/api/staff/logout", {});
  assert.equal(
    (await staffPost(token, "/api/staff/board", { text: "после выхода" })).status,
    401,
  );
});

test("food subcategories have stronger visual separation", async () => {
  const style = await readFile(join(directory, "style.css"), "utf8");
  assert.match(style, /\.food-group > h2\s*\{/);
  assert.match(style, /\.food-part\s*\{[\s\S]*?border-left: 4px solid var\(--yellow\)/);
  assert.match(style, /\.food-part h3::before\s*\{/);
  assert.match(style, /@media \(max-width: 680px\)\s*\{[\s\S]*?\.food-part\s*\{/);
});

test("the /staff page is served while team data stays private", async () => {
  for (const url of ["/staff", "/staff.html"]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get("content-type").startsWith("text/html"), url);
    assert.match(await response.text(), /Для команды/);
  }
  for (const [url, type] of [
    ["/staff.js", "text/javascript"],
    ["/staff.css", "text/css"],
  ]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get("content-type").startsWith(type), url);
  }
  // Accounts, sessions and lists never leave the server as a file.
  assert.equal((await fetch(base + "/data/staff.json")).status, 404);
  // The customer app knows how to show a stopped item.
  const app = await readFile(join(directory, "app.js"), "utf8");
  assert.match(app, /stop-tag/);
  assert.match(app, /стоп-лист/);
  const style = await readFile(join(directory, "style.css"), "utf8");
  assert.match(style, /\.stop-tag \{/);
});
