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
const menu = [
  {
    id: "espresso",
    name: "Эспрессо",
    category: "Кофе",
    price: 140,
    image: "IMG_1289.jpeg",
    desc: "Насыщенный и сбалансированный",
  },
  {
    id: "cappuccino",
    name: "Капучино",
    category: "Кофе",
    price: 200,
    image: "IMG_1282.webp",
    desc: "Двойной эспрессо и нежная молочная пена",
  },
  {
    id: "latte",
    name: "Латте",
    category: "Кофе",
    price: 220,
    image: "IMG_1282.webp",
    desc: "Мягкий вкус и шелковистая текстура",
  },
  {
    id: "raf",
    name: "Раф",
    category: "Кофе",
    price: 245,
    image: "IMG_1287.jpeg",
    desc: "Сливочный кофе с ванильной ноткой",
  },
  {
    id: "ice-latte",
    name: "Айс-латте",
    category: "Холодные",
    price: 220,
    image: "IMG_1291.jpeg",
    desc: "Эспрессо, молоко и лёд",
  },
  {
    id: "matcha",
    name: "Матча",
    category: "Холодные",
    price: 220,
    image: "IMG_1293.jpeg",
    desc: "Японский чай с молоком",
  },
  {
    id: "lemonade",
    name: "Лимонад",
    category: "Лимонады",
    price: 180,
    image: "IMG_1290.jpeg",
    desc: "Освежающий напиток собственного приготовления",
  },
  {
    id: "tea",
    name: "Чай ягодный",
    category: "Чай",
    price: 210,
    image: "IMG_1282.webp",
    desc: "Ароматный чай с ягодами",
  },
  {
    id: "cheesecake",
    name: "Чизкейк",
    category: "Десерты",
    price: 260,
    image: "IMG_1288.jpeg",
    desc: "Нежный десерт к любимому кофе",
  },
  {
    id: "croissant",
    name: "Круассан",
    category: "Десерты",
    price: 190,
    image: "IMG_1294.jpeg",
    desc: "Слоёный, хрустящий и свежий",
  },
];
const read = () => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
};
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
          const m = u.message;
          if (m && admins.includes(String(m.chat.id))) {
            if (/^\/(start|orders)/.test(m.text || "")) {
              const orders = read().slice(-8).reverse();
              await telegram("sendMessage", {
                chat_id: m.chat.id,
                text: orders.length
                  ? orders
                      .map(
                        (o) =>
                          `#${o.id} · ${o.status}\n${o.customer.name} · ${o.customer.phone}\n${o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}\n${o.type === "here" ? "В кофейне" : "К выдаче"} · ${o.branch}\n${money(o.total)}`,
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
  if (url.pathname === "/api/health")
    return json(res, 200, { ok: true, payments: "stub" });
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
      const items = b.items
        .map((i) => {
          const p = menu.find((x) => x.id === i.id);
          return p
            ? {
                id: p.id,
                name: p.name,
                price: p.price,
                qty: Math.min(20, Math.max(1, Number(i.qty) || 1)),
              }
            : null;
        })
        .filter(Boolean);
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
        coinsEarned: Math.floor(total * 0.05),
      };
      orders.push(order);
      fs.writeFileSync(file, JSON.stringify(orders, null, 2));
      for (const id of admins)
        telegram("sendMessage", {
          chat_id: id,
          text: `☕ НОВЫЙ ЗАКАЗ #${order.id}\n${order.type === "here" ? "📍 В кофейне" : "🛍 С собой"} · ${order.branch}\n👤 ${order.customer.name} · ${order.customer.phone}\n\n${items.map((i) => `${i.name} × ${i.qty} — ${money(i.price * i.qty)}`).join("\n")}\n\nИтого: ${money(total)}\nНачислить БК-Коинов: ${order.coinsEarned}`,
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
  const publicFile =
    ["/index.html", "/app.js", "/style.css"].includes(pathname) ||
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
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
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
