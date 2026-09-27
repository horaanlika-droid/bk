const $ = (s) => document.querySelector(s);
// Inside Telegram the SDK is present, but window.Telegram.WebApp also exists
// in a regular browser — only initData tells that we really run in the client.
const tg = window.Telegram?.WebApp;
const inTelegram = !!tg?.initData;
// Each Telegram call is guarded: an old client must not take the app down.
const tgCall = (fn) => {
  try {
    fn();
  } catch (err) {
    console.warn("Telegram:", err);
  }
};
if (tg) {
  tgCall(() => tg.ready());
  tgCall(() => tg.expand());
  // Bot API 7.7+: otherwise a downward swipe while scrolling the sandwich
  // builder or the cart collapses the whole Mini App instead of the sheet.
  if (tg.isVersionAtLeast?.("7.7"))
    tgCall(() => tg.disableVerticalSwipes());
}
// The WebView is often taller than the part of the screen the user actually
// sees: Telegram does not always report a viewport matching the window, iOS
// keeps the layout viewport under the browser toolbar and the on-screen
// keyboard, and 100dvh is a guess at best. That is how the bottom sheet and
// its «Добавить» / «Оформить заказ» / «Всё понятно» buttons ended up below the
// visible area — food, cart and coin info looked broken while short sheets
// worked. So every available height is measured, the SMALLEST one wins and the
// measurement repeats on every event that can change it. The sheet geometry
// then follows --app-height, whatever the device reports.
function viewportHeights() {
  const list = [];
  const vv = window.visualViewport;
  if (vv && Number(vv.height) > 0) list.push(Number(vv.height));
  if (Number(window.innerHeight) > 0) list.push(Number(window.innerHeight));
  if (Number(document.documentElement.clientHeight) > 0)
    list.push(Number(document.documentElement.clientHeight));
  if (inTelegram) {
    const h = Number(tg.viewportStableHeight || tg.viewportHeight);
    if (h > 0) list.push(h);
  }
  return list;
}
function measureViewport() {
  const list = viewportHeights();
  if (!list.length) return;
  const visible = Math.round(Math.min.apply(null, list));
  const root = document.documentElement;
  root.style.setProperty("--app-height", visible + "px");
  // iOS moves the visual viewport (toolbar, keyboard, page scroll): the sheet
  // has to follow that rectangle, not the layout viewport.
  const vv = window.visualViewport;
  const top = vv && Number(vv.offsetTop) > 0 ? Math.round(Number(vv.offsetTop)) : 0;
  root.style.setProperty("--vv-top", top + "px");
  return visible;
}
const syncViewport = measureViewport;
measureViewport();
["resize", "orientationchange"].forEach((name) =>
  window.addEventListener(name, () => measureViewport()),
);
// visualViewport is missing in old WebViews; a failure here must not stop the app.
try {
  window.visualViewport?.addEventListener("resize", measureViewport);
  window.visualViewport?.addEventListener("scroll", measureViewport);
} catch (err) {
  console.warn("visualViewport:", err);
}
if (inTelegram) tgCall(() => tg.onEvent("viewportChanged", measureViewport));
// Storage may be unavailable: private mode, blocked cookies or the Telegram
// WebView can throw on read and on write. The app must keep working anyway —
// a failed save never blocks adding to the cart.
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  getJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};
let storageBroken = false;
let profile = store.getJSON("bk-profile", {}),
  cart = store.getJSON("bk-cart", {});
let branch = store.get("bk-branch") || "Волжский";
let selected = "Всё",
  search = "",
  type = "pickup",
  menu = [],
  menuSource = "",
  loading = true,
  loadError = false,
  submitting = false;
let page = "home",
  profileEditing = false,
  returnFocus;
const tgUser = tg?.initDataUnsafe?.user;
if (tgUser) {
  // Plain assignment, not logical assignment: it breaks the whole script in
  // older Telegram WebViews (iOS < 14, Android WebView < 85).
  if (!profile.name)
    profile.name = [tgUser.first_name, tgUser.last_name]
      .filter(Boolean)
      .join(" ");
  profile.telegramId = String(tgUser.id);
}
// The version at the bottom of the profile names this exact build: the same
// content hash the server puts into app.js?v=…, so a screenshot of the profile
// says which code the Mini App is actually running right now.
const APP_VERSION = "2026.09.27";
// The script tag is found by its file name, not by a substring: the Telegram
// SDK lives at «…/telegram-web-app.js», which also contains «app.js» and was
// matched first — the profile then showed «dev» instead of the real build hash.
const buildHash = (() => {
  try {
    const tags = document.querySelectorAll("script[src]");
    for (const tag of tags) {
      const url = new URL(tag.getAttribute("src"), location.href);
      if (/(^|\/)app\.js$/.test(url.pathname))
        return (url.searchParams.get("v") || "dev").slice(0, 10);
    }
    return "dev";
  } catch {
    return "dev";
  }
})();
// The last failures stay on the device, not only in the console: «Профиль →
// Диагностика» lists them, so a screenshot is enough to see what really broke
// inside a Telegram WebView where no developer tools are available.
const errorLog = (() => {
  const cached = store.getJSON("bk-errors", []);
  return Array.isArray(cached) ? cached.slice(-5) : [];
})();
function logError(where, message) {
  errorLog.push({
    at: new Date().toISOString().slice(11, 19),
    where: String(where).slice(0, 60),
    message: String(message).slice(0, 200),
  });
  while (errorLog.length > 5) errorLog.shift();
  store.set("bk-errors", JSON.stringify(errorLog));
}
// Unexpected failures must stay visible: the toast shows the exact error text
// in parentheses, and the same text goes to the admins' bot as
// «⚠️ Ошибка в приложении» — the fastest way to see what broke in Telegram.
function reportError(where, err) {
  const message = String((err && err.message) || err || "Неизвестная ошибка")
    .replace(/\s+/g, " ")
    .slice(0, 300);
  logError(where, message);
  try {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        where: String(where).slice(0, 80),
        page: location.hash.slice(1) || "home",
        version: APP_VERSION + " · " + buildHash,
      }),
    }).catch(() => {});
  } catch {}
  return message;
}
function fail(where, err, prefix) {
  const message = reportError(where, err);
  // Longer than a regular toast: the text has to be readable long enough to be
  // screenshotted, that is the whole point of showing it.
  toast(`${prefix} (${message.slice(0, 140)}) · Профиль → Диагностика`, 9000);
  return message;
}
// «The same errors came back after the fix» almost always means the WebView is
// still running an old app.js from its cache, not that the fix failed. The
// running build knows its own hash; the server names the current one. If they
// differ, the page reloads itself once with a cache-busting URL — and if even
// that does not help, the profile has a manual «Обновить приложение».
let serverInfo = null,
  updateState = "unknown"; // unknown | current | stale | offline
const RELOADED_KEY = "bk-reloaded-for";
async function checkVersion(manual = false) {
  let info;
  try {
    const response = await fetch("/api/version?t=" + Date.now(), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    info = await response.json();
  } catch (err) {
    updateState = "offline";
    if (manual)
      toast("Проверить версию не вышло: " + reportError("version", err), 9000);
    return updateState;
  }
  serverInfo = info;
  const latest = String(info.hash || "");
  // «dev» means the file was served without ?v=… (another host, a stripped
  // query): there is nothing to compare, so nothing is reloaded.
  if (buildHash === "dev") {
    updateState = "unknown";
    if (manual) toast("Версия без хеша — сравнить нельзя. Обновить принудительно?", 8000);
    return updateState;
  }
  updateState = latest && latest !== buildHash ? "stale" : "current";
  if (updateState === "current") {
    if (manual) toast("Установлена последняя версия · " + buildHash);
    return updateState;
  }
  // Two independent guards against a reload loop: the attempt is remembered on
  // the device, and the cache-busting parameter stays in the address. Without
  // them a WebView with blocked storage and a stale file would reload forever.
  const previous = store.get(RELOADED_KEY);
  const stored = store.set(RELOADED_KEY, latest);
  const tried = /(^|[?&])build=/.test(location.search);
  if (!stored || previous === latest || tried) {
    if (manual)
      toast(
        "Хостинг отдаёт старую версию · работает " + buildHash + ", на сервере " + latest,
        9000,
      );
    return updateState;
  }
  toast("Обновляем приложение до последней версии…", 4000);
  setTimeout(forceReload, 900);
  return updateState;
}
// A unique query makes every cache (CDN, WebView, service worker) fetch a fresh
// index.html, and that fresh page carries the new app.js?v=… hash.
function forceReload() {
  location.replace(
    location.pathname + "?build=" + Date.now() + (location.hash || ""),
  );
}
const money = (n) => new Intl.NumberFormat("ru-RU").format(n) + " ₽";
const safe = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// The balance is kept on the server: only the coffee shop admin credits coins,
// and only after the order is actually paid. localStorage is just a display
// cache so the number survives a reload without a round trip.
let coinBalance = Math.max(0, Number(store.get("bk-coins")) || 0),
  coinPending = 0;
const coins = () => coinBalance;
async function loadCoins() {
  const phone = profile.phone ? "phone=" + encodeURIComponent(profile.phone) : "";
  const uid =
    !phone && profile.telegramId
      ? "uid=" + encodeURIComponent(profile.telegramId)
      : "";
  const query = phone || uid;
  if (!query) {
    coinBalance = 0;
    coinPending = 0;
    return;
  }
  try {
    const r = await fetch("/api/coins?" + query);
    if (!r.ok) throw new Error();
    const d = await r.json();
    coinBalance = Math.max(0, Number(d.coins) || 0);
    coinPending = Math.max(0, Number(d.pending) || 0);
    store.set("bk-coins", String(coinBalance));
    if (page === "home" || page === "coins" || page === "profile") render();
  } catch {
    // Offline: the cached balance stays on screen, nothing breaks.
  }
}
const paths = {
  home: '<path d="m3 10 9-7 9 7v10H15v-7H9v7H3z"/>',
  cup: '<path d="M5 7h12v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM17 8h2a3 3 0 0 1 0 6h-2M8 3v1m4-1v1M3 22h16"/>',
  bag: '<path d="M5 7h14l1 14H4zM9 8V6a3 3 0 0 1 6 0v2"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  chair: '<path d="M6 12V4h12v8M4 12h16v5H4zm2 5-1 5m13-5 1 5M2 9v5m20-5v5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  bean: '<ellipse cx="12" cy="12" rx="7" ry="10" transform="rotate(35 12 12)"/><path d="M16 4c-8 5 0 10-8 16"/>',
  gift: '<path d="M4 10h16v11H4zM2 6h20v4H2zm10 0v15M12 6C3 7 5-2 10 3zm0 0c9 1 7-8 2-3z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cup}</svg>`;
const coin = (cls = "") =>
  `<span class="coin ${cls}" aria-hidden="true"><img src="assets/coin-mark.png" alt=""></span>`;
function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
// Drinks use temporary hand-drawn cups with the brand mark (assets/drinks,
// built by scripts/build_drinks.py) until professional photos are ready.
// Food is intentionally shown without pictures for now.
const hasArt = (p) => p.category !== "Еда";
const isSandwich = (p) => Array.isArray(p.breads) && p.breads.length > 0;
const hasBreadChoice = (p) => isSandwich(p) && p.breads.length > 1;
const breadPaths = {
  лепешка:
    '<path d="M3 18a9 9 0 0 1 18 0Z"/><path d="M6.2 11.6c1-.9 2 .9 3 0s2 .9 3 0 2 .9 3 0 1.6.6 2.6.2"/><path d="M9 15h1.5m3 0H15"/>',
  хлеб: '<path d="M12 4 3 19h18Z"/><path d="M12 9.2 7.2 17h9.6Z"/>',
  булочка:
    '<path d="M4 10.5a8 6 0 0 1 16 0Z"/><path d="M3 13.5h18"/><path d="M4 16.5h16a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/><path d="M10 7.5h.01M13 6.8h.01"/>',
};
const breadShort = { лепешка: "Лепёшка", хлеб: "Хлеб", булочка: "Булочка" };
const breadIcon = (id) =>
  `<svg class="bread-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${breadPaths[id] || breadPaths.хлеб}</svg>`;
function productArt(p) {
  if (p.art)
    return `<img class="drink-art" src="assets/drinks/${encodeURIComponent(p.art)}.webp" alt="${safe(p.name)} — рисунок" loading="lazy">`;
  return `<div class="product-placeholder" role="img" aria-label="${safe(p.name)}"><img src="assets/logo.png" alt=""></div>`;
}
function breadTags(p) {
  if (!isSandwich(p)) return "";
  if (!hasBreadChoice(p))
    return `<div class="bread-tags single">${breadIcon(p.breads[0].id)}<span>Только ${safe(p.breads[0].name.toLowerCase())}</span></div>`;
  return `<div class="bread-tags" aria-label="На выбор: ${p.breads.map((b) => safe(b.name.toLowerCase())).join(", ")}">${p.breads.map((b) => `<span>${breadIcon(b.id)}${breadShort[b.id] || safe(b.name)}</span>`).join("")}</div>`;
}
function foodCard(p) {
  const action = isSandwich(p) ? "Собрать" : "Добавить";
  return `<article class="product compact food-card"><div class="product-info"><button class="product-name" data-detail="${p.id}">${safe(p.name)}</button>${p.desc ? `<p>${safe(p.desc)}</p>` : ""}${breadTags(p)}<div class="product-bottom"><strong>${money(p.price)}</strong><button class="add-button" data-add="${p.id}" aria-label="${action}: ${safe(p.name)}">${icon("plus")}</button></div></div></article>`;
}
function productCard(p, compact = false) {
  if (!hasArt(p)) return foodCard(p);
  return `<article class="product ${compact ? "compact" : ""}"><button class="product-image ${p.art ? "art-tile" : ""}" data-detail="${p.id}" aria-label="Подробнее: ${safe(p.name)}">${productArt(p)}${p.id === "большой-латте" ? '<span class="hit">ХИТ</span>' : ""}</button><div class="product-info"><button class="product-name" data-detail="${p.id}">${safe(p.name)}</button><p>${safe(p.desc)}</p><div class="product-bottom"><strong>${money(p.price)}</strong><button class="add-button" data-add="${p.id}" aria-label="Добавить ${safe(p.name)}">${icon("plus")}</button></div></div></article>`;
}
function statusMarkup() {
  return loading
    ? '<div class="empty loading">Загружаем меню…</div>'
    : loadError
      ? '<div class="empty">Не получилось загрузить меню.<button class="secondary" data-action="retry">Попробовать ещё раз</button></div>'
      : "";
}
function homePage() {
  const popular = ["большой-латте", "cappuccino", "большой-раф", "ice-latte"]
    .map((id) => menu.find((p) => p.id === id))
    .filter(Boolean);
  return `<section class="welcome"><div><span class="eyebrow">ТВОЯ ЕЖЕДНЕВНАЯ ПАУЗА</span><h1>Как насчёт кофе?</h1></div><span class="welcome-note">Знакомый вкус.<br>Всегда рядом.</span></section>
  <div class="home-top"><a class="coin-banner" href="#coins"><div class="banner-copy"><span class="eyebrow">БОЛЬШЕ КОФЕ — БОЛЬШЕ ПРИЯТНОГО</span><h2>БК-Коины</h2><p>Твой кофе возвращается.<br>Копи 5% с каждого оплаченного заказа.</p><span class="banner-balance">${coins()} <span>коинов на счёте</span>${icon("arrow")}</span></div><div class="coin-scene">${coin("coin-back")}${coin("coin-main")}<span class="coin-spark spark-one"></span><span class="coin-spark spark-two"></span></div></a>
  <div class="order-options"><button class="order-option" data-order="pickup">${icon("cup")}<span class="option-arrow">${icon("arrow")}</span><h3>Заказать<br>с собой</h3><p>Забери свой кофе<br>по пути</p></button><button class="order-option" data-order="here">${icon("chair")}<span class="option-arrow">${icon("arrow")}</span><h3>Я уже<br>в кофейне</h3><p>Выбирай любимое.<br>Мы приготовим.</p></button></div></div>
  <section class="popular-section"><div class="section-heading"><h2>Любимые, и не зря</h2><a class="text-link" href="#menu">Всё меню ${icon("arrow")}</a></div><div class="popular-grid">${statusMarkup() || popular.map((p) => productCard(p)).join("")}</div></section>
  <section class="cafe-card"><div class="cafe-copy"><span class="eyebrow">МЕСТО ДЛЯ ТВОИХ МАЛЕНЬКИХ ПАУЗ</span><h2>Большой кофе.<br>И чуть больше тепла.</h2><p>Встретиться с друзьями, побыть наедине с собой<br class="desktop-only"> или просто забежать за любимым.</p><button class="secondary" data-action="location">${icon("pin")}<span>${safe(branch)}</span>${icon("arrow")}</button></div><img src="assets/cafe.webp" alt="Фасад кофейни Большой Кофе" loading="lazy"><span class="cafe-caption">ХОРОШИЙ КОФЕ. КАЖДЫЙ ДЕНЬ.</span></section>`;
}
const cats = ["Всё", "Кофе", "Чай", "Напитки", "Еда", "Десерты"];
function menuPage() {
  return `<section class="menu-page"><div class="page-heading"><div><span class="eyebrow">ВЫБИРАЙ СВОЁ ЛЮБИМОЕ</span><h1>Меню</h1></div><span class="order-mode">${icon(type === "here" ? "chair" : "bag")}${type === "here" ? "В кофейне" : "С собой"}</span></div><label class="search-field">${icon("search")}<input id="search" type="search" placeholder="Найти свой напиток" value="${safe(search)}" aria-label="Поиск по меню"></label><nav class="categories" aria-label="Категории">${cats.map((c) => `<button data-cat="${c}" class="${selected === c ? "selected" : ""}" aria-pressed="${selected === c}">${c}</button>`).join("")}</nav><div id="menuResults">${menuResults()}</div></section>`;
}
function menuResults() {
  if (loading || loadError) return statusMarkup();
  const list = menu.filter(
    (p) =>
      (selected === "Всё" || p.category === selected) &&
      (p.name + " " + p.desc).toLowerCase().includes(search.toLowerCase()),
  );
  if (!list.length)
    return '<div class="empty">Ничего не нашли. Попробуй другой запрос или категорию.</div>';
  const grid = (items) =>
    `<div class="menu-grid">${items.map((p) => productCard(p, true)).join("")}</div>`;
  return cats
    .slice(1)
    .map((c) => {
      const group = list.filter((p) => p.category === c);
      if (!group.length) return "";
      if (c !== "Еда")
        return `<section class="menu-group"><h2>${c}</h2>${grid(group)}</section>`;
      // Food follows the paper menu: sandwiches with a bread choice, the ones
      // made only in flatbread, then nuggets and sauces.
      const parts = [
        {
          title: "Сэндвичи на твой выбор",
          note: "Готовим в лепёшке, хлебе или булочке — выберешь при добавлении",
          items: group.filter(hasBreadChoice),
        },
        {
          title: "Готовятся в лепёшке",
          items: group.filter((p) => isSandwich(p) && !hasBreadChoice(p)),
        },
        { title: "Наггетсы", items: group.filter((p) => p.group === "Наггетсы") },
        { title: "Соусы", items: group.filter((p) => p.group === "Соусы") },
      ];
      return `<section class="menu-group food-group"><h2>${c}</h2>${parts
        .filter((part) => part.items.length)
        .map(
          (part) =>
            `<div class="food-part"><h3>${part.title}</h3>${part.note ? `<p class="food-note">${part.note}</p>` : ""}${grid(part.items)}</div>`,
        )
        .join("")}</section>`;
    })
    .join("");
}
function coinsPage() {
  return `<section class="coins-page"><div class="coins-dark"><span class="eyebrow">ПРИЯТНО БЫТЬ СВОИМ</span><h1>БК-Коины</h1><div class="coin-balance">${coin()}<div><strong>${coins()}</strong><span>БК-Коинов</span><small>1 БК-Коин = 1 ₽</small></div></div><div class="yellow-note"><b>Твой следующий кофе<br>становится ближе.</b><p>Начисляем 5% от суммы каждого оплаченного заказа.${coinPending ? " Ещё " + coinPending + " коинов начислим после оплаты твоих заказов." : ""}</p>${icon("arrow")}</div><h2>Как это работает</h2><ol class="loyalty-steps"><li><span>${icon("cup")}</span><div><b>Выбирай любимое</b><p>Оформи заказ в приложении.</p></div></li><li><span>${coin()}</span><div><b>Получай БК-Коины</b><p>Заказ на 400 ₽ = 20 коинов — после оплаты.</p></div></li><li><span>${icon("gift")}</span><div><b>Копи на приятное</b><p>Оплата коинами появится позже.</p></div></li></ol><button class="outline-light" data-action="coinInfo">О бонусной программе ${icon("arrow")}</button></div><aside class="coins-aside"><span class="eyebrow">БОЛЬШОЙ КОФЕ · МАЛЕНЬКИЕ РАДОСТИ</span><h2>Всё начинается<br>с чашки кофе.</h2><p>Капучино по дороге на работу или неспешный латте в выходной — у каждого дня свой вкус.</p><a class="primary" href="#menu">Выбрать напиток ${icon("arrow")}</a><p class="fine">Коины начисляет кофейня после оплаты заказа, поэтому баланс одинаков на всех твоих устройствах. Списание коинов ещё недоступно.</p></aside></section>`;
}
function profilePage() {
  // Saved profile data stays visible as a card; the form itself hides behind
  // its own «Изменить» button, and logout clears everything in one tap.
  const filled = !!(profile.name || profile.phone);
  const form = `<form id="profileForm" class="profile-form"><h2>${profileEditing ? "Изменить данные" : "Давай познакомимся"}</h2><p>Имя и телефон помогут кофейне найти твой заказ.</p><label class="form-label" for="profName">Твоё имя</label><input id="profName" name="name" autocomplete="name" value="${safe(profile.name || "")}" placeholder="Как тебя зовут?" maxlength="80"><label class="form-label" for="profPhone">Телефон</label><input id="profPhone" name="phone" type="tel" autocomplete="tel" value="${safe(profile.phone || "")}" placeholder="+7 900 000-00-00" maxlength="30"><button class="primary full" type="submit">Сохранить ${icon("check")}</button>${profileEditing ? `<button class="secondary full" type="button" data-action="profileCancel">Отмена</button>` : ""}<p class="fine">Данные сохраняются на этом устройстве. Заказывать можно и без Telegram.</p></form>`;
  const actions = `<div class="profile-actions"><button class="primary full" data-action="profileEdit">Изменить данные ${icon("arrow")}</button><button class="secondary full" data-action="profileLogout">Выйти из профиля</button></div>`;
  // One tap to the build hash, the environment and the exact error text: what a
  // screenshot has to show when the app misbehaves on someone else's phone.
  const tools = `<div class="profile-tools"><button class="secondary full" data-action="diagnostics">Диагностика</button><button class="secondary full" data-action="update">Проверить обновление</button></div>`;
  const versionState =
    updateState === "stale"
      ? " · есть обновление"
      : updateState === "current"
        ? " · последняя"
        : "";
  return `<section class="profile-page"><div class="page-heading"><div><span class="eyebrow">РАДЫ, ЧТО ТЫ С НАМИ</span><h1>Профиль</h1></div></div><div class="profile-layout"><div class="profile-card"><div class="profile-avatar"><img src="assets/logo.png" alt=""></div><h2>${profile.name ? safe(profile.name) : "Привет, кофеман!"}</h2><p>${profile.phone ? safe(profile.phone) : "Здесь всё для твоего следующего заказа."}</p><a class="profile-coins" href="#coins">${coin()}<span>БК-Коины<strong>${coins()}</strong></span>${icon("arrow")}</a></div>${filled && !profileEditing ? actions : form}</div>${tools}<p class="fine app-version">Версия ${APP_VERSION} · ${buildHash}${versionState}</p></section>`;
}
function render() {
  page = ["home", "menu", "coins", "profile"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "home";
  // A page that fails to build must not leave a blank screen or a dead
  // section: the reason is shown in place, with a way to update the app.
  let markup;
  try {
    markup = {
      home: homePage,
      menu: menuPage,
      coins: coinsPage,
      profile: profilePage,
    }[page]();
  } catch (err) {
    const message = reportError("page:" + page, err);
    markup = `<section class="empty"><h3>Раздел не открылся</h3><p class="fine">${safe(
      message,
    )}</p><button class="secondary" data-action="reloadNow">Обновить приложение</button></section>`;
  }
  $("#main").innerHTML = markup;
  document.querySelectorAll("[data-page]").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === page);
    if (a.dataset.page === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#city").textContent = branch;
  document.title =
    {
      home: "Большой Кофе",
      menu: "Меню",
      coins: "БК-Коины",
      profile: "Профиль",
    }[page] + (page === "home" ? "" : " — Большой Кофе");
  $("#search")?.addEventListener("input", (e) => {
    search = e.target.value;
    $("#menuResults").innerHTML = menuResults();
  });
  $("#profileForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    profile.name = $("#profName").value.trim();
    profile.phone = $("#profPhone").value.trim();
    store.set("bk-profile", JSON.stringify(profile));
    profileEditing = false;
    loadCoins();
    render();
    toast("Профиль сохранён");
  });
}
function toast(text, ms = 3000) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("#announcements").append(el);
  setTimeout(() => el.remove(), ms);
}
// Clipboard is missing or blocked in many WebViews (it needs a secure context
// and a user gesture). Every path is tried; when none works the text is shown
// on screen, selected, so it can be copied by hand instead of being lost.
function copyText(text, title) {
  const manual = () => {
    openSheet(
      `${sheetHead(title || "Скопировать текст")}<p class="sheet-intro">Автокопирование недоступно в этом браузере — выдели текст и скопируй вручную.</p><textarea class="copy-area" readonly rows="8">${safe(text)}</textarea><p class="fine">Заказ можно сразу отправить кофейне в Telegram.</p><button class="primary full" data-action="close">Готово ${icon("check")}</button>`,
    );
    const area = $(".copy-area");
    if (area) {
      try {
        area.focus();
        area.select();
      } catch (err) {
        console.warn("copy:", err);
      }
    }
    return false;
  };
  const done = (ok) => {
    if (ok) toast("Скопировано");
    return ok ? true : manual();
  };
  try {
    if (navigator.clipboard?.writeText)
      return navigator.clipboard
        .writeText(text)
        .then(() => done(true))
        .catch(() => done(false));
  } catch {}
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    const ok = document.execCommand && document.execCommand("copy");
    area.remove();
    return Promise.resolve(done(!!ok));
  } catch {
    return Promise.resolve(done(false));
  }
}
// Cart lines are keyed by product + chosen bread + extras, so the same sandwich
// in different breads stays as separate lines: { [key]: { id, qty, bread?, extras? } }.
const lineKey = (id, bread = "", extras = []) =>
  [id, bread || "", [...extras].sort().join("+")].join("|");
function lineInfo(line) {
  const p = menu.find((x) => x.id === line.id);
  if (!p) return null;
  const extras = (line.extras || [])
    .map((id) => (p.extras || []).find((e) => e.id === id))
    .filter(Boolean);
  const bread = isSandwich(p)
    ? p.breads.find((b) => b.id === line.bread) || (!hasBreadChoice(p) && p.breads[0])
    : null;
  return {
    p,
    bread,
    extras,
    price: p.price + extras.reduce((sum, e) => sum + e.price, 0),
  };
}
// Keeps only valid lines; also converts the old { id: qty } cart format.
function cleanCart(raw) {
  const next = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const line = typeof value === "number" ? { id: key, qty: value } : value;
    if (!line || !Number.isInteger(line.qty) || line.qty <= 0) continue;
    const info = lineInfo(line);
    if (!info || (isSandwich(info.p) && !info.bread)) continue;
    const clean = { id: info.p.id, qty: Math.min(20, line.qty) };
    if (info.bread) clean.bread = info.bread.id;
    if (info.extras.length) clean.extras = info.extras.map((e) => e.id);
    next[lineKey(clean.id, clean.bread, clean.extras)] = clean;
  }
  return next;
}
function totals() {
  return Object.values(cart).reduce(
    (s, line) => {
      const info = lineInfo(line);
      return info
        ? { qty: s.qty + line.qty, total: s.total + info.price * line.qty }
        : s;
    },
    { qty: 0, total: 0 },
  );
}
function persist() {
  // Redraw first: the cart in the interface must react even if saving fails.
  drawCart();
  if (!store.set("bk-cart", JSON.stringify(cart)) && !storageBroken) {
    storageBroken = true;
    toast("Корзина не сохранится: браузер блокирует хранилище");
  }
}
function drawCart() {
  const { qty, total } = totals();
  $("#cartCount").textContent = qty;
  $("#cartCount").hidden = !qty;
  $("#floatingCart").hidden = !qty;
  $("#floatCount").textContent = qty;
  $("#floatTotal").textContent = money(total);
  document.body.classList.toggle("has-cart", !!qty);
}
function addLine(line) {
  const key = lineKey(line.id, line.bread, line.extras);
  const current = cart[key]?.qty || 0;
  if (current >= 20) {
    toast("Можно добавить не больше 20 порций");
    return false;
  }
  cart[key] = { ...line, qty: current + 1 };
  if (!cart[key].extras?.length) delete cart[key].extras;
  if (!cart[key].bread) delete cart[key].bread;
  persist();
  if (inTelegram) tgCall(() => tg.HapticFeedback?.impactOccurred("light"));
  toast("Добавлено в корзину");
  return true;
}
function addProduct(id) {
  const p = menu.find((x) => x.id === id);
  if (!p) return;
  // Sandwiches go through the builder: bread first, then optional extras.
  if (isSandwich(p)) return openBuilder(id);
  addLine({ id });
}
// Sheet header markup. Never name this helper `head`: in some WebViews bare
// `head` resolves to document.head (HTMLHeadElement) and the call dies with
// «head is not a function», killing the whole sheet.
function sheetHead(title) {
  return `<div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="icon-button" data-action="close" aria-label="Закрыть">${icon("close")}</button></div>`;
}
function openSheet(html, dark = false) {
  // Fresh measurement right before the sheet appears: the keyboard or the
  // Telegram chrome may have changed the visible area since page load, and the
  // sheet has to be clamped to what the user can actually see and tap.
  measureViewport();
  if ($("#overlay").hidden) returnFocus = document.activeElement;
  $("#sheet").innerHTML = html;
  $("#sheet").classList.toggle("dark-sheet", dark);
  $("#overlay").hidden = false;
  document.body.style.overflow = "hidden";
  $("#sheet").scrollTop = 0;
  // preventScroll: on phones focusing the sheet must not jump the page.
  try {
    $("#sheet").focus({ preventScroll: true });
  } catch {
    $("#sheet").focus();
  }
}
function closeSheet() {
  if (submitting) return;
  $("#overlay").hidden = true;
  document.body.style.overflow = "";
  returnFocus?.isConnected && returnFocus.focus();
}
function productDetail(id) {
  const p = menu.find((x) => x.id === id);
  if (!p) return;
  if (isSandwich(p)) return openBuilder(id);
  const art = hasArt(p) ? `<div class="detail-image art-tile">${productArt(p)}</div>` : "";
  const note = hasArt(p)
    ? "Рисунок временный — фото напитка появится позже. Уточнить состав можно у бариста."
    : "Уточнить состав можно у бариста.";
  openSheet(
    `${sheetHead(safe(p.name))}${art}<div class="detail-description"><h3>${safe(p.name)} <span>${money(p.price)}</span></h3>${p.desc ? `<p>${safe(p.desc)}</p>` : ""}<p class="fine">${note}</p></div><button class="primary full" data-detail-add="${p.id}">Добавить в корзину · ${money(p.price)} ${icon("plus")}</button>`,
  );
}
let builder = null;
function openBuilder(id) {
  const p = menu.find((x) => x.id === id);
  if (!p || !isSandwich(p)) return;
  const choice = hasBreadChoice(p);
  builder = { id, bread: choice ? "" : p.breads[0].id, extras: new Set() };
  const extras = p.extras || [];
  const groups = [...new Set(extras.map((e) => e.group))];
  openSheet(
    `${sheetHead(safe(p.name))}<form id="builderForm" class="builder" novalidate><p class="builder-desc">${safe(p.desc)}</p>
    <fieldset class="builder-step" id="breadStep"><legend><span class="step-num">1</span><span>В чём приготовить?</span>${choice ? '<small class="required-tag">обязательно</small>' : ""}</legend>
    <div class="bread-options ${choice ? "" : "single"}">${p.breads.map((b) => `<label class="bread-option"><input type="radio" name="bread" value="${b.id}" ${choice ? "" : "checked"}><span class="option-card">${breadIcon(b.id)}<span>${safe(b.name)}</span><i class="option-check">${icon("check")}</i></span></label>`).join("")}</div>
    ${choice ? "" : '<p class="fine">Эта позиция готовится только в лепёшке.</p>'}</fieldset>
    ${groups
      .map(
        (g, i) =>
          `<fieldset class="builder-step"><legend><span class="step-num">${i + 2}</span><span>${g === "Соус" ? "Добавить соус" : "Добавки"}</span><small>по желанию</small></legend><div class="extra-options">${extras
            .filter((e) => e.group === g)
            .map(
              (e) =>
                `<label class="extra-option"><input type="checkbox" name="extra" value="${e.id}"><span class="option-row"><span class="check-box">${icon("check")}</span><span class="extra-name">${safe(e.name)}</span><b>+${money(e.price)}</b></span></label>`,
            )
            .join("")}</div></fieldset>`,
      )
      .join("")}
    <div class="sheet-footer"><div class="builder-summary" id="builderSummary" aria-live="polite"></div>
    <button class="primary full" id="builderSubmit" type="submit"></button></div></form>`,
  );
  const form = $("#builderForm");
  const update = () => {
    builder.bread = form.querySelector('input[name="bread"]:checked')?.value || "";
    builder.extras = new Set(
      [...form.querySelectorAll('input[name="extra"]:checked')].map((x) => x.value),
    );
    const info = lineInfo({ id, bread: builder.bread, extras: [...builder.extras] });
    // No bread yet: the step above and the pinned button already say what to
    // do, so the summary stays empty instead of repeating it.
    $("#builderSummary").textContent = info.bread
      ? [info.bread.name, ...info.extras.map((e) => e.name.toLowerCase())].join(" · ")
      : "";
    $("#builderSubmit").innerHTML = info.bread
      ? `Добавить · ${money(info.price)} ${icon("plus")}`
      : `Выбери, в чём приготовить`;
    $("#builderSubmit").classList.toggle("waiting", !info.bread);
    $("#breadStep").classList.remove("invalid");
  };
  form.addEventListener("change", update);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!builder.bread) {
      $("#breadStep").classList.add("invalid");
      form.querySelector('input[name="bread"]')?.focus();
      toast("Выбери лепёшку, хлеб или булочку");
      return;
    }
    if (addLine({ id, bread: builder.bread, extras: [...builder.extras] }))
      closeSheet();
  });
  update();
}
function lineOptions(info) {
  const parts = [];
  if (info.bread) parts.push(info.bread.name);
  if (info.extras.length)
    parts.push("+ " + info.extras.map((e) => e.name.toLowerCase()).join(", "));
  return parts.join(" · ");
}
function openCart() {
  const items = Object.entries(cart)
      .map(([key, line]) => ({ key, line, info: lineInfo(line) }))
      .filter((x) => x.info),
    { total } = totals();
  openSheet(
    `${sheetHead("Корзина")}${items.length ? `<div class="cart-list">${items.map(({ key, line, info }) => { const p = info.p, k = safe(key), options = lineOptions(info); return `<div class="cart-row"><div class="cart-image ${hasArt(p) ? "art-tile" : "food-thumb"}">${hasArt(p) ? productArt(p) : breadIcon(info.bread?.id || "булочка")}</div><div class="cart-item-info"><b>${safe(p.name)}</b>${options ? `<small class="line-options">${safe(options)}</small>` : ""}<small>${money(info.price)} / шт.</small><div class="qty"><button data-dec="${k}" aria-label="Убрать один ${safe(p.name)}">−</button><span>${line.qty}</span><button data-inc="${k}" aria-label="Добавить один ${safe(p.name)}" ${line.qty >= 20 ? "disabled" : ""}>+</button></div></div><strong>${money(info.price * line.qty)}</strong></div>`; }).join("")}</div><div class="cart-coins">${coin()}<span>Начислим после оплаты заказа</span><b>+${Math.floor(total * 0.05)} коинов</b></div><div class="total-row"><span>Итого</span><strong>${money(total)}</strong></div><form id="checkoutForm"><div class="choice-row"><button type="button" class="choice ${type === "pickup" ? "selected" : ""}" data-type="pickup">${icon("bag")}С собой</button><button type="button" class="choice ${type === "here" ? "selected" : ""}" data-type="here">${icon("chair")}В кофейне</button></div><label class="form-label" for="branch">Город</label><select id="branch"><option ${branch === "Волжский" ? "selected" : ""}>Волжский</option><option ${branch === "Волгоград" ? "selected" : ""}>Волгоград</option></select><label class="form-label" for="customerName">Твоё имя</label><input id="customerName" autocomplete="name" placeholder="Имя" maxlength="80" required value="${safe(profile.name || "")}"><label class="form-label" for="customerPhone">Телефон для заказа</label><input id="customerPhone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00" maxlength="30" required value="${safe(profile.phone || "")}"><p class="fine">Оплата при получении. Выбор конкретной точки пока недоступен — кофейня уточнит место выдачи по телефону.</p><div class="order-problem" id="orderProblem" hidden></div><div class="sheet-footer"><button class="primary full" id="submitOrder">Оформить заказ · ${money(total)} ${icon("arrow")}</button></div></form>` : loading
      ? `<div class="empty loading">Загружаем меню…</div>`
      : loadError
        ? `<div class="empty">${icon("bag")}<h3>Корзина ждёт меню</h3><p>Не получилось загрузить меню, поэтому заказ пока не собрать.</p><button class="secondary" data-action="retry">Попробовать ещё раз</button></div>`
        : `<div class="empty">${icon("bag")}<h3>Здесь будет твой кофе</h3><p>Добавь что-нибудь вкусное из меню.</p><button class="primary" data-action="toMenu">Выбрать напиток ${icon("arrow")}</button></div>`}`,
  );
  $("#checkoutForm")?.addEventListener("submit", submitOrder);
}
function saveCheckoutDraft() {
  if ($("#customerName")) {
    profile.name = $("#customerName").value;
    profile.phone = $("#customerPhone").value;
    branch = $("#branch").value;
  }
}
function orderText() {
  const lines = Object.values(cart)
    .map((line) => ({ line, info: lineInfo(line) }))
    .filter((x) => x.info)
    .map(
      ({ line, info }, i) =>
        `${i + 1}. ${info.p.name}${
          lineOptions(info) ? " · " + lineOptions(info) : ""
        } × ${line.qty} — ${money(info.price * line.qty)}`,
    );
  lines.push("");
  lines.push("Итого: " + money(totals().total));
  lines.push((type === "here" ? "В кофейне" : "С собой") + " · " + branch);
  lines.push((profile.name || "—") + " · " + (profile.phone || "—"));
  return "Заказ «Большой Кофе»\n" + lines.join("\n");
}
// A weak mobile network drops the first request often enough to be worth a
// retry before the user is told the order failed.
async function postOrder(payload) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 900));
    }
  }
  throw lastError;
}
// A failed send must not lose the order or the contacts: the form stays filled,
// the exact reason is on screen and there are two ways out that do not depend
// on the API — copy the order as text or write to the coffee shop directly.
function showOrderProblem(message) {
  const box = $("#orderProblem");
  if (!box) return;
  box.innerHTML = `<b>Заказ не отправлен</b><p class="fine">${safe(
    message,
  )}</p><div class="order-problem-actions"><button type="button" class="secondary" data-action="copyOrder">Скопировать заказ</button><a class="secondary" href="https://t.me/bk_kofe" target="_blank" rel="noopener">Написать в Telegram</a></div><p class="fine">Заказ и контакты сохранены: нажми «Попробовать ещё раз» или пришли текст заказа в Telegram — кофейня примет его и так.</p>`;
  box.hidden = false;
}
async function submitOrder(e) {
  e.preventDefault();
  if (submitting) return;
  saveCheckoutDraft();
  profile.name = profile.name.trim();
  profile.phone = profile.phone.trim();
  if (!profile.name || profile.phone.replace(/\D/g, "").length < 10) {
    toast("Укажи имя и полный номер телефона");
    return;
  }
  submitting = true;
  const button = $("#submitOrder");
  button.disabled = true;
  button.textContent = "Отправляем…";
  $("#sheet")
    .querySelectorAll("input,select,button")
    .forEach((el) => (el.disabled = true));
  try {
    const response = await postOrder({
      items: Object.values(cart).map((line) => ({
        id: line.id,
        qty: line.qty,
        bread: line.bread,
        extras: line.extras,
      })),
      customer: profile,
      branch,
      type,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Не удалось оформить заказ");
    store.set("bk-profile", JSON.stringify(profile));
    store.set("bk-branch", branch);
    loadCoins();
    cart = {};
    persist();
    render();
    submitting = false;
    openSheet(
      `${sheetHead("Заказ принят")}<div class="success"><div class="success-check">${icon("check")}</div><span class="eyebrow">ЗАКАЗ № ${safe(result.id)}</span><h2>Спасибо за заказ!</h2><p>${type === "here" ? "Подойди к стойке и назови номер заказа." : "Город: " + safe(branch) + ". Кофейня уточнит место выдачи по телефону."}<br>Оплата при получении.</p><div class="success-coins">${coin()}<b>+${result.coinsEarned} БК-Коинов после оплаты</b></div><p class="fine">Кофейня начислит коины, когда оплатишь заказ, — они появятся в разделе «Коины». Это подтверждение приёма заказа приложением, не статус приготовления.</p><button class="primary full" data-action="close">Отлично ${icon("check")}</button></div>`,
    );
  } catch (err) {
    submitting = false;
    $("#sheet")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = false));
    button.textContent = "Попробовать ещё раз · " + money(totals().total);
    showOrderProblem(fail("order", err, "Заказ не отправлен"));
  }
}
function openLocation() {
  openSheet(
    `${sheetHead("Где встретимся?")}<p class="sheet-intro">Выбери город для своего заказа.</p><div class="city-options">${["Волжский", "Волгоград"].map((c) => `<button data-city="${c}" class="city-option ${branch === c ? "selected" : ""}">${icon("pin")}<span>${c}</span>${icon(branch === c ? "check" : "arrow")}</button>`).join("")}</div><p class="fine">Адреса конкретных кофеен появятся после уточнения у команды. Пока выбираем только город.</p>`,
  );
}
function openCoinInfo() {
  openSheet(
    `${sheetHead("Твои БК-Коины")}<div class="coin-info-art">${coin()}</div><div class="info-box"><h3>Приятное с каждым заказом</h3><p>Возвращаем 5% суммы целыми коинами, округляя вниз. Например, за 400 ₽ начислим 20 коинов — после оплаты заказа.</p><p>1 БК-Коин = 1 ₽. Списание бонусов пока не подключено.</p><p class="fine">Коины начисляет кофейня после оплаты, поэтому баланс одинаков на всех твоих устройствах.</p></div><button class="primary full" data-action="close">Всё понятно ${icon("check")}</button>`,
  );
}
// «Профиль → Диагностика»: everything a developer needs from a WebView without
// developer tools — build hash, Telegram client, every height the layout could
// be using, storage state, which menu source answered and the exact text of the
// last failures. One screenshot replaces a round of guessing.
const apiProbes = {};
function pingApi() {
  const urls = ["/api/health", "/api/menu", "/api/version", "/menu.json"];
  return Promise.all(
    urls.map(async (url) => {
      const started = Date.now();
      try {
        const response = await fetch(url + "?probe=" + started, {
          cache: "no-store",
        });
        apiProbes[url] = response.status + " · " + (Date.now() - started) + " мс";
      } catch (err) {
        apiProbes[url] =
          "нет ответа (" + String((err && err.message) || err).slice(0, 50) + ")";
      }
    }),
  );
}
function diagnosticsRows() {
  const vv = window.visualViewport;
  const state =
    updateState === "stale"
      ? " · есть обновление"
      : updateState === "current"
        ? " · последняя"
        : updateState === "offline"
          ? " · сервер не ответил"
          : "";
  return [
    ["Версия приложения", APP_VERSION + " · " + buildHash + state],
    [
      "Версия на сервере",
      serverInfo ? serverInfo.app + " · " + serverInfo.hash : "неизвестна",
    ],
    ["Источник меню", menuSource || (loading ? "загружается…" : "нет")],
    ["Позиций в меню", String(menu.length)],
    [
      "Telegram",
      inTelegram
        ? "v" +
          (tg.version || "?") +
          " · " +
          (tg.platform || "?") +
          (tgUser ? " · id " + tgUser.id : " · без профиля")
        : "не Telegram (браузер)",
    ],
    [
      "Экран",
      (window.screen ? screen.width + "×" + screen.height : "?") +
        " · dpr " +
        (window.devicePixelRatio || 1),
    ],
    [
      "Высоты, px",
      "document " +
        document.documentElement.clientHeight +
        " · окно " +
        window.innerHeight +
        (vv ? " · visualViewport " + Math.round(vv.height) : "") +
        (inTelegram
          ? " · Telegram " + (tg.viewportStableHeight || tg.viewportHeight || "—")
          : ""),
    ],
    [
      "--app-height",
      getComputedStyle(document.documentElement)
        .getPropertyValue("--app-height")
        .trim() || "—",
    ],
    ["Хранилище", storageBroken ? "браузер блокирует" : "работает"],
    ["Корзина", Object.keys(cart).length + " строк"],
  ];
}
const diagnosticRow = ([key, value]) =>
  `<div><dt>${safe(key)}</dt><dd>${safe(value)}</dd></div>`;
function diagnosticsMarkup() {
  const probes = Object.keys(apiProbes);
  return `${sheetHead("Диагностика")}<p class="sheet-intro">Если что-то не работает — сделай скриншот этого экрана: здесь видно версию, окружение и текст ошибки.</p>
  <dl class="diag">${diagnosticsRows().map(diagnosticRow).join("")}</dl>
  <h3 class="diag-title">Доступность сервера</h3>
  <dl class="diag">${
    probes.length
      ? probes.map((url) => diagnosticRow([url, apiProbes[url]])).join("")
      : diagnosticRow(["Проверяем…", "…"])
  }</dl>
  <h3 class="diag-title">Последние ошибки</h3>
  ${
    errorLog.length
      ? `<ul class="diag-errors">${errorLog
          .map(
            (e) =>
              `<li><b>${safe(e.at)}</b> · ${safe(e.where)}<br>${safe(e.message)}</li>`,
          )
          .join("")}</ul>`
      : '<p class="fine">Ошибок не было.</p>'
  }
  <div class="diag-actions">
    <button class="secondary full" data-action="diagnosticsRefresh">Обновить проверку</button>
    <button class="secondary full" data-action="diagnosticsCopy">Скопировать отчёт</button>
    <button class="secondary full" data-action="diagnosticsSend">Отправить отчёт в кофейню</button>
    <button class="primary full" data-action="update">Проверить обновление ${icon("arrow")}</button>
    <button class="secondary full" data-action="reloadNow">Обновить приложение принудительно</button>
  </div>`;
}
function openDiagnostics() {
  openSheet(diagnosticsMarkup());
  pingApi().then(() => {
    // Only redraw while this very sheet is still the open one.
    if ($("#sheetTitle")?.textContent === "Диагностика")
      openSheet(diagnosticsMarkup());
  });
}
function diagnosticsReport() {
  const lines = diagnosticsRows().map(([key, value]) => key + ": " + value);
  lines.push("Сервер:");
  for (const [url, result] of Object.entries(apiProbes))
    lines.push("  " + url + " → " + result);
  lines.push("Ошибки:");
  if (!errorLog.length) lines.push("  нет");
  for (const e of errorLog) lines.push("  " + e.at + " [" + e.where + "] " + e.message);
  lines.push("Адрес: " + location.href);
  lines.push("Браузер: " + navigator.userAgent);
  return "Отчёт диагностики Большой Кофе\n" + lines.join("\n");
}
function sendDiagnostics() {
  const last = errorLog.length ? errorLog[errorLog.length - 1].message : "нет";
  const summary =
    `Диагностика ${APP_VERSION}·${buildHash} · ` +
    (inTelegram ? `tg ${tg.version || "?"}/${tg.platform || "?"}` : "браузер") +
    ` · меню ${menuSource || "нет"}` +
    ` · ошибок ${errorLog.length}` +
    ` · последняя: ${last}` +
    ` · /api/health ${apiProbes["/api/health"] || "?"}`;
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: summary.slice(0, 300),
      where: "diagnostics",
      page: page,
      version: APP_VERSION + " · " + buildHash,
    }),
  })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      toast("Отчёт отправлен");
    })
    .catch((err) => {
      toast("Отправить не вышло (" + String(err.message || err) + "). Скопируй отчёт", 8000);
    });
}
// One broken action must never leave the interface dead: every handler runs
// on its own, so a single failure cannot swallow the rest of the click.
function run(action) {
  try {
    action();
  } catch (err) {
    console.error("Большой Кофе:", err);
    fail("click", err, "Что-то пошло не так");
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  // For buttons inside the sheet one of these never matches; keep the order.
  if (b.dataset.add) run(() => addProduct(b.dataset.add));
  if (b.dataset.detail) run(() => productDetail(b.dataset.detail));
  if (b.dataset.detailAdd)
    run(() => {
      if (addProduct(b.dataset.detailAdd) !== false) closeSheet();
    });
  if (b.dataset.cat)
    run(() => {
      selected = b.dataset.cat;
      render();
    });
  if (b.dataset.order)
    run(() => {
      type = b.dataset.order;
      location.hash = "menu";
    });
  if (b.dataset.inc || b.dataset.dec)
    run(() => {
      saveCheckoutDraft();
      const key = b.dataset.inc || b.dataset.dec;
      if (cart[key]) {
        cart[key].qty = Math.min(20, cart[key].qty + (b.dataset.inc ? 1 : -1));
        if (cart[key].qty <= 0) delete cart[key];
      }
      persist();
      openCart();
    });
  if (b.dataset.type)
    run(() => {
      saveCheckoutDraft();
      type = b.dataset.type;
      openCart();
    });
  if (b.dataset.city)
    run(() => {
      branch = b.dataset.city;
      store.set("bk-branch", branch);
      render();
      closeSheet();
      toast("Выбран город: " + branch);
    });
  const actions = {
    close: closeSheet,
    location: openLocation,
    coinInfo: openCoinInfo,
    retry: loadMenu,
    toMenu: () => {
      closeSheet();
      location.hash = "menu";
    },
    diagnostics: openDiagnostics,
    diagnosticsRefresh: () => {
      pingApi().then(() => openSheet(diagnosticsMarkup()));
    },
    diagnosticsCopy: () => copyText(diagnosticsReport(), "Отчёт диагностики"),
    diagnosticsSend: sendDiagnostics,
    update: () => checkVersion(true),
    reloadNow: forceReload,
    copyOrder: () => copyText(orderText(), "Текст заказа"),
    orderRetry: () => {
      closeSheet();
      openCart();
    },
  };
  if (b.dataset.action) run(() => actions[b.dataset.action]?.());
});
$("#locationTop").addEventListener("click", () => run(openLocation));
$("#cartTop").addEventListener("click", () => run(openCart));
$("#floatingCart").addEventListener("click", () => run(openCart));
$("#overlay").onclick = (e) => {
  if (e.target === $("#overlay")) closeSheet();
};
document.addEventListener("keydown", (e) => {
  if ($("#overlay").hidden) return;
  if (e.key === "Escape") closeSheet();
  if (e.key === "Tab") {
    const focusables = [
      ...$("#sheet").querySelectorAll(
        "button:not(:disabled),a,input:not(:disabled),select:not(:disabled)",
      ),
    ];
    const first = focusables[0],
      last = focusables[focusables.length - 1];
    if (!first) {
      e.preventDefault();
      return;
    }
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === $("#sheet"))
    ) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener("hashchange", () => {
  if (!submitting) closeSheet();
  render();
  // Plain form: older WebViews throw on the "instant" scroll behavior.
  window.scrollTo(0, 0);
});
// Two sources for the same catalogue: the API (prices are checked there when an
// order is placed) and the plain menu.json file the server also publishes. If
// the API is down, blocked by a proxy or the whole host runs without Node, the
// menu — and with it food, the sandwich builder and the cart — still opens
// instead of «Не получилось загрузить меню».
async function fetchMenu() {
  const sources = ["/api/menu", "/menu.json"];
  let lastError;
  for (const url of sources) {
    try {
      const response = await fetch(url + "?t=" + Date.now(), {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(url + ": HTTP " + response.status);
      const data = await response.json();
      if (!Array.isArray(data) || !data.length)
        throw new Error(url + ": не список товаров");
      return { data, url };
    } catch (err) {
      lastError = err;
      logError("menu", err);
    }
  }
  throw lastError || new Error("Меню недоступно");
}
async function loadMenu() {
  loading = true;
  loadError = false;
  render();
  try {
    const { data, url } = await fetchMenu();
    menu = data;
    menuSource = url;
    // Never drop stored lines when the menu itself failed to load.
    cart = cleanCart(cart);
  } catch (err) {
    loadError = true;
    reportError("menu", err);
  } finally {
    loading = false;
    render();
    persist();
  }
}
// Anything not caught above (timers, listeners added later) is reported too.
window.addEventListener("error", (e) => {
  fail("window", e.error || e.message, "Что-то пошло не так");
});
window.addEventListener("unhandledrejection", (e) => {
  fail("promise", e.reason, "Что-то пошло не так");
});
hydrateIcons();
loadMenu();
loadCoins();
// Compares the running build with the one the server has. In a WebView with a
// stale cache this is what finally brings the new code in.
checkVersion();
