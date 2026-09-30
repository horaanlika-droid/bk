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
  telegramApiUrl = (process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/+$/, "");
// Telegram only opens Mini Apps from a public HTTPS URL. When configured, the
// bot exposes it both as its blue menu button and as the /start launch button.
const appUrl = (() => {
  try {
    const url = new URL(process.env.APP_URL || "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
})();
// The team page lives next to the app and is opened from the bot, so it needs
// no password: Telegram says who the user is. Outside Telegram the bot prints
// a one-time link instead.
const staffUrl = appUrl ? new URL("/staff", appUrl).toString() : "";
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
let menu = JSON.parse(fs.readFileSync(path.join(root, "menu.json"), "utf8"));
const menuFile = path.join(root, "menu.json");
function writeMenu(newMenu) {
  fs.writeFileSync(menuFile, JSON.stringify(newMenu, null, 2));
  menu = newMenu;
}
// ---------------------------------------------------------------------------
// Admins. The whole access model is a numeric Telegram id: the ids from
// ADMIN_IDS are the owners, everybody else is added by an admin with the
// «➕ Добавить админа» button or /addadmin and is kept in data/admins.json.
// No logins, no passwords, no roles — an admin gets everything: every screen
// of the bot menu and full access to the /staff page.
const adminsFile = path.join(dataDir, "admins.json");
const ownerIds = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const readAdmins = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(adminsFile, "utf8"));
    const list = Array.isArray(raw?.admins) ? raw.admins : [];
    return list
      .filter((a) => a && a.id)
      .map((a) => ({
        id: String(a.id).replace(/\D/g, ""),
        name: String(a.name || "").slice(0, 60),
        username: String(a.username || "").replace(/^@/, "").slice(0, 40),
        addedBy: String(a.addedBy || ""),
        addedAt: String(a.addedAt || ""),
      }))
      .filter((a) => a.id);
  } catch {
    return [];
  }
};
const writeAdmins = (list) =>
  fs.writeFileSync(adminsFile, JSON.stringify({ admins: list }, null, 2));
// Everyone who ever wrote to the bot, newest first. This is how «add @nick»
// resolves a nickname and how the «Добавить админа» screen offers people to
// pick from with one tap. Only the id, the name and the nickname are kept.
const peopleFile = path.join(dataDir, "people.json");
const readPeople = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(peopleFile, "utf8"));
    return Array.isArray(raw?.people) ? raw.people : [];
  } catch {
    return [];
  }
};
const writePeople = (list) =>
  fs.writeFileSync(
    peopleFile,
    JSON.stringify({ people: list.slice(0, 200) }, null, 2),
  );
const personName = (from) =>
  [from?.first_name, from?.last_name].filter(Boolean).join(" ").slice(0, 60);
function rememberPerson(from) {
  if (!from?.id) return;
  const id = String(from.id);
  const people = readPeople().filter((p) => String(p.id) !== id);
  people.unshift({
    id,
    name: personName(from),
    username: String(from.username || "").slice(0, 40),
    seenAt: new Date().toISOString(),
  });
  writePeople(people);
}
const findPerson = (id) => readPeople().find((p) => String(p.id) === String(id));
const findPersonByUsername = (name) => {
  const needle = String(name || "").replace(/^@/, "").toLowerCase();
  return needle
    ? readPeople().find(
        (p) => String(p.username || "").toLowerCase() === needle,
      )
    : null;
};
// Owners first, then the admins added from the bot. Names are filled in from
// the people list, so an id added as a bare number still shows a human name.
function adminList() {
  const byId = new Map();
  const push = (admin) => {
    const person = findPerson(admin.id);
    byId.set(String(admin.id), {
      id: String(admin.id),
      name: admin.name || person?.name || "",
      username: admin.username || person?.username || "",
      owner: !!admin.owner,
      addedBy: admin.addedBy || "",
      addedAt: admin.addedAt || "",
    });
  };
  for (const id of ownerIds) push({ id, owner: true });
  for (const admin of readAdmins()) push(admin);
  return [...byId.values()];
}
const adminIds = () => adminList().map((a) => a.id);
const isAdmin = (id) => adminIds().includes(String(id || "").replace(/\D/g, ""));
const isOwnerAdmin = (id) => ownerIds.includes(String(id || ""));
function addAdmin(id, extra = {}) {
  id = String(id || "").replace(/\D/g, "");
  if (!id) return { error: "Нужен числовой Telegram ID" };
  if (ownerIds.includes(id))
    return { error: "Этот ID уже главный администратор — он задан в ADMIN_IDS" };
  const list = readAdmins();
  const existing = list.find((a) => String(a.id) === id);
  if (existing) {
    existing.name = extra.name || existing.name;
    existing.username = extra.username || existing.username;
    writeAdmins(list);
    return { admin: existing, already: true };
  }
  const admin = {
    id,
    name: String(extra.name || "").slice(0, 60),
    username: String(extra.username || "").replace(/^@/, "").slice(0, 40),
    addedBy: String(extra.addedBy || ""),
    addedAt: new Date().toISOString(),
  };
  list.push(admin);
  writeAdmins(list);
  return { admin };
}
function removeAdmin(id) {
  id = String(id || "").replace(/\D/g, "");
  if (ownerIds.includes(id))
    return {
      error:
        "Главный администратор задан в ADMIN_IDS — уберите его там и перезапустите бота",
    };
  const list = readAdmins();
  const next = list.filter((a) => String(a.id) !== id);
  if (next.length === list.length)
    return { error: "Админ с таким ID не найден" };
  writeAdmins(next);
  return { ok: true };
}
const personLabel = (p) => {
  const parts = [p.name, p.username ? "@" + p.username : ""].filter(Boolean);
  return parts.length ? `${parts.join(" ")} · id ${p.id}` : `id ${p.id}`;
};
// Buttons are narrow: the short form drops the numeric id.
const shortPersonLabel = (p) =>
  [p.name, p.username ? "@" + p.username : ""].filter(Boolean).join(" ") ||
  "id " + p.id;

// ---------------------------------------------------------------------------
// Team tools (/staff): stop/go lists, kitchen recipe cards, the shift roster
// and an internal question board. Everything lives in data/staff.json (never
// published over HTTP). The page has no login form: it is opened from the bot,
// Telegram says who the user is, and every admin gets the full tool set.
const staffFile = path.join(dataDir, "staff.json");
const emptyStaff = () => ({
  stop: [],
  go: [],
  shift: [],
  board: [],
  recipes: {},
  sessions: {},
});
const readStaff = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(staffFile, "utf8"));
    const state = { ...emptyStaff(), ...raw };
    // Sessions from the password era carry a login instead of a Telegram id;
    // they are dead and are dropped as soon as the file is read.
    for (const [key, session] of Object.entries(state.sessions))
      if (!session || typeof session !== "object" || !session.tg)
        delete state.sessions[key];
    return state;
  } catch {
    return emptyStaff();
  }
};
// Sessions are what is left of «accounts»: a random token per device, two
// months long, pruned on every write. Logins, roles and password hashes from
// older versions are dropped the first time the file is written again.
function writeStaff(state) {
  const copy = { ...state };
  delete copy.accounts;
  const now = Date.now();
  copy.sessions = copy.sessions || {};
  for (const [key, session] of Object.entries(copy.sessions))
    if (!session || !session.tg || session.exp < now) delete copy.sessions[key];
  fs.writeFileSync(staffFile, JSON.stringify(copy, null, 2));
}
const staffSessionAccount = (state, value) => {
  const session = state.sessions?.[String(value || "")];
  if (!session?.tg || session.exp < Date.now()) return null;
  return {
    login: "tg:" + session.tg,
    name: session.name || "Админ",
    role: "админ",
  };
};
function createStaffSession(state, tg, name) {
  const value = crypto.randomBytes(24).toString("base64url");
  state.sessions = state.sessions || {};
  state.sessions[value] = {
    tg: String(tg),
    name: String(name || "").slice(0, 60) || "Админ",
    exp: Date.now() + 60 * 24 * 3600 * 1000,
  };
  return value;
}
// A one-time link for a browser outside Telegram: the bot prints a fresh one,
// it works once and stops working in 15 minutes. Kept in memory on purpose —
// a restart simply makes every printed link stale.
const staffLinks = {};
function createStaffLink(by) {
  const now = Date.now();
  for (const [key, link] of Object.entries(staffLinks))
    if (!link || link.exp < now) delete staffLinks[key];
  const key = crypto.randomBytes(12).toString("base64url");
  staffLinks[key] = { exp: now + 15 * 60 * 1000, by: String(by || "") };
  return key;
}
// Telegram signs everything it hands to a Mini App, so the page can prove who
// opened it without a password of its own.
function telegramUserFromInitData(initData) {
  if (!token || !initData) return null;
  const params = new URLSearchParams(String(initData));
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(token)
    .digest();
  const computed = crypto
    .createHmac("sha256", secret)
    .update(pairs.join("\n"))
    .digest("hex");
  if (computed !== hash) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 24 * 3600) return null;
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}
const today = () => new Date().toISOString().slice(0, 10);
const allStations = ["Кухня", "Бар"];
// Every admin has every right: the page no longer splits the kitchen from the
// bar by role.
const fullPermissions = {
  viewStations: [...allStations],
  manageStations: [...allStations],
  recipes: true,
  shift: true,
  board: true,
};
const stationForProduct = (product) =>
  product?.category === "Еда" ? "Кухня" : "Бар";
function staffState() {
  const state = readStaff();
  let changed =
    state.shift.some((s) => s.date !== today()) || state.board.length > 100;
  state.shift = state.shift.filter((s) => s.date === today());
  state.board = state.board.slice(0, 100);
  // Keep legacy free-text entries only when they resolve to a real catalogue
  // item; from now on both lists are strictly tied to menu product ids.
  for (const kind of ["stop", "go"]) {
    const linked = [];
    for (const entry of state[kind]) {
      const product = menu.find((item) => item.id === entry.itemId) ||
        menu.find((item) => item.name.toLocaleLowerCase("ru") === String(entry.name || "").toLocaleLowerCase("ru"));
      if (!product) {
        changed = true;
        continue;
      }
      const normalized = {
        ...entry,
        itemId: product.id,
        name: product.name,
        station: stationForProduct(product),
      };
      if (normalized.itemId !== entry.itemId || normalized.name !== entry.name || normalized.station !== entry.station)
        changed = true;
      if (!linked.some((existing) => existing.itemId === product.id)) linked.push(normalized);
      else changed = true;
    }
    state[kind] = linked;
  }
  if (
    !state.recipes ||
    typeof state.recipes !== "object" ||
    Array.isArray(state.recipes)
  ) {
    state.recipes = {};
    changed = true;
  }
  if (changed) writeStaff(state);
  return state;
}
const staffPublicState = (state) => ({
  stop: state.stop,
  go: state.go,
  shift: state.shift,
  board: state.board,
  menu: menuNames(),
  recipes: state.recipes,
  permissions: fullPermissions,
});
const stoppedIds = () =>
  new Set(
    readStaff()
      .stop.map((entry) => entry.itemId)
      .filter(Boolean),
  );

const goIds = () =>
  new Set(
    readStaff()
      .go.map((entry) => entry.itemId)
      .filter(Boolean),
  );

// The customer menu carries the stop/go flags: stop shows «Стоп» and disables add,
// go shows a highlight. orderLine refuses stopped items at checkout.
const publicMenu = () => {
  const stopped = stoppedIds();
  const go = goIds();
  if (!stopped.size && !go.size) return menu;
  return menu.map((p) => {
    const flags = {};
    if (stopped.has(p.id)) flags.stop = true;
    if (go.has(p.id)) flags.go = true;
    return Object.keys(flags).length ? { ...p, ...flags } : p;
  });
};
// A compact catalogue for the staff page's item picker.
const menuNames = () =>
  menu.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    group: p.group || "",
    station: stationForProduct(p),
  }));
// Validates one cart line against the catalogue and prices it on the server.
function orderLine(input) {
  const p = menu.find((x) => x.id === input?.id);
  if (!p) return null;
  if (stoppedIds().has(p.id))
    throw new Error(`«${p.name}» временно в стоп-листе — выбери другую позицию`);
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
function splitTelegramText(text, limit = 3900) {
  const chunks = [];
  let rest = String(text || "").trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < Math.floor(limit / 2)) cut = rest.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit / 2)) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
function orderPreparationMessages(order) {
  const dishes = order.items.filter((item) =>
    menu.some((product) => product.id === item.id && product.category === "Еда"),
  );
  if (!dishes.length) return [];
  const recipes = readStaff().recipes || {};
  const sections = dishes.map((item) => {
    const recipe = recipes[item.id];
    return `• ${lineTitle(item)} × ${item.qty}\n${
      recipe?.text ||
      "⚠️ Техкарта не заполнена — добавьте её в /staff → «Техкарты»."
    }`;
  });
  const chunks = splitTelegramText(
    `👨‍🍳 Алгоритм действий по блюдам заказа #${order.id}:\n\n${sections.join("\n\n")}`,
  );
  return chunks.map((chunk, index) =>
    index ? `👨‍🍳 Алгоритм действий по заказу #${order.id} (продолжение)\n\n${chunk}` : chunk,
  );
}
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
const plannedCoins = (items) => {
  const drinkItems = items.filter(item => {
    const product = menu.find(p => p.id === item.id);
    return product && product.category !== 'Еда';
  });
  const drinkTotal = drinkItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  return Math.floor(drinkTotal * 0.05);
};
// Coins move only here: the admin taps the button under the order in the bot
// after the customer has actually paid. Nothing in the HTTP API can credit.
function creditCoins(order) {
  const key = coinsKey(order.customer);
  if (!key) return 0;
  const balances = readCoins();
  const amount = plannedCoins(order.items);
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
    const r = await fetch(`${telegramApiUrl}/bot${token}/${method}`, {
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
async function welcomeGuest(chatId) {
  const body = {
    chat_id: chatId,
    text: appUrl
      ? "Добро пожаловать в «Большой Кофе»! ☕\n\nНажмите синюю кнопку «Открыть приложение» ниже, чтобы запустить приложение, посмотреть меню и оформить заказ."
      : "Добро пожаловать в «Большой Кофе»! ☕\n\nЧтобы посмотреть меню и оформить заказ, нажмите синюю кнопку «Открыть приложение» внизу чата и запустите приложение.",
  };
  if (appUrl)
    body.reply_markup = {
      inline_keyboard: [
        [{ text: "Открыть приложение", web_app: { url: appUrl } }],
      ],
    };
  await telegram("sendMessage", body);
}
// ---------------------------------------------------------------------------
// The bot. Guests get the welcome and the app button. Admins get the same
// things as inline buttons: a shift is two taps, nothing is typed from memory,
// and the whole team can be onboarded without a single password.
const recentOrders = (count) => read().slice(-count).reverse();
const formatOrder = (o) =>
  `#${o.id} · ${o.status}${o.credited ? ` · +${o.coinsEarned} коинов` : ""}\n` +
  `${o.customer.name} · ${o.customer.phone}\n` +
  `${o.items.map((i) => `${lineTitle(i)} × ${i.qty}`).join(", ")}\n` +
  `${o.type === "here" ? "В кофейне" : "К выдаче"} · ${o.branch}\n${money(o.total)}`;
const backRow = [{ text: "◀️ В меню", callback_data: "m:main" }];
const notifyAdmins = (text) => {
  for (const id of adminIds())
    telegram("sendMessage", { chat_id: Number(id), text });
};
// A screen is one message: a text and a keyboard. The bot edits the current
// message when it can, so a shift of button presses leaves one clean message
// behind instead of a wall of them.
function screenMain(chatId, userId) {
  const isOwner = isOwnerAdmin(userId);
  return {
    text:
      "☕ Большой Кофе — меню администратора\n\n" +
      "Новые заказы приходят сюда сами. Коины гостю начисляются кнопкой " +
      "«Оплатить» — нажмите её, когда гость рассчитался.\n\nВыберите раздел:",
    keyboard: [
      [
        { text: "📋 Заказы", callback_data: "m:orders" },
        { text: "💳 Оплатить", callback_data: "m:pay" },
      ],
      [
        { text: "🛑 Стоп-лист", callback_data: "m:stop" },
        { text: "🏁 Гоу-лист", callback_data: "m:go" },
      ],
      [
        { text: "👥 Админы", callback_data: "m:admins" },
        { text: "➕ Добавить админа", callback_data: "m:addadmin" },
      ],
      ...(isOwner
        ? [[{ text: "🎵 Техкарты (Рецепты)", callback_data: "m:recipes" }]]
        : []),
      ...(staffUrl
        ? [
            [
              { text: "🛠 Открыть /staff", web_app: { url: staffUrl } },
              { text: "🔑 Ссылка на /staff", callback_data: "m:link" },
            ],
          ]
        : []),
      ...(appUrl
        ? [[{ text: "☕ Открыть приложение", web_app: { url: appUrl } }]]
        : []),
      [{ text: "❓ Помощь", callback_data: "m:help" }],
    ],
  };
}
function screenOrders(chatId, userId) {
  const orders = recentOrders(6);
  return {
    text: orders.length
      ? "📋 Последние заказы:\n\n" + orders.map(formatOrder).join("\n\n")
      : "Заказов пока нет. Как только гость оформит заказ, он появится здесь.",
    keyboard: [
      [{ text: "💳 Отметить оплаченным", callback_data: "m:pay" }],
      backRow,
    ],
  };
}
function screenPay(chatId, userId) {
  const unpaid = read()
    .filter((o) => !o.credited)
    .slice(-8)
    .reverse();
  return {
    text: unpaid.length
      ? "💳 Какой заказ оплачен? Нажмите — гостю начислятся коины."
      : "Неоплаченных заказов нет 🎉",
    keyboard: [
      ...unpaid.map((o) => [
        {
          text: `#${o.id} · ${money(o.total)} · +${o.coinsEarned} коинов`,
          callback_data: "pay:" + o.id,
        },
      ]),
      backRow,
    ],
  };
}
function screenList(kind, chatId, userId) {
  const isStop = kind === "stop";
  const entries = staffState()[kind] || [];
  const lines = entries.map(
    (e) =>
      `· ${e.name} (${String(e.station).toLowerCase()})${e.by ? " — " + e.by : ""}`,
  );
  return {
    text:
      (entries.length
        ? `${isStop ? "🛑 Стоп-лист" : "🏁 Гоу-лист"}:\n${lines.join("\n")}\n\nНажмите на позицию, чтобы ${isStop ? "вернуть её в продажу" : "убрать её из списка"}.`
        : isStop
          ? "Стоп-лист пуст — всё в продаже 👌"
          : "Гоу-лист пуст. Добавьте, что сегодня продаём активнее.") +
      (isStop
        ? "\n\nСтоп-лист сразу убирает позицию из меню у гостей."
        : ""),
    keyboard: [
      ...entries.slice(0, 12).map((e) => [
        {
          text: `${isStop ? "✅" : "➖"} ${e.name}`,
          callback_data: `rm:${kind}:${e.id}`,
        },
      ]),
      [
        {
          text: isStop ? "➕ Добавить в стоп" : "➕ Добавить в гоу-лист",
          callback_data: "new:" + kind,
        },
      ],
      backRow,
    ],
  };
}
function screenAdmins(chatId, userId) {
  const list = adminList();
  return {
    text:
      "👥 Администраторы:\n" +
      list.map((a) => `· ${personLabel(a)}${a.owner ? " · главный" : ""}`).join("\n") +
      "\n\nПрава у всех одинаковые: всё меню бота и полный доступ к странице команды. " +
      "Главный администратор задан в ADMIN_IDS — из бота его не удалить.",
    keyboard: [
      ...list.map((a) => [
        a.owner
          ? { text: "🔒 " + shortPersonLabel(a), callback_data: "owner:" + a.id }
          : { text: "❌ " + shortPersonLabel(a), callback_data: "del:" + a.id },
      ]),
      [{ text: "➕ Добавить админа", callback_data: "m:addadmin" }],
      backRow,
    ],
  };
}
function screenAddAdmin(chatId, userId) {
  const candidates = readPeople().filter((p) => !isAdmin(p.id)).slice(0, 8);
  return {
    text:
      "➕ Добавить админа\n\n" +
      "Нажмите на человека — он станет администратором сразу. Или пришлите его " +
      "Telegram ID или @ник, либо перешлите в бот его сообщение и ответьте на него /addadmin.\n\n" +
      (candidates.length
        ? "Кто писал боту последним:"
        : "Список пуст: попросите человека нажать /start у бота и вернитесь сюда."),
    keyboard: [
      ...candidates.map((p) => [
        { text: "➕ " + shortPersonLabel(p), callback_data: "add:" + p.id },
      ]),
      [{ text: "◀️ К админам", callback_data: "m:admins" }],
    ],
  };
}
function screenHelp(chatId, userId) {
  return {
    text:
      "❓ Помощь\n\n" +
      "Всё делается кнопками: /menu открывает меню администратора.\n\n" +
      "Команды — если так быстрее:\n" +
      "/menu — меню\n" +
      "/orders — последние заказы\n" +
      "/paid НОМЕР — отметить заказ оплаченным\n" +
      "/stoplist — текущий стоп-лист\n" +
      "/admins — список админов\n" +
      "/addadmin ID или @ник — добавить админа\n" +
      "/deladmin ID — убрать админа\n" +
      "/id — ваш Telegram ID\n" +
      "/cancel — отменить начатое действие\n\n" +
      "Страница команды (/staff) открывается кнопкой из меню: стоп-листы, " +
      "гоу-листы, техкарты, смена и вопросы. Паролей нет — вход по Telegram.",
    keyboard: [backRow],
  };
}

// --- Технологические карты (рецепты) в боте -------------------------------
function screenRecipes(chatId, userId) {
  if (!isOwnerAdmin(userId)) {
    return { text: "⛔ Только главный администратор.", keyboard: [backRow] };
  }
  const state = staffState();
  const dishes = (state.menu || []).filter((item) => item.category === "Еда");
  const recipes = state.recipes || {};
  
  if (!dishes.length)
    return {
      text: "🎵 В меню пока нет блюд кухни.",
      keyboard: [[{ text: "◀️ В меню", callback_data: "m:main" }]],
    };
  
  const filled = dishes.filter((item) => recipes[item.id] && recipes[item.id].text).length;
  const lines = dishes.map((item) => {
    const recipe = recipes[item.id];
    const status = recipe && recipe.text ? "✅" : "⬜";
    return `${status} ${item.name} ${item.group ? "· " + item.group : ""}`;
  });
  
  return {
    text:
      `🎵 Техкарты (Рецепты)\\n\\n` +
      `Заполнено: ${filled} из ${dishes.length}\\n\\n` +
      lines.join("\\n") +
      `\\n\\nНажмите на блюдо, чтобы посмотреть/редактировать техкарту.`,
    keyboard: [
      ...dishes.slice(0, 20).map((item) => [
        {
          text: `${recipes[item.id] && recipes[item.id].text ? "✅" : "⬜"} ${item.name} ${item.group ? "· " + item.group : ""}`,
          callback_data: `recipeedit:${item.id}`,
        },
      ]),
      [{ text: "◀️ В меню", callback_data: "m:main" }],
    ],
  };
}

const screens = {
  main: screenMain,
  orders: screenOrders,
  pay: screenPay,
  stop: (chatId, userId) => screenList("stop"),
  go: (chatId, userId) => screenList("go"),
  admins: screenAdmins,
  addadmin: screenAddAdmin,
  recipes: (chatId, userId) => screenRecipes(chatId, userId),
  help: screenHelp,
};
async function showScreen(chatId, name, messageId, userId, itemId) {
  const screen = (screens[name] || screens.main)(chatId, userId, itemId);
  const markup = { inline_keyboard: screen.keyboard };
  const chunks = splitTelegramText(screen.text, 3500);
  if (messageId && chunks.length === 1) {
    const edited = await telegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: chunks[0],
      reply_markup: markup,
      disable_web_page_preview: true,
    });
    // «message is not modified» is normal: the same button was pressed twice.
    if (edited?.ok || /message is not modified/.test(edited?.description || ""))
      return;
  }
  for (let index = 0; index < chunks.length; index++)
    await telegram("sendMessage", {
      chat_id: chatId,
      text: chunks[index],
      disable_web_page_preview: true,
      ...(index === chunks.length - 1 ? { reply_markup: markup } : {}),
    });
}
// A browser outside Telegram has no initData, so the bot prints a single-use
// link for it: open it on the tablet at the counter and the device is signed
// in for two months.
async function sendStaffLink(chatId) {
  if (!staffUrl) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text:
        "Задайте APP_URL — публичный HTTPS-адрес приложения — и в меню появится " +
        "кнопка входа на страницу команды.",
    });
    return;
  }
  const key = createStaffLink(chatId);
  await telegram("sendMessage", {
    chat_id: chatId,
    text:
      "🔑 Ссылка на страницу команды: работает один раз, 15 минут.\n\n" +
      "Откройте её в браузере — например, на планшете у кассы: устройство " +
      "запомнит вход на два месяца.",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🛠 Открыть /staff", url: `${staffUrl}#key=${key}` }],
      ],
    },
  });
}
// Text a screen asks for — a stop-list item, a person's id — is remembered
// here until the admin answers. It is in memory only and expires in 15
// minutes, so a forgotten question can never swallow a later message.
const pending = {};
const setPending = (userId, task) => {
  pending[String(userId)] = { ...task, at: Date.now() };
};
const clearPending = (userId) => {
  delete pending[String(userId)];
};
const takePending = (userId) => {
  const task = pending[String(userId)];
  if (!task) return null;
  if (Date.now() - task.at > 15 * 60 * 1000) {
    clearPending(userId);
    return null;
  }
  return task;
};
const normalizeSearchText = (value) =>
  String(value || "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function searchMenuProducts(query) {
  const normalized = normalizeSearchText(query);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return menu
    .map((product) => {
      const haystack = normalizeSearchText(
        [product.name, product.category, product.group, product.desc].join(" "),
      );
      if (!words.every((word) => haystack.includes(word))) return null;
      const name = normalizeSearchText(product.name);
      const score = (name === normalized ? 1000 : 0) +
        (name.startsWith(normalized) ? 100 : 0) +
        words.reduce((sum, word) => sum + (name.includes(word) ? 10 : 0), 0);
      return { product, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, "ru"))
    .slice(0, 10)
    .map(({ product }) => product);
}
async function showListSearchResults(chatId, userId, task, query) {
  const matches = searchMenuProducts(query);
  setPending(userId, { ...task, step: "search", query });
  await telegram("sendMessage", {
    chat_id: chatId,
    text: matches.length
      ? `Найдено в меню по запросу «${query}». Выберите нужную позицию:`
      : `В меню ничего не найдено по запросу «${query}». Попробуйте другие ключевые слова.`,
    reply_markup: {
      inline_keyboard: [
        ...matches.map((product) => [{
          text: `${product.name} · ${money(product.price)}`,
          callback_data: `pick:${task.kind}:${product.id}`,
        }]),
        [{ text: "Отмена", callback_data: "cancel" }],
      ],
    },
  });
}
async function finishListAdd(chatId, from, task, product) {
  if (!product || !menu.some((item) => item.id === product.id)) {
    clearPending(from.id);
    await telegram("sendMessage", { chat_id: chatId, text: "Позиция больше не найдена в меню." });
    return showScreen(chatId, task.kind, undefined, String(from.id));
  }
  clearPending(from.id);
  const state = staffState();
  const station = stationForProduct(product);
  if (state[task.kind].some((x) => x.itemId === product.id)) {
    await telegram("sendMessage", { chat_id: chatId, text: `«${product.name}» уже в списке` });
    return showScreen(chatId, task.kind, undefined, String(from.id));
  }
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    itemId: product.id,
    name: product.name,
    station,
    note: "",
    by: personName(from) || "админ",
    at: new Date().toISOString(),
  };
  state[task.kind].unshift(entry);
  writeStaff(state);
  notifyAdmins(
    `${task.kind === "stop" ? "🛑 Стоп-лист" : "📣 Гоу-лист"} (${station.toLowerCase()}): «${product.name}» — ${entry.by}`,
  );
  await telegram("sendMessage", {
    chat_id: chatId,
    text: task.kind === "stop" ? `✅ «${product.name}» снято с продажи` : `🏁 «${product.name}» в гоу-листе`,
  });
  await showScreen(chatId, task.kind, undefined, String(from.id));
}
async function handlePendingAnswer(m, task, text) {
  const chatId = m.chat.id;
  const userId = String(m.from.id);
  const name = String(text)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 60);
  
  // --- Recipe Edit Flow (Owner Admin Only) ---
  if (task.kind === "recipeedit") {
    if (!isOwnerAdmin(userId)) {
      clearPending(userId);
      await telegram("sendMessage", { chat_id: chatId, text: "⛔ Только главный администратор." });
      return showScreen(chatId, "main", undefined, userId);
    }
    return handleRecipeEditPending(chatId, userId, task, name);
  }

  if (!name) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Введите ключевые слова для поиска позиции в меню или /cancel.",
    });
    return;
  }
  return showListSearchResults(chatId, userId, task, name);
}

// --- Recipe Edit Pending Handler ---
async function handleRecipeEditPending(chatId, userId, task, input) {
  if (task.step === "text") {
    const cleanBlock = (v) => String(v || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 2000);
    const text = cleanBlock(input);
    const state = staffState();
    if (!state.recipes) state.recipes = {};
    state.recipes[task.itemId] = { text: text, by: personName(m.from) || "админ", at: new Date().toISOString() };
    writeStaff(state);
    notifyAdmins(`🎵 Техкарта обновлена: «${task.itemName}» — ${personName(m.from) || "админ"}`);
    clearPending(userId);
    await telegram("sendMessage", { chat_id: chatId, text: "✅ Технологическая карта сохранена!" });
    return showScreen(chatId, "recipes", undefined, userId);
  }
}
// A new admin: by id, by @nickname, or by replying to / forwarding anything
// the person wrote. Telegram does not resolve nicknames for bots, so «@nick»
// only works once that person has written to the bot at least once.
async function commandAddAdmin(m, text) {
  const chatId = m.chat.id;
  const arg = text.split(/\s+/).slice(1).join(" ").trim();
  const target = m.reply_to_message?.from || m.forward_from || null;
  let id = "";
  let name = "";
  let username = "";
  if (target) {
    id = String(target.id);
    name = personName(target);
    username = target.username || "";
  } else if (/^\d{5,15}$/.test(arg)) {
    id = arg;
    const person = findPerson(id);
    name = person?.name || "";
    username = person?.username || "";
  } else if (/^@?[a-zA-Z0-9_]{4,32}$/.test(arg)) {
    const person = findPersonByUsername(arg);
    if (!person) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          `@${arg.replace(/^@/, "")} ещё не писал этому боту, поэтому я не знаю его ID.\n\n` +
          "Попросите его нажать /start у бота и повторите команду — или " +
          "перешлите сюда его сообщение и ответьте на него /addadmin.",
      });
      return;
    }
    id = person.id;
    name = person.name;
    username = person.username;
  } else {
    await showScreen(chatId, "addadmin", undefined, userId);
    return;
  }
  const result = addAdmin(id, {
    name,
    username,
    addedBy: m.from.username || String(m.from.id),
  });
  if (result.error) {
    await telegram("sendMessage", { chat_id: chatId, text: "⚠️ " + result.error });
    return;
  }
  const label = personLabel({ id, name, username });
  if (result.already) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: `${label} уже администратор.`,
    });
    await showScreen(chatId, "admins", undefined, userId);
    return;
  }
  const sent = await telegram("sendMessage", {
    chat_id: Number(id),
    text:
      "👋 Вас добавили администратором в бот «Большой Кофе».\n\n" +
      "У вас есть всё: заказы, начисление коинов, стоп-листы и страница команды. " +
      "Откройте меню — /menu",
  });
  await telegram("sendMessage", {
    chat_id: chatId,
    text:
      `✅ Админ добавлен: ${label}` +
      (sent?.ok
        ? ""
        : "\n\n⚠️ Написать ему не получилось: как только он сам нажмёт /start у бота, меню откроется."),
  });
  await showScreen(chatId, "admins", undefined, userId);
}
async function handleAdminMessage(m) {
  const chatId = m.chat.id;
  const userId = String(m.from.id);
  const text = String(m.text || "").trim();
  const send = (value) => telegram("sendMessage", { chat_id: chatId, text: value });
  const task = takePending(userId);
  if (task && text && !text.startsWith("/"))
    return handlePendingAnswer(m, task, text);
  if (!text) return;
  if (/^\/cancel(?:@\w+)?(?:\s|$)/i.test(text)) {
    clearPending(userId);
    await send("Отменили.");
    return showScreen(chatId, "main", undefined, userId);
  }
  if (/^\/(id|myid)(?:@\w+)?(?:\s|$)/i.test(text)) {
    await send(
      `Ваш Telegram ID: ${userId}\n\nПередайте его тому, кто добавляет администраторов.`,
    );
    return;
  }
  const paid = /^\/paid\s+(\S+)/.exec(text);
  if (paid) {
    const result = markPaid(paid[1]);
    await send(
      result.error
        ? "⚠️ " + result.error
        : `✅ Заказ #${result.order.id} оплачен · начислено ${result.amount} БК-Коинов`,
    );
    return;
  }
  if (/^\/stoplist(?:@\w+)?(?:\s|$)/i.test(text)) return showScreen(chatId, "stop", undefined, userId);
  if (/^\/orders(?:@\w+)?(?:\s|$)/i.test(text)) return showScreen(chatId, "orders", undefined, userId);
  if (/^\/admins(?:@\w+)?(?:\s|$)/i.test(text)) return showScreen(chatId, "admins", undefined, userId);
  if (/^\/addadmin(?:@\w+)?(?:\s|$)/i.test(text)) return commandAddAdmin(m, text);
  if (/^\/deladmin(?:@\w+)?(?:\s|$)/i.test(text)) {
    const arg = text.split(/\s+/).slice(1).join(" ").trim();
    const target = m.reply_to_message?.from || m.forward_from;
    const id = target
      ? String(target.id)
      : /^@/.test(arg)
        ? findPersonByUsername(arg)?.id || ""
        : arg;
    if (!id) {
      await send(
        "Использование: /deladmin ID — или ответьте этой командой на сообщение человека. Список: /admins",
      );
      return;
    }
    const result = removeAdmin(id);
    await send(result.error ? "⚠️ " + result.error : "🚫 Админ удалён");
    if (!result.error) await showScreen(chatId, "admins", undefined, userId);
    return;
  }
  if (/^\/(menu|start)(?:@\w+)?(?:\s|$)/i.test(text)) return showScreen(chatId, "main", undefined, userId);
  if (/^\/help(?:@\w+)?(?:\s|$)/i.test(text)) return showScreen(chatId, "help", undefined, userId);
  await send("Не понял команду — открываю меню 👇");
  await showScreen(chatId, "main", undefined, userId);
}
async function handleCallback(q) {
  const data = String(q.data || "");
  const chatId = q.message?.chat?.id;
  const messageId = q.message?.message_id;
  const userId = String(q.from?.id || "");
  const answer = (text, alert) =>
    telegram("answerCallbackQuery", {
      callback_query_id: q.id,
      ...(text ? { text, show_alert: !!alert } : {}),
    });
  // The button under the order notification: coins move only here.
  if (/^paid:/.test(data)) {
    if (!isAdmin(userId))
      return answer("Начислять коины может только администратор", true);
    const result = markPaid(data.slice(5));
    await answer(
      result.error
        ? result.error
        : `Начислено ${result.amount} БК-Коинов за заказ #${result.order.id}`,
    );
    if (!result.error && messageId)
      await telegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text:
          (q.message.text || "") +
          `\n\n✅ Оплачен · начислено ${result.amount} БК-Коинов`,
        reply_markup: { inline_keyboard: [] },
      });
    return;
  }
  if (!isAdmin(userId)) return answer("Это меню только для администраторов", true);
  if (/^pay:/.test(data)) {
    const result = markPaid(data.slice(4));
    await answer(
      result.error
        ? result.error
        : `Готово: +${result.amount} коинов по заказу #${result.order.id}`,
    );
    return showScreen(chatId, "pay", messageId, userId);
  }
  if (/^rm:/.test(data)) {
    const [, kind, id] = data.split(":");
    const list = kind === "go" ? "go" : "stop";
    const state = staffState();
    const entry = state[list].find((x) => x.id === id);
    if (!entry) {
      await answer("Позиция уже убрана");
      return showScreen(chatId, list, messageId, userId);
    }
    state[list] = state[list].filter((x) => x.id !== id);
    writeStaff(state);
    notifyAdmins(
      `${list === "stop" ? "✅ Снято со стопа" : "🏁 Убрано из гоу-листа"} (${String(entry.station).toLowerCase()}): «${entry.name}» — ${personName(q.from) || "админ"}`,
    );
    await answer(list === "stop" ? "Вернули в продажу" : "Убрано из списка");
    return showScreen(chatId, list, messageId, userId);
  }
  if (/^new:/.test(data)) {
    const kind = data.slice(4) === "go" ? "go" : "stop";
    setPending(userId, { kind, step: "search" });
    await answer();
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Введите ключевые слова для поиска позиции в существующем меню. Выберите точное совпадение из списка.",
      reply_markup: {
        inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]],
      },
    });
    return;
  }
  if (/^pick:(stop|go):/.test(data)) {
    const [, kind, itemId] = data.split(":");
    const task = takePending(userId);
    if (!task || task.kind !== kind || task.step !== "search") {
      await answer("Начните заново: меню → выберите стоп-лист или гоу-лист");
      return showScreen(chatId, kind, messageId, userId);
    }
    const product = menu.find((item) => item.id === itemId);
    if (!product) {
      await answer("Этой позиции больше нет в меню", true);
      return showScreen(chatId, kind, messageId, userId);
    }
    await answer();
    return finishListAdd(chatId, q.from, task, product);
  }
  if (/^add:/.test(data)) {
    const id = data.slice(4);
    const person = findPerson(id);
    const result = addAdmin(id, {
      name: person?.name,
      username: person?.username,
      addedBy: q.from.username || String(q.from.id),
    });
    await answer(result.error ? result.error : result.already ? "Уже админ" : "Админ добавлен", !!result.error);
    if (!result.error && !result.already)
      await telegram("sendMessage", {
        chat_id: Number(id),
        text:
          "👋 Вас добавили администратором в бот «Большой Кофе».\n\n" +
          "У вас есть всё: заказы, начисление коинов, стоп-листы и страница команды. " +
          "Откройте меню — /menu",
      });
    return showScreen(chatId, "admins", messageId, userId);
  }
  if (/^owner:/.test(data)) {
    await answer(
      "Это главный администратор из ADMIN_IDS — удалить его можно только в настройках хостинга",
      true,
    );
    return;
  }
  if (/^del:/.test(data)) {
    const result = removeAdmin(data.slice(4));
    await answer(result.error ? result.error : "Админ удалён", !!result.error);
    return showScreen(chatId, "admins", messageId, userId);
  }
  if (data === "cancel") {
    clearPending(userId);
    await answer("Отменили");
    return showScreen(chatId, "main", messageId, userId);
  }
  if (data === "m:link") {
    await answer();
    return sendStaffLink(chatId);
  }
  if (/^recipeedit:/.test(data)) {
    if (!isOwnerAdmin(userId))
      return answer("Только главный администратор может редактировать техкарты", true);
    const itemId = data.slice(11);
    const state = staffState();
    const recipes = state.recipes || {};
    const item = (state.menu || []).find((p) => p.id === itemId);
    if (!item) {
      await answer("Блюдо не найдено", true);
      return showScreen(chatId, "recipes", messageId, userId);
    }
    const recipe = recipes[itemId] || {};
    await answer();
    return showScreen(chatId, "recipes", messageId, userId);
  }
  if (/^m:/.test(data)) {
    await answer();
    return showScreen(chatId, data.slice(2), messageId, userId);
  }
  await answer();
}
async function updateBot() {
  if (!token) return;
  let offset = 0;
  while (true) {
    try {
      const r = await fetch(
        `${telegramApiUrl}/bot${token}/getUpdates?offset=${offset}&timeout=25`,
      );
      const j = await r.json();
      if (j.ok) {
        for (const u of j.result || []) {
          offset = u.update_id + 1;
          // One broken update must never stop the bot.
          try {
            if (u.callback_query) {
              await handleCallback(u.callback_query);
              continue;
            }
            const m = u.message;
            if (!m?.from || m.from.is_bot) continue;
            // Whoever writes to the bot becomes pickable in «Добавить админа».
            rememberPerson(m.from);
            if (m.reply_to_message?.from) rememberPerson(m.reply_to_message.from);
            if (m.forward_from) rememberPerson(m.forward_from);
            if (isAdmin(m.from.id)) {
              await handleAdminMessage(m);
              continue;
            }
            if (
              m.chat?.type === "private" &&
              /^\/(start|menu|help)(?:@\w+)?(?:\s|$)/i.test(String(m.text || ""))
            )
              await welcomeGuest(m.chat.id);
          } catch (e) {
            console.error("Update:", e.message);
          }
        }
        if (!j.result?.length) await new Promise((resolve) => setTimeout(resolve, 500));
      } else await new Promise((x) => setTimeout(x, 3000));
    } catch (e) {
      await new Promise((x) => setTimeout(x, 5000));
    }
  }
}
if (token) {
  if (appUrl)
    telegram("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "Открыть приложение",
        web_app: { url: appUrl },
      },
    });
  updateBot();
}
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
  if (url.pathname === "/api/menu" && req.method === "GET") return json(res, 200, publicMenu());

  // Menu management endpoints — only for main admin (owner from ADMIN_IDS)
  if (url.pathname === "/api/menu" && (req.method === "POST" || req.method === "PUT" || req.method === "DELETE")) {
    // Verify owner admin via initData (same as staff page)
    let raw = "";
    for await (const c of req) raw += c;
    let body;
    try {
      if (raw.length > 50000) throw new Error("too big");
      body = JSON.parse(raw || "{}");
    } catch {
      return json(res, 400, { error: "Некорректный запрос" });
    }
    const user = telegramUserFromInitData(String(body.initData || ""));
    if (!user?.id) return json(res, 401, { error: "Не удалось подтвердить Telegram — откройте из бота" });
    if (!isOwnerAdmin(user.id)) return json(res, 403, { error: "Только главный администратор может редактировать меню" });

    if (req.method === "POST") {
      // Create new menu item
      const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
      const cleanBlock = (v, n) => String(v || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, n);

      const item = {
        id: clean(body.id, 80) || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: clean(body.name, 100),
        category: clean(body.category, 40),
        price: Number(body.price) || 0,
        desc: cleanBlock(body.desc, 500),
        group: clean(body.group, 40),
        breads: Array.isArray(body.breads) ? body.breads.map((b) => ({ id: clean(b.id, 40), name: clean(b.name, 40) })).filter((b) => b.id && b.name) : [],
        extras: Array.isArray(body.extras) ? body.extras.map((e) => ({ id: clean(e.id, 60), name: clean(e.name, 60), price: Number(e.price) || 0, group: clean(e.group, 40) })).filter((e) => e.id && e.name) : [],
        art: clean(body.art, 80),
      };

      if (!item.name || !item.category || item.price <= 0) {
        return json(res, 400, { error: "Название, категория и цена обязательны" });
      }
      if (menu.some((p) => p.id === item.id)) {
        return json(res, 409, { error: "Позиция с таким ID уже существует" });
      }

      menu.unshift(item);
      writeMenu(menu);
      notifyAdmins(`📝 Меню: добавлена позиция «${item.name}» (${item.category}) — ${personName(user) || "админ"}`);
      return json(res, 201, { ok: true, item });
    }

    if (req.method === "PUT") {
      // Update existing menu item
      const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
      const cleanBlock = (v, n) => String(v || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, n);

      const itemId = clean(body.id, 80);
      const idx = menu.findIndex((p) => p.id === itemId);
      if (idx === -1) return json(res, 404, { error: "Позиция не найдена" });

      const updated = {
        ...menu[idx],
        name: clean(body.name, 100) || menu[idx].name,
        category: clean(body.category, 40) || menu[idx].category,
        price: typeof body.price === "number" ? body.price : menu[idx].price,
        desc: cleanBlock(body.desc, 500) || menu[idx].desc,
        group: clean(body.group, 40) || menu[idx].group,
        breads: Array.isArray(body.breads) ? body.breads.map((b) => ({ id: clean(b.id, 40), name: clean(b.name, 40) })).filter((b) => b.id && b.name) : menu[idx].breads,
        extras: Array.isArray(body.extras) ? body.extras.map((e) => ({ id: clean(e.id, 60), name: clean(e.name, 60), price: Number(e.price) || 0, group: clean(e.group, 40) })).filter((e) => e.id && e.name) : menu[idx].extras,
        art: clean(body.art, 80) || menu[idx].art,
      };

      menu[idx] = updated;
      writeMenu(menu);
      notifyAdmins(`📝 Меню: обновлена позиция «${updated.name}» — ${personName(user) || "админ"}`);
      return json(res, 200, { ok: true, item: updated });
    }

    if (req.method === "DELETE") {
      const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
      const itemId = clean(body.id, 80);
      const idx = menu.findIndex((p) => p.id === itemId);
      if (idx === -1) return json(res, 404, { error: "Позиция не найдена" });

      const removed = menu[idx];
      menu.splice(idx, 1);
      writeMenu(menu);
      notifyAdmins(`🗑️ Меню: удалена позиция «${removed.name}» — ${personName(user) || "админ"}`);
      return json(res, 200, { ok: true });
    }
  }

  // Team endpoints. There is no login form: the page is opened from the bot,
  // Telegram signs who opened it, and a one-time link covers a plain browser.
  // Everything else carries the session token in the X-Staff-Token header,
  // and every change is signed with the name from that session.
  if (url.pathname.startsWith("/api/staff")) {
    if (url.pathname === "/api/staff/state" && req.method === "GET") {
      const state = staffState();
      const account = staffSessionAccount(state, req.headers["x-staff-token"]);
      if (!account)
        return json(res, 401, {
          error: "Откройте страницу из бота — вход по Telegram",
        });
      return json(res, 200, {
        ...staffPublicState(state),
        me: {
          login: account.login,
          name: account.name,
          role: account.role,
          permissions: fullPermissions,
        },
      });
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      return res.end();
    }
    let raw = "";
    for await (const c of req) raw += c;
    let body;
    try {
      if (raw.length > 20000) throw new Error("too big");
      body = JSON.parse(raw || "{}");
    } catch {
      return json(res, 400, { error: "Некорректный запрос" });
    }
    // The /staff page opened inside Telegram: initData is signed by Telegram
    // with the bot token, so it proves the user without any password.
    if (url.pathname === "/api/staff/telegram") {
      const user = telegramUserFromInitData(String(body.initData || ""));
      if (!user?.id)
        return json(res, 401, {
          error:
            "Не удалось подтвердить Telegram — откройте страницу из бота",
        });
      if (!isAdmin(user.id))
        return json(res, 403, {
          error:
            "Вы не администратор. Доступ выдаёт администратор в боте: меню → «Админы»",
        });
      const state = staffState();
      const value = createStaffSession(state, user.id, personName(user));
      writeStaff(state);
      return json(res, 200, {
        ok: true,
        token: value,
        me: {
          login: "tg:" + user.id,
          name: personName(user) || "Админ",
          role: "админ",
          permissions: fullPermissions,
        },
      });
    }
    // The one-time link the bot prints for a browser outside Telegram.
    if (url.pathname === "/api/staff/key") {
      const key = String(body.key || "").slice(0, 64);
      const link = staffLinks[key];
      if (!link || link.exp < Date.now())
        return json(res, 401, {
          error: "Ссылка устарела — попросите новую в боте: меню → «Ссылка на /staff»",
        });
      delete staffLinks[key];
      const state = staffState();
      const admin = adminList().find((a) => a.id === String(link.by));
      const value = createStaffSession(
        state,
        admin ? admin.id : link.by,
        admin?.name || "Админ",
      );
      writeStaff(state);
      return json(res, 200, {
        ok: true,
        token: value,
        me: {
          login: "tg:" + (admin ? admin.id : link.by),
          name: admin?.name || "Админ",
          role: "админ",
          permissions: fullPermissions,
        },
      });
    }
    const state = staffState();
    const account = staffSessionAccount(state, req.headers["x-staff-token"]);
    if (!account)
      return json(res, 401, { error: "Сессия истекла — войди заново" });
    if (url.pathname === "/api/staff/logout") {
      delete state.sessions[String(req.headers["x-staff-token"])];
      writeStaff(state);
      return json(res, 200, { ok: true });
    }
    const clean = (v, n) =>
      String(v || "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, n);
    const cleanBlock = (v, n) =>
      String(v || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .trim()
        .slice(0, n);
    const by = account.name;
    try {
      if (url.pathname === "/api/staff/stop" || url.pathname === "/api/staff/go") {
        const list = url.pathname.endsWith("stop") ? "stop" : "go";
        const label = list === "stop" ? "Стоп-лист" : "Гоу-лист";
        if (body.action === "remove") {
          const entry = state[list].find((x) => x.id === String(body.id || ""));
          if (!entry) return json(res, 404, { error: "Запись не найдена" });
          state[list] = state[list].filter((x) => x !== entry);
          writeStaff(state);
          notifyAdmins(
            `${list === "stop" ? "✅ Снято со стопа" : "🏁 Убрано из гоу-листа"} (${entry.station}): «${entry.name}»${by ? " — " + by : ""}`,
          );
          return json(res, 200, staffPublicState(staffState()));
        }
        const itemId = clean(body.itemId, 80);
        const typedName = clean(body.name, 80);
        const product = itemId
          ? menu.find((p) => p.id === itemId)
          : menu.find((p) => p.name.toLocaleLowerCase("ru") === typedName.toLocaleLowerCase("ru"));
        if (!product)
          return json(res, 400, { error: "Выбери позицию из меню по ключевым словам" });
        const station = stationForProduct(product);
        if (body.station && allStations.includes(body.station) && body.station !== station)
          return json(res, 400, { error: `«${product.name}» относится к станции «${station}»` });
        const name = product.name;
        if (state[list].some((x) => x.itemId === product.id))
          return json(res, 409, { error: `«${name}» уже в списке` });
        state[list].unshift({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          itemId: product ? product.id : "",
          name,
          station,
          note: clean(body.note, 120),
          by,
          at: new Date().toISOString(),
        });
        writeStaff(state);
        notifyAdmins(
          `${list === "stop" ? "🛑" : "📣"} ${label} (${station.toLowerCase()}): «${name}»${by ? " — " + by : ""}`,
        );
        return json(res, 200, staffPublicState(staffState()));
      }
      if (url.pathname === "/api/staff/recipes") {
        const itemId = clean(body.itemId, 80);
        const product = menu.find((p) => p.id === itemId && p.category === "Еда");
        if (!product)
          return json(res, 400, { error: "Выбери блюдо из меню кухни" });
        if (body.action === "remove") {
          if (!state.recipes[itemId])
            return json(res, 404, { error: "Технологическая карта не найдена" });
          delete state.recipes[itemId];
          writeStaff(state);
          notifyAdmins(`🧾 Техкарта удалена: «${product.name}»${by ? " — " + by : ""}`);
          return json(res, 200, staffPublicState(staffState()));
        }
        const text = cleanBlock(body.text, 2000);
        if (!text) return json(res, 400, { error: "Добавь алгоритм приготовления" });
        state.recipes[itemId] = { text, by, at: new Date().toISOString() };
        writeStaff(state);
        notifyAdmins(`🧾 Техкарта обновлена: «${product.name}»${by ? " — " + by : ""}`);
        return json(res, 200, staffPublicState(staffState()));
      }
      if (url.pathname === "/api/staff/shift") {
        if (body.action === "remove") {
          state.shift = state.shift.filter((x) => x.id !== String(body.id || ""));
          writeStaff(state);
          return json(res, 200, staffPublicState(staffState()));
        }
        const name = clean(body.name, 60);
        if (!name) return json(res, 400, { error: "Укажи имя" });
        const role = ["Кухня", "Бар", "Касса"].includes(body.role)
          ? body.role
          : "Бар";
        if (state.shift.some((x) => x.name === name && x.date === today()))
          return json(res, 409, { error: `${name} уже отмечен(а) на смене` });
        state.shift.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          role,
          date: today(),
          at: new Date().toISOString(),
        });
        writeStaff(state);
        return json(res, 200, staffPublicState(staffState()));
      }
      if (url.pathname === "/api/staff/board") {
        if (body.action === "remove") {
          state.board = state.board.filter((x) => x.id !== String(body.id || ""));
          writeStaff(state);
          return json(res, 200, staffPublicState(staffState()));
        }
        if (body.action === "toggle") {
          const entry = state.board.find((x) => x.id === String(body.id || ""));
          if (!entry) return json(res, 404, { error: "Запись не найдена" });
          entry.done = !entry.done;
          writeStaff(state);
          return json(res, 200, staffPublicState(staffState()));
        }
        const text = clean(body.text, 500);
        if (!text) return json(res, 400, { error: "Пустое сообщение" });
        state.board.unshift({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          text,
          by,
          at: new Date().toISOString(),
          done: false,
        });
        writeStaff(state);
        return json(res, 200, staffPublicState(staffState()));
      }
    } catch (e) {
      return json(res, 400, { error: "Некорректный запрос" });
    }
    res.writeHead(404);
    return res.end();
  }
  if (url.pathname === "/api/coins" && req.method === "GET") {
    const phone = String(url.searchParams.get("phone") || "").replace(/\D/g, "");
    const uid = String(url.searchParams.get("uid") || "").replace(/\D/g, "");
    const key = phone ? "phone:" + phone : uid ? "tg:" + uid : "";
    if (!key) return json(res, 200, { coins: 0, pending: 0 });
    const entry = readCoins()[key] || { coins: 0 };
    const pending = read()
      .filter((o) => !o.credited && coinsKey(o.customer) === key)
      .reduce((s, o) => s + plannedCoins(o.items), 0);
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
      for (const id of adminIds())
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
        coinsEarned: plannedCoins(items),
        credited: false,
      };
      orders.push(order);
      fs.writeFileSync(file, JSON.stringify(orders, null, 2));
      const preparation = orderPreparationMessages(order);
      const orderText = `☕ НОВЫЙ ЗАКАЗ #${order.id}\n${order.type === "here" ? "📍 В кофейне" : "🛍 С собой"} · ${order.branch}\n👤 ${order.customer.name} · ${order.customer.phone}\n\n${items.map((i) => `${lineTitle(i)} × ${i.qty} — ${money(i.price * i.qty)}`).join("\n")}\n\nИтого: ${money(total)}\nБК-Коинов после оплаты: ${order.coinsEarned}${preparation.length ? "\n\n👨‍🍳 Алгоритмы действий — следующим сообщением." : ""}`;
      const orderChunks = splitTelegramText(orderText);
      for (const id of adminIds()) {
        (async () => {
          for (let index = 0; index < orderChunks.length; index++) {
            await telegram("sendMessage", {
              chat_id: id,
              text:
                (index ? `☕ Детали заказа #${order.id} (продолжение)\n\n` : "") +
                orderChunks[index],
              ...(index === 0
                ? {
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
                  }
                : {}),
            });
          }
          for (const text of preparation)
            await telegram("sendMessage", { chat_id: id, text });
        })();
      }
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
  // The team page lives at /staff. The page itself is public like the rest of
  // the interface; everything on it hides behind the staff API, which only
  // lets confirmed admins in.
  if (pathname === "/staff") pathname = "/staff.html";
  // menu.json is public on purpose: the client can load the catalogue without
  // the API, so the menu works on a static host or while the server restarts.
  const publicFile =
    [
      "/index.html",
      "/app.js",
      "/style.css",
      "/menu.json",
      "/staff.html",
      "/staff.js",
      "/staff.css",
    ].includes(pathname) ||
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
const port = process.env.PORT || 3001;
server.listen(port, "0.0.0.0", () =>
  console.log("Большой Кофе app listening on " + port),
);
