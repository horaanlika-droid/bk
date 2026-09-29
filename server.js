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
  telegramApiUrl = (process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/+$/, ""),
  admins = (process.env.ADMIN_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
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
// ---------------------------------------------------------------------------
// Team tools (/staff): station-specific stop/go lists, kitchen recipe cards,
// the shift roster and an internal question board. Everything lives in
// data/staff.json (never published over HTTP). Numeric ADMIN_IDS issue team
// accounts and roles in Telegram; the API enforces each role's permissions.
const staffFile = path.join(dataDir, "staff.json");
// Optional emergency access while the bot is not set up yet: login «admin»
// with this password. Empty by default, so production has no shared code.
const staffPin = process.env.STAFF_PIN || "";
const emptyStaff = () => ({
  accounts: [],
  sessions: {},
  stop: [],
  go: [],
  shift: [],
  board: [],
  recipes: {},
});
const readStaff = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(staffFile, "utf8"));
    return { ...emptyStaff(), ...raw };
  } catch {
    return emptyStaff();
  }
};
const writeStaff = (state) =>
  fs.writeFileSync(staffFile, JSON.stringify(state, null, 2));
const today = () => new Date().toISOString().slice(0, 10);
// Passwords are never stored: only scrypt hashes with a per-account salt.
const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), salt, 32).toString("hex");
// Readable one-time password without lookalike characters (0/O, 1/l/I).
const generatePassword = () => {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++)
    out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
};
const staffRoles = [
  "бариста",
  "официант",
  "повар",
  "кухня",
  "бар",
  "касса",
  "старший",
  "управляющий",
  "админ",
];
const allStations = ["Кухня", "Бар"];
const normalizeStaffRole = (role) => {
  const value = String(role || "").trim().toLowerCase();
  if (value === "администратор") return "админ";
  if (value === "шеф-повар" || value === "шефповар") return "повар";
  return value;
};
// Permissions are enforced by the API, not just hidden in the staff page.
// Cooks own the kitchen lists, baristas own the bar lists, and senior staff
// have both. Waiters/cashiers can see both lists but cannot change them.
function staffPermissions(role) {
  const normalized = normalizeStaffRole(role);
  const full = ["старший", "управляющий", "админ"].includes(normalized);
  const ownStation = ["повар", "кухня"].includes(normalized)
    ? "Кухня"
    : ["бариста", "бар"].includes(normalized)
      ? "Бар"
      : "";
  const viewStations = full
    ? allStations
    : ownStation
      ? [ownStation]
      : ["официант", "касса"].includes(normalized)
        ? allStations
        : [];
  return {
    viewStations: [...viewStations],
    manageStations: full ? [...allStations] : ownStation ? [ownStation] : [],
    recipes: full || ["повар", "кухня"].includes(normalized),
    shift: true,
    board: true,
  };
}
const stationForProduct = (product) =>
  product?.category === "Еда" ? "Кухня" : "Бар";
const roleDescription = (role) => {
  const normalized = normalizeStaffRole(role);
  if (["повар", "кухня"].includes(normalized))
    return "стоп- и гоу-листы кухни, технологические карты, смена и вопросы";
  if (["бариста", "бар"].includes(normalized))
    return "стоп- и гоу-листы бара, смена и вопросы";
  if (["официант", "касса"].includes(normalized))
    return "просмотр обоих списков, смена и вопросы";
  if (["старший", "управляющий", "админ"].includes(normalized))
    return "полный доступ к кухне и бару, технологическим картам, смене и вопросам";
  return "только смена и вопросы";
};
// Creates an account and returns the generated password exactly once — the
// admin forwards it to the person, the server keeps only the hash.
function createAccount(state, login, name, role, createdBy) {
  login = String(login || "").toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(login))
    return {
      error:
        "Логин: 3–20 символов, латиница, цифры, точка, дефис. Пример: /adduser anya Аня бариста",
    };
  if (login === "admin" || state.accounts.some((a) => a.login === login))
    return { error: `Логин «${login}» уже занят` };
  const normalizedRole = normalizeStaffRole(role || "бариста");
  if (!staffRoles.includes(normalizedRole))
    return { error: `Неизвестная роль «${role}». Доступные роли: ${staffRoles.join(", ")}` };
  const password = generatePassword();
  const salt = crypto.randomBytes(8).toString("hex");
  state.accounts.push({
    login,
    name: String(name || login).slice(0, 40),
    role: normalizedRole,
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy || ""),
  });
  return { login, password, role: normalizedRole };
}
// Sessions: a random token per device, two months long, pruned on write.
function pruneSessions(state) {
  const now = Date.now();
  for (const [token, s] of Object.entries(state.sessions))
    if (!s || s.exp < now) delete state.sessions[token];
}
function createSession(state, login) {
  pruneSessions(state);
  const token = crypto.randomBytes(24).toString("base64url");
  state.sessions[token] = { login, exp: Date.now() + 60 * 24 * 3600 * 1000 };
  return token;
}
function sessionAccount(state, token) {
  const s = state.sessions[String(token || "")];
  if (!s || s.exp < Date.now()) return null;
  if (s.login === "admin" && staffPin)
    return { login: "admin", name: "Админ", role: "админ" };
  return state.accounts.find((a) => a.login === s.login) || null;
}
// A guessed password must not be free: 10 attempts per login per 10 minutes.
const loginAttempts = {};
function loginAllowed(login) {
  const now = Date.now();
  const entry = loginAttempts[login] || { count: 0, since: now };
  if (now - entry.since > 600000) {
    entry.count = 0;
    entry.since = now;
  }
  loginAttempts[login] = entry;
  return entry.count < 10;
}
// The public state: the shift roster only shows today, the board keeps the
// last 100 notes so the file cannot grow forever. Accounts and sessions never
// leave the server.
function staffState() {
  const state = readStaff();
  let changed =
    state.shift.some((s) => s.date !== today()) || state.board.length > 100;
  state.shift = state.shift.filter((s) => s.date === today());
  state.board = state.board.slice(0, 100);
  if (!state.recipes || typeof state.recipes !== "object" || Array.isArray(state.recipes)) {
    state.recipes = {};
    changed = true;
  }
  if (changed) writeStaff(state);
  return state;
}
const staffPublicState = (state, account) => {
  const permissions = staffPermissions(account?.role);
  return {
    stop: state.stop.filter((entry) => permissions.viewStations.includes(entry.station)),
    go: state.go.filter((entry) => permissions.viewStations.includes(entry.station)),
    shift: state.shift,
    board: state.board,
    menu: menuNames(),
    recipes: permissions.recipes ? state.recipes : {},
    permissions,
  };
};
const stoppedIds = () =>
  new Set(
    readStaff()
      .stop.map((entry) => entry.itemId)
      .filter(Boolean),
  );
// The customer menu carries the stop flag: the card shows «Стоп», the add
// button is off, and orderLine below refuses the item at checkout too.
const publicMenu = () => {
  const stopped = stoppedIds();
  return stopped.size
    ? menu.map((p) => (stopped.has(p.id) ? { ...p, stop: true } : p))
    : menu;
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
          const isStart = /^\/start(?:@\w+)?(?:\s|$)/i.test(String(m?.text || ""));
          const isAdminChat = m && admins.includes(String(m.chat.id));
          if (m && !isAdminChat && m.chat?.type === "private" && isStart) {
            await welcomeGuest(m.chat.id);
            continue;
          }
          if (m && isAdminChat) {
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
            // Team/account commands are intentionally restricted to private
            // chats whose numeric chat id is in ADMIN_IDS; generated passwords
            // must never be exposed in a staff group.
            const team = /^\/(team|adduser|newpass|deluser|setrole|grant|roles)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(
              m.text || "",
            );
            if (team) {
              const command = team[1].toLowerCase();
              const reply = (text) =>
                telegram("sendMessage", { chat_id: m.chat.id, text });
              const state = staffState();
              const args = String(team[2] || "").trim().split(/\s+/).filter(Boolean);
              if (command === "roles") {
                await reply(
                  "Права по ролям:\n" +
                    staffRoles
                      .map((role) => `· ${role} — ${roleDescription(role)}`)
                      .join("\n") +
                    "\n\nПолные команды бота доступны только ID из ADMIN_IDS.",
                );
                continue;
              }
              if (command === "team") {
                await reply(
                  (state.accounts.length
                    ? "👥 Команда:\n" +
                      state.accounts
                        .map(
                          (a) =>
                            `· ${a.login} — ${a.name} (${a.role}) · ${roleDescription(a.role)}`,
                        )
                        .join("\n")
                    : "Аккаунтов пока нет.") +
                    "\n\nКоманды:\n/adduser логин Имя роль — создать аккаунт и назначить права\n/setrole логин роль — изменить роль и права\n/grant логин роль — то же самое\n/newpass логин — новый пароль\n/deluser логин — закрыть доступ\n/roles — описание всех ролей\n\nРоли: " +
                    staffRoles.join(", ") +
                    "\n\nСтраница команды: /staff на адресе приложения — стоп-листы, гоу-листы, техкарты, смена и вопросы.",
                );
                continue;
              }
              if (command === "adduser") {
                const login = args.shift() || "";
                let role = "";
                if (args.length) {
                  const candidate = normalizeStaffRole(args[args.length - 1]);
                  if (staffRoles.includes(candidate)) role = args.pop();
                }
                const made = createAccount(
                  state,
                  login,
                  args.join(" "),
                  role,
                  m.from.username || m.from.id,
                );
                if (made.error) {
                  await reply("⚠️ " + made.error);
                  continue;
                }
                writeStaff(state);
                await reply(
                  `✅ Доступ выдан\nЛогин: ${made.login}\nРоль: ${made.role}\nПрава: ${roleDescription(made.role)}\nПароль: ${made.password}\n\nПерешли данные сотруднику лично. Вход — страница /staff на адресе приложения. Пароль показан один раз: потеряется — /newpass ${made.login}.`,
                );
                continue;
              }
              if (command === "setrole" || command === "grant") {
                const login = String(args[0] || "").toLowerCase();
                const role = normalizeStaffRole(args[1]);
                const account = state.accounts.find((a) => a.login === login);
                if (!login || !staffRoles.includes(role)) {
                  await reply(
                    `Использование: /${command} логин роль\nРоли: ${staffRoles.join(", ")}`,
                  );
                  continue;
                }
                if (!account) {
                  await reply(`Аккаунт «${login}» не найден. Список: /team`);
                  continue;
                }
                account.role = role;
                for (const [t, session] of Object.entries(state.sessions))
                  if (session.login === login) delete state.sessions[t];
                writeStaff(state);
                await reply(
                  `✅ Права обновлены: ${account.name} (${login})\nРоль: ${role}\nПрава: ${roleDescription(role)}\nСотруднику нужно войти заново.`,
                );
                continue;
              }
              const login = String(args[0] || "").toLowerCase();
              const account = state.accounts.find((a) => a.login === login);
              if (!account) {
                await reply(`Аккаунт «${login || "?"}» не найден. Список: /team`);
                continue;
              }
              if (command === "newpass") {
                const password = generatePassword();
                account.salt = crypto.randomBytes(8).toString("hex");
                account.hash = hashPassword(password, account.salt);
                for (const [t, session] of Object.entries(state.sessions))
                  if (session.login === login) delete state.sessions[t];
                writeStaff(state);
                await reply(
                  `🔑 Новый пароль для ${account.name} (${login}): ${password}\nСтарые входы на устройствах сброшены.`,
                );
                continue;
              }
              state.accounts = state.accounts.filter((a) => a.login !== login);
              for (const [t, session] of Object.entries(state.sessions))
                if (session.login === login) delete state.sessions[t];
              writeStaff(state);
              await reply(`🚫 Доступ закрыт: ${account.name} (${login})`);
              continue;
            }
            // The current stop list right in the chat: /stoplist.
            if (/^\/stoplist/.test(m.text || "")) {
              const stop = staffState().stop;
              await telegram("sendMessage", {
                chat_id: m.chat.id,
                text: stop.length
                  ? "🛑 Стоп-лист:\n" +
                    stop
                      .map(
                        (x) =>
                          `· ${x.name} (${x.station.toLowerCase()})${x.by ? " — " + x.by : ""}`,
                      )
                      .join("\n")
                  : "Стоп-лист пуст — всё в продаже",
              });
              continue;
            }
            if (/^\/(start|orders)(?:@\w+)?(?:\s|$)/i.test(m.text || "")) {
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
  if (url.pathname === "/api/menu") return json(res, 200, publicMenu());
  // Team endpoints. Access is personal: /api/staff/login exchanges a login
  // and password issued by the admin in the bot for a session token; every
  // other call carries that token in the X-Staff-Token header. Every change
  // is signed with the account's name automatically.
  if (url.pathname.startsWith("/api/staff")) {
    if (url.pathname === "/api/staff/state" && req.method === "GET") {
      const state = staffState();
      const account = sessionAccount(state, req.headers["x-staff-token"]);
      if (!account)
        return json(res, 401, { error: "Войди со своим логином и паролем" });
      return json(res, 200, {
        ...staffPublicState(state, account),
        me: {
          login: account.login,
          name: account.name,
          role: account.role,
          permissions: staffPermissions(account.role),
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
    if (url.pathname === "/api/staff/login") {
      const login = String(body.login || "")
        .toLowerCase()
        .trim()
        .slice(0, 40);
      const password = String(body.password || "").slice(0, 100);
      if (!login || !password)
        return json(res, 400, { error: "Укажи логин и пароль" });
      if (!loginAllowed(login))
        return json(res, 429, {
          error: "Слишком много попыток — подожди 10 минут",
        });
      const state = staffState();
      const account = state.accounts.find((a) => a.login === login);
      const ok = account
        ? hashPassword(password, account.salt) === account.hash
        : login === "admin" && staffPin && password === staffPin;
      if (!ok) {
        loginAttempts[login].count++;
        return json(res, 403, {
          error: "Неверный логин или пароль. Доступ выдаёт управляющий в боте",
        });
      }
      const token = createSession(state, login);
      writeStaff(state);
      const me = account || { login: "admin", name: "Админ", role: "админ" };
      return json(res, 200, {
        ok: true,
        token,
        me: {
          login: me.login,
          name: me.name,
          role: me.role,
          permissions: staffPermissions(me.role),
        },
      });
    }
    const state = staffState();
    const account = sessionAccount(state, req.headers["x-staff-token"]);
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
    const permissions = staffPermissions(account.role);
    const by = account.name;
    const notifyAdmins = (text) => {
      for (const id of admins) telegram("sendMessage", { chat_id: id, text });
    };
    try {
      if (url.pathname === "/api/staff/stop" || url.pathname === "/api/staff/go") {
        const list = url.pathname.endsWith("stop") ? "stop" : "go";
        const label = list === "stop" ? "Стоп-лист" : "Гоу-лист";
        if (body.action === "remove") {
          const entry = state[list].find((x) => x.id === String(body.id || ""));
          if (!entry) return json(res, 404, { error: "Запись не найдена" });
          if (!permissions.manageStations.includes(entry.station))
            return json(res, 403, { error: "Нет прав менять список этой станции" });
          state[list] = state[list].filter((x) => x !== entry);
          writeStaff(state);
          notifyAdmins(
            `${list === "stop" ? "✅ Снято со стопа" : "🏁 Убрано из гоу-листа"} (${entry.station}): «${entry.name}»${by ? " — " + by : ""}`,
          );
          return json(res, 200, staffPublicState(staffState(), account));
        }
        const station = allStations.includes(body.station) ? body.station : "";
        if (!station) return json(res, 400, { error: "Укажи станцию: Кухня или Бар" });
        if (!permissions.manageStations.includes(station))
          return json(res, 403, { error: "У тебя нет прав на списки этой станции" });
        const itemId = clean(body.itemId, 80);
        const typedName = clean(body.name, 80);
        const product = itemId
          ? menu.find((p) => p.id === itemId)
          : menu.find((p) => p.name.toLowerCase() === typedName.toLowerCase());
        if (itemId && !product)
          return json(res, 400, { error: "Позиция меню не найдена" });
        if (product && stationForProduct(product) !== station)
          return json(res, 400, { error: `«${product.name}» относится к станции «${stationForProduct(product)}»` });
        const name = product ? product.name : typedName;
        if (!name) return json(res, 400, { error: "Укажи позицию" });
        if (
          state[list].some(
            (x) => x.name === name && x.station === station,
          )
        )
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
        return json(res, 200, staffPublicState(staffState(), account));
      }
      if (url.pathname === "/api/staff/recipes") {
        if (!permissions.recipes)
          return json(res, 403, { error: "Технологические карты доступны поварам и администраторам" });
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
          return json(res, 200, staffPublicState(staffState(), account));
        }
        const text = cleanBlock(body.text, 2000);
        if (!text) return json(res, 400, { error: "Добавь алгоритм приготовления" });
        state.recipes[itemId] = { text, by, at: new Date().toISOString() };
        writeStaff(state);
        notifyAdmins(`🧾 Техкарта обновлена: «${product.name}»${by ? " — " + by : ""}`);
        return json(res, 200, staffPublicState(staffState(), account));
      }
      if (url.pathname === "/api/staff/shift") {
        if (!permissions.shift)
          return json(res, 403, { error: "Нет прав на управление сменой" });
        if (body.action === "remove") {
          state.shift = state.shift.filter((x) => x.id !== String(body.id || ""));
          writeStaff(state);
          return json(res, 200, staffPublicState(staffState(), account));
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
        return json(res, 200, staffPublicState(staffState(), account));
      }
      if (url.pathname === "/api/staff/board") {
        if (!permissions.board)
          return json(res, 403, { error: "Нет прав на внутренние вопросы" });
        if (body.action === "remove") {
          state.board = state.board.filter((x) => x.id !== String(body.id || ""));
          writeStaff(state);
          return json(res, 200, staffPublicState(staffState(), account));
        }
        if (body.action === "toggle") {
          const entry = state.board.find((x) => x.id === String(body.id || ""));
          if (!entry) return json(res, 404, { error: "Запись не найдена" });
          entry.done = !entry.done;
          writeStaff(state);
          return json(res, 200, staffPublicState(staffState(), account));
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
        return json(res, 200, staffPublicState(staffState(), account));
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
      const preparation = orderPreparationMessages(order);
      const orderText = `☕ НОВЫЙ ЗАКАЗ #${order.id}\n${order.type === "here" ? "📍 В кофейне" : "🛍 С собой"} · ${order.branch}\n👤 ${order.customer.name} · ${order.customer.phone}\n\n${items.map((i) => `${lineTitle(i)} × ${i.qty} — ${money(i.price * i.qty)}`).join("\n")}\n\nИтого: ${money(total)}\nБК-Коинов после оплаты: ${order.coinsEarned}${preparation.length ? "\n\n👨‍🍳 Алгоритмы действий — следующим сообщением." : ""}`;
      const orderChunks = splitTelegramText(orderText);
      for (const id of admins) {
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
  // the interface; everything on it hides behind the PIN in the staff API.
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
