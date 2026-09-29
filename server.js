import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url)),
  dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, "orders.json");
const token = process.env.BOT_TOKEN || "",
  admins = (process.env.ADMIN_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
// Last client error reports per message text: one failure must not flood the
// admins' bot when the same tap repeats the error.
const recentErrors = {};
// Asset names are part of the build identity. The same content hash travels to
// the client two ways: inside index.html (app.js?v=…) and through
// /api/version, so an app that is running an old cached file can notice it and
// reload itself instead of showing yesterday's bugs.
const assetHash = (name) =>
  crypto
    .createHash("sha1")
    .update(fs.readFileSync(path.join(root, name)))
    .digest("hex")
    .slice(0, 10);
const buildInfo = () => ({
  hash: assetHash("app.js"),
  style: assetHash("style.css"),
  app: "2026.09.29",
});
// The catalogue lives in menu.json, not in this file. The app also loads that
// very file when /api/menu is unreachable, so the menu, the sandwich builder
// and the cart keep working on a host without a running server. Breads are
// stored as {id, name}, extras as {id, name, price, group}: the order is priced
// from this same data, so the browser can never invent a price.
const menu = JSON.parse(fs.readFileSync(path.join(root, "menu.json"), "utf8"));
// Validates one cart line against the catalogue and prices it on the server.
function orderLine(input) {
  const p = menu.find((x) => x.id === input?.id);
  if (!p) return null;
  const line = {
    id: p.id,
    name: p.name,
    qty: Math.min(20, Math.max(1, Math.floor(Number(input.qty)) || 1)),
  };
  let price = p.price;
  if (Array.isArray(p.breads) && p.breads.length) {
    const bread =
      p.breads.length === 1
        ? p.breads[0]
        : p.breads.find((b) => b.id === input.bread);
    if (!bread) throw new Error(`Выберите, в чём приготовить «${p.name}»`);
    line.bread = bread.name;
    const available = Array.isArray(p.extras) ? p.extras : [];
    const chosen = [...new Set(Array.isArray(input.extras) ? input.extras : [])]
      .slice(0, available.length)
      .map((id) => available.find((e) => e.id === id))
      .filter(Boolean);
    if (chosen.length) {
      line.extras = chosen.map((e) => e.name);
      price += chosen.reduce((sum, e) => sum + e.price, 0);
    }
  }
  line.price = price;
  return line;
}
const lineTitle = (i) =>
  [i.name, i.bread?.toLowerCase(), i.extras?.length ? "+ " + i.extras.join(", ").toLowerCase() : ""]
    .filter(Boolean)
    .join(" · ");
const read = () => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
};
const coinsFile = path.join(dataDir, "coins.json");
const readCoins = () => {
  try {
    return JSON.parse(fs.readFileSync(coinsFile, "utf8"));
  } catch {
    return {};
  }
};
// Balance key: the phone is always collected at checkout and works on any
// device; the Telegram id is only a fallback for orders without a phone.
const coinsKey = (customer) => {
  const phone = String(customer?.phone || "").replace(/\D/g, "");
  const uid = String(customer?.telegramId || "").replace(/\D/g, "");
  return phone ? "phone:" + phone : uid ? "tg:" + uid : "";
};
const plannedCoins = (total) => Math.floor(total * 0.05);
// Coins move only here: the admin taps the button under the order in the bot
// after the customer has actually paid. Nothing in the HTTP API can credit.
function creditCoins(order) {
  const key = coinsKey(order.customer);
  if (!key) return 0;
  const balances = readCoins();
  const amount = plannedCoins(order.total);
  const entry = balances[key] || { coins: 0, history: [] };
  entry.coins += amount;
  entry.history.unshift({
    order: order.id,
    amount,
    at: new Date().toISOString(),
  });
  balances[key] = entry;
  fs.writeFileSync(coinsFile, JSON.stringify(balances, null, 2));
  return amount;
}
function markPaid(orderId) {
  const orders = read();
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { error: "Заказ не найден" };
  if (order.credited) return { error: `Заказ #${order.id} уже оплачен` };
  const amount = creditCoins(order);
  order.status = "Оплачен";
  order.credited = true;
  order.paidAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(orders, null, 2));
  return { order, amount };
}
function json(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(obj));
}
async function telegram(method, body = {}) {
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.error("Telegram:", e.message);
    return null;
  }
}
const money = (n) => new Intl.NumberFormat("ru-RU").format(n) + " ₽";
async function updateBot() {
  if (!token) return;
  let offset = 0;
  while (true) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25`,
      );
      const j = await r.json();
      if (j.ok)
        for (const u of j.result) {
          offset = u.update_id + 1;
          // The button under the order notification is the only way coins
          // ever move, and only an admin can press it.
          const q = u.callback_query;
          if (q && /^paid:/.test(String(q.data || ""))) {
            const id = String(q.data).slice(5);
            if (!admins.includes(String(q.from.id))) {
              await telegram("answerCallbackQuery", {
                callback_query_id: q.id,
                text: "Начислять коины может только администратор",
              });
              continue;
            }
            const result = markPaid(id);
            await telegram("answerCallbackQuery", {
              callback_query_id: q.id,
              text: result.error
                ? result.error
                : `Начислено ${result.amount} БК-Коинов за заказ #${result.order.id}`,
            });
            if (!result.error && q.message)
              await telegram("editMessageText", {
                chat_id: q.message.chat.id,
                message_id: q.message.message_id,
                text:
                  (q.message.text || "") +
                  `\n\n✅ Оплачен · начислено ${result.amount} БК-Коинов`,
                reply_markup: JSON.stringify({ inline_keyboard: [] }),
              });
            continue;
          }
          const m = u.message;
          if (m && admins.includes(String(m.chat.id))) {
            // Text alternative to the button: /paid <номер заказа>.
            const paid = /^\/paid\s+(\S+)/.exec(m.text || "");
            if (paid) {
              const result = markPaid(paid[1]);
              await telegram("sendMessage", {
                chat_id: m.chat.id,
                text: result.error
                  ? result.error
                  : `✅ Заказ #${result.order.id} оплачен · начислено ${result.amount} БК-Коинов`,
              });
              continue;
            }
            if (/^\/(start|orders)/.test(m.text || "")) {
              const orders = read().slice(-8).reverse();
              await telegram("sendMessage", {
                chat_id: m.chat.id,
                text: orders.length
                  ? orders
                      .map(
                        (o) =>
                          `#${o.id} · ${o.status}${o.credited ? ` · +${o.coinsEarned} коинов` : ""}\n${o.customer.name} · ${o.customer.phone}\n${o.items.map((i) => `${lineTitle(i)} × ${i.qty}`).join(", ")}\n${o.type === "here" ? "В кофейне" : "К выдаче"} · ${o.branch}\n${money(o.total)}`,
                      )
                      .join("\n\n")
                  : "Заказов пока нет",
              });
            }
          }
        }
      else await new Promise((x) => setTimeout(x, 3000));
    } catch (e) {
      await new Promise((x) => setTimeout(x, 5000));
    }
  }
}
if (token) updateBot();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }
  if (url.pathname === "/api/menu") return json(res, 200, menu);
  if (url.pathname === "/api/coins" && req.method === "GET") {
    const phone = String(url.searchParams.get("phone") || "").replace(/\D/g, "");
    const uid = String(url.searchParams.get("uid") || "").replace(/\D/g, "");
    const key = phone ? "phone:" + phone : uid ? "tg:" + uid : "";
    if (!key) return json(res, 200, { coins: 0, pending: 0 });
    const entry = readCoins()[key] || { coins: 0 };
    const pending = read()
      .filter((o) => !o.credited && coinsKey(o.customer) === key)
      .reduce((s, o) => s + plannedCoins(o.total), 0);
    return json(res, 200, { coins: entry.coins || 0, pending });
  }
  if (url.pathname === "/api/health")
    return json(res, 200, { ok: true, payments: "stub" });
  // The running build. The app compares this with the hash it was loaded with:
  // if they differ, a stale cached app.js is running and the page reloads
  // itself with a cache-busting URL (see the client-side update check).
  if (url.pathname === "/api/version") {
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, buildInfo());
  }
  if (url.pathname === "/api/client-error" && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      if (raw.length > 20000)
        return json(res, 413, { error: "Слишком большое сообщение" });
      const b = JSON.parse(raw);
      const clean = (v, n) =>
        String(v || "")
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .trim()
          .slice(0, n);
      const message = clean(b.message, 300);
      if (!message) return json(res, 400, { error: "Пустое сообщение" });
      const key = message.slice(0, 60) + "|" + clean(b.where, 40);
      const now = Date.now();
      if (recentErrors[key] && now - recentErrors[key] < 60000)
        return json(res, 200, { ok: true, duplicate: true });
      if (Object.keys(recentErrors).length > 500)
        for (const k of Object.keys(recentErrors))
          if (now - recentErrors[k] >= 60000) delete recentErrors[k];
      recentErrors[key] = now;
      for (const id of admins)
        telegram("sendMessage", {
          chat_id: id,
          text: `⚠️ Ошибка в приложении\n${message}\n\nРаздел: ${
            clean(b.page, 40) || "—"
          }\nГде: ${clean(b.where, 80) || "—"}\nВерсия: ${
            clean(b.version, 40) || "—"
          }`,
        });
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { error: "Некорректный запрос" });
    }
  }
  if (url.pathname === "/api/orders" && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      const b = JSON.parse(raw);
      if (
        !b.items?.length ||
        !b.customer?.name ||
        !b.customer?.phone ||
        !b.branch
      )
        return json(res, 400, { error: "Заполните данные заказа" });
      if (!Array.isArray(b.items) || b.items.length > 50)
        return json(res, 400, { error: "Некорректный заказ" });
      let items;
      try {
        items = b.items.map(orderLine).filter(Boolean);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      if (!items.length) return json(res, 400, { error: "Корзина пуста" });
      const total = items.reduce((s, i) => s + i.price * i.qty, 0),
        orders = read();
      const order = {
        id: Date.now().toString(36).toUpperCase(),
        createdAt: new Date().toISOString(),
        status: "Новый",
        type: b.type === "here" ? "here" : "pickup",
        branch: String(b.branch).slice(0, 100),
        customer: {
          name: String(b.customer.name).slice(0, 80),
          phone: String(b.customer.phone).slice(0, 30),
          telegramId: String(b.customer.telegramId || "").slice(0, 80),
        },
        items,
        total,
        coinsEarned: plannedCoins(total),
        credited: false,
      };
      orders.push(order);
      fs.writeFileSync(file, JSON.stringify(orders, null, 2));
      for (const id of admins)
        telegram("sendMessage", {
          chat_id: id,
          text: `☕ НОВЫЙ ЗАКАЗ #${order.id}\n${order.type === "here" ? "📍 В кофейне" : "🛍 С собой"} · ${order.branch}\n👤 ${order.customer.name} · ${order.customer.phone}\n\n${items.map((i) => `${lineTitle(i)} × ${i.qty} — ${money(i.price * i.qty)}`).join("\n")}\n\nИтого: ${money(total)}\nБК-Коинов после оплаты: ${order.coinsEarned}`,
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [
                {
                  text: `💳 Оплачен — начислить ${order.coinsEarned} коинов`,
                  callback_data: "paid:" + order.id,
                },
              ],
            ],
          }),
        });
      return json(res, 201, {
        ok: true,
        id: order.id,
        total,
        coinsEarned: order.coinsEarned,
        payment: "stub",
      });
    } catch {
      return json(res, 400, { error: "Некорректный запрос" });
    }
  }
  // Serve only public app assets, never orders, source files or environment secrets.
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    return res.end();
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (pathname === "/") pathname = "/index.html";
  // menu.json is public on purpose: the client can load the catalogue without
  // the API, so the menu works on a static host or while the server restarts.
  const publicFile =
    ["/index.html", "/app.js", "/style.css", "/menu.json"].includes(pathname) ||
    /^\/assets\/[a-zA-Z0-9_./-]+$/.test(pathname) ||
    /^\/IMG_\d+\.(png|jpeg|webp)$/.test(pathname);
  const target = path.resolve(root, "." + pathname);
  if (
    !publicFile ||
    !target.startsWith(root + path.sep) ||
    pathname.split("/").some((part) => part.startsWith("."))
  ) {
    res.writeHead(404);
    return res.end("Not found");
  }
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error("Not a file");
    if (pathname === "/index.html") {
      // Telegram's WebView keeps old app.js/style.css much longer than a
      // browser does, so after an update the Mini App kept running the old
      // cart code. A content hash in the URL forces a fresh copy every time.
      const html = fs
        .readFileSync(target, "utf8")
        .replace(/(src|href)="(app\.js|style\.css)"/g, (m, attr, name) => {
          return `${attr}="${name}?v=${assetHash(name)}"`;
        });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
        ".txt": "text/plain; charset=utf-8",
      }[path.extname(target)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(target);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(process.env.PORT || 3000, "0.0.0.0", () =>
  console.log("Большой Кофе app listening on " + (process.env.PORT || 3000)),
);
