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
// The Telegram WebView may be taller than the part the user actually sees
// (the Mini App is not fully expanded), so 100vh/100dvh would put the bottom
// sheet and its buttons off screen. Telegram reports the visible height.
function syncViewport() {
  const h = inTelegram && Number(tg.viewportStableHeight);
  if (h > 0)
    document.documentElement.style.setProperty("--app-height", h + "px");
}
if (inTelegram) {
  syncViewport();
  tgCall(() => tg.onEvent("viewportChanged", syncViewport));
}
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
  loading = true,
  loadError = false,
  submitting = false;
let page = "home",
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
const money = (n) => new Intl.NumberFormat("ru-RU").format(n) + " ₽";
const safe = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const coins = () => Math.max(0, Number(store.get("bk-coins")) || 0);
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
  <div class="home-top"><a class="coin-banner" href="#coins"><div class="banner-copy"><span class="eyebrow">БОЛЬШЕ КОФЕ — БОЛЬШЕ ПРИЯТНОГО</span><h2>БК-Коины</h2><p>Твой кофе возвращается.<br>Копи 5% с каждого заказа.</p><span class="banner-balance">${coins()} <span>коинов на счёте</span>${icon("arrow")}</span></div><div class="coin-scene">${coin("coin-back")}${coin("coin-main")}<span class="coin-spark spark-one"></span><span class="coin-spark spark-two"></span></div></a>
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
  return `<section class="coins-page"><div class="coins-dark"><span class="eyebrow">ПРИЯТНО БЫТЬ СВОИМ</span><h1>БК-Коины</h1><div class="coin-balance">${coin()}<div><strong>${coins()}</strong><span>БК-Коинов</span><small>1 БК-Коин = 1 ₽</small></div></div><div class="yellow-note"><b>Твой следующий кофе<br>становится ближе.</b><p>Начисляем 5% от суммы каждого заказа.</p>${icon("arrow")}</div><h2>Как это работает</h2><ol class="loyalty-steps"><li><span>${icon("cup")}</span><div><b>Выбирай любимое</b><p>Оформи заказ в приложении.</p></div></li><li><span>${coin()}</span><div><b>Получай БК-Коины</b><p>Заказ на 400 ₽ = 20 коинов.</p></div></li><li><span>${icon("gift")}</span><div><b>Копи на приятное</b><p>Оплата коинами появится позже.</p></div></li></ol><button class="outline-light" data-action="coinInfo">О бонусной программе ${icon("arrow")}</button></div><aside class="coins-aside"><span class="eyebrow">БОЛЬШОЙ КОФЕ · МАЛЕНЬКИЕ РАДОСТИ</span><h2>Всё начинается<br>с чашки кофе.</h2><p>Капучино по дороге на работу или неспешный латте в выходной — у каждого дня свой вкус.</p><a class="primary" href="#menu">Выбрать напиток ${icon("arrow")}</a><p class="fine">Бонусная программа пока работает в деморежиме: баланс хранится на этом устройстве и не синхронизируется. Списание коинов ещё недоступно.</p></aside></section>`;
}
function profilePage() {
  return `<section class="profile-page"><div class="page-heading"><div><span class="eyebrow">РАДЫ, ЧТО ТЫ С НАМИ</span><h1>Профиль</h1></div></div><div class="profile-layout"><div class="profile-card"><div class="profile-avatar"><img src="assets/logo.png" alt=""></div><h2>${profile.name ? safe(profile.name) : "Привет, кофеман!"}</h2><p>${profile.phone ? safe(profile.phone) : "Здесь всё для твоего следующего заказа."}</p><a class="profile-coins" href="#coins">${coin()}<span>БК-Коины<strong>${coins()}</strong></span>${icon("arrow")}</a></div><form id="profileForm" class="profile-form"><h2>Давай познакомимся</h2><p>Имя и телефон помогут кофейне найти твой заказ.</p><label class="form-label" for="profName">Твоё имя</label><input id="profName" name="name" autocomplete="name" value="${safe(profile.name || "")}" placeholder="Как тебя зовут?" maxlength="80"><label class="form-label" for="profPhone">Телефон</label><input id="profPhone" name="phone" type="tel" autocomplete="tel" value="${safe(profile.phone || "")}" placeholder="+7 900 000-00-00" maxlength="30"><button class="primary" type="submit">Сохранить ${icon("check")}</button><p class="fine">Данные сохраняются на этом устройстве. Заказывать можно и без Telegram.</p></form></div></section>`;
}
function render() {
  page = ["home", "menu", "coins", "profile"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "home";
  $("#main").innerHTML = {
    home: homePage,
    menu: menuPage,
    coins: coinsPage,
    profile: profilePage,
  }[page]();
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
    render();
    toast("Профиль сохранён");
  });
}
function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("#announcements").append(el);
  setTimeout(() => el.remove(), 3000);
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
function head(title) {
  return `<div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="icon-button" data-action="close" aria-label="Закрыть">${icon("close")}</button></div>`;
}
function openSheet(html, dark = false) {
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
    `${head(safe(p.name))}${art}<div class="detail-description"><h3>${safe(p.name)} <span>${money(p.price)}</span></h3>${p.desc ? `<p>${safe(p.desc)}</p>` : ""}<p class="fine">${note}</p></div><button class="primary full" data-detail-add="${p.id}">Добавить в корзину · ${money(p.price)} ${icon("plus")}</button>`,
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
    `${head(safe(p.name))}<form id="builderForm" class="builder" novalidate><p class="builder-desc">${safe(p.desc)}</p>
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
    `${head("Корзина")}${items.length ? `<div class="cart-list">${items.map(({ key, line, info }) => { const p = info.p, k = safe(key), options = lineOptions(info); return `<div class="cart-row"><div class="cart-image ${hasArt(p) ? "art-tile" : "food-thumb"}">${hasArt(p) ? productArt(p) : breadIcon(info.bread?.id || "булочка")}</div><div class="cart-item-info"><b>${safe(p.name)}</b>${options ? `<small class="line-options">${safe(options)}</small>` : ""}<small>${money(info.price)} / шт.</small><div class="qty"><button data-dec="${k}" aria-label="Убрать один ${safe(p.name)}">−</button><span>${line.qty}</span><button data-inc="${k}" aria-label="Добавить один ${safe(p.name)}" ${line.qty >= 20 ? "disabled" : ""}>+</button></div></div><strong>${money(info.price * line.qty)}</strong></div>`; }).join("")}</div><div class="cart-coins">${coin()}<span>Начислим за этот заказ</span><b>+${Math.floor(total * 0.05)} коинов</b></div><div class="total-row"><span>Итого</span><strong>${money(total)}</strong></div><form id="checkoutForm"><div class="choice-row"><button type="button" class="choice ${type === "pickup" ? "selected" : ""}" data-type="pickup">${icon("bag")}С собой</button><button type="button" class="choice ${type === "here" ? "selected" : ""}" data-type="here">${icon("chair")}В кофейне</button></div><label class="form-label" for="branch">Город</label><select id="branch"><option ${branch === "Волжский" ? "selected" : ""}>Волжский</option><option ${branch === "Волгоград" ? "selected" : ""}>Волгоград</option></select><label class="form-label" for="customerName">Твоё имя</label><input id="customerName" autocomplete="name" placeholder="Имя" maxlength="80" required value="${safe(profile.name || "")}"><label class="form-label" for="customerPhone">Телефон для заказа</label><input id="customerPhone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00" maxlength="30" required value="${safe(profile.phone || "")}"><p class="fine">Оплата при получении. Выбор конкретной точки пока недоступен — кофейня уточнит место выдачи по телефону.</p><div class="sheet-footer"><button class="primary full" id="submitOrder">Оформить заказ · ${money(total)} ${icon("arrow")}</button></div></form>` : loading
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
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: Object.values(cart).map((line) => ({
          id: line.id,
          qty: line.qty,
          bread: line.bread,
          extras: line.extras,
        })),
        customer: profile,
        branch,
        type,
      }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Не удалось оформить заказ");
    store.set("bk-profile", JSON.stringify(profile));
    store.set("bk-branch", branch);
    store.set("bk-coins", String(coins() + result.coinsEarned));
    cart = {};
    persist();
    render();
    submitting = false;
    openSheet(
      `${head("Заказ принят")}<div class="success"><div class="success-check">${icon("check")}</div><span class="eyebrow">ЗАКАЗ № ${safe(result.id)}</span><h2>Спасибо за заказ!</h2><p>${type === "here" ? "Подойди к стойке и назови номер заказа." : "Город: " + safe(branch) + ". Кофейня уточнит место выдачи по телефону."}<br>Оплата при получении.</p><div class="success-coins">${coin()}<b>+${result.coinsEarned} БК-Коинов</b></div><p class="fine">Это подтверждение приёма заказа приложением, не статус приготовления.</p><button class="primary full" data-action="close">Отлично ${icon("check")}</button></div>`,
    );
  } catch (err) {
    submitting = false;
    $("#sheet")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = false));
    button.textContent = "Попробовать ещё раз · " + money(totals().total);
    toast(err.message || "Проверь подключение и попробуй ещё раз");
  }
}
function openLocation() {
  openSheet(
    `${head("Где встретимся?")}<p class="sheet-intro">Выбери город для своего заказа.</p><div class="city-options">${["Волжский", "Волгоград"].map((c) => `<button data-city="${c}" class="city-option ${branch === c ? "selected" : ""}">${icon("pin")}<span>${c}</span>${icon(branch === c ? "check" : "arrow")}</button>`).join("")}</div><p class="fine">Адреса конкретных кофеен появятся после уточнения у команды. Пока выбираем только город.</p>`,
  );
}
function openCoinInfo() {
  openSheet(
    `${head("Твои БК-Коины")}<div class="coin-info-art">${coin()}</div><div class="info-box"><h3>Приятное с каждым заказом</h3><p>Возвращаем 5% суммы целыми коинами, округляя вниз. Например, за 400 ₽ начислим 20 коинов.</p><p>1 БК-Коин = 1 ₽. Списание бонусов пока не подключено.</p><p class="fine">Демобаланс хранится в браузере на этом устройстве. Это пока не полноценный бонусный счёт: нет синхронизации, серверной защиты и истории начислений.</p></div><button class="primary full" data-action="close">Всё понятно ${icon("check")}</button>`,
  );
}
// One broken action must never leave the interface dead: every handler runs
// on its own, so a single failure cannot swallow the rest of the click.
function run(action) {
  try {
    action();
  } catch (err) {
    console.error("Большой Кофе:", err);
    toast("Что-то пошло не так. Попробуй ещё раз");
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
async function loadMenu() {
  loading = true;
  loadError = false;
  render();
  try {
    const response = await fetch("/api/menu");
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error();
    menu = data;
    // Never drop stored lines when the menu itself failed to load.
    cart = cleanCart(cart);
  } catch {
    loadError = true;
  } finally {
    loading = false;
    render();
    persist();
  }
}
hydrateIcons();
loadMenu();
