const $ = (s) => document.querySelector(s);
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
let profile = read("bk-profile", {}),
  cart = read("bk-cart", {});
let branch = localStorage.getItem("bk-branch") || "Волжский";
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
  profile.name ||= [tgUser.first_name, tgUser.last_name]
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
const coins = () => Math.max(0, Number(localStorage.getItem("bk-coins")) || 0);
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
const photos = {
  latte: "latte",
  cappuccino: "cappuccino",
  raf: "raf",
  "ice-latte": "ice-latte",
  lemonade: "lemonade",
};
function productArt(p) {
  // The catalogue returned by the server carries the source menu image. Use it
  // here instead of silently replacing it with an illustration; this keeps the
  // menu data and the product cards in sync when the catalogue is updated.
  if (p.image)
    return `<img src="/${encodeURIComponent(p.image)}" alt="${safe(p.name)}" loading="lazy">`;
  if (photos[p.id])
    return `<img src="assets/${photos[p.id]}.webp" alt="${safe(p.name)}" loading="lazy">`;
  // Illustrations, not unrelated product photographs, for the remaining items.
  const dessert = p.category === "Десерты";
  let drawing;
  if (p.id === "croissant") {
    drawing =
      '<ellipse cx="50" cy="77" rx="36" ry="6" fill="#ffffff15"/><path d="M12 66C9 42 26 22 50 24c24-2 41 18 38 42L71 57Q50 39 29 57Z" fill="#d99b4c"/><path d="m24 35 13 21m1-30 7 24m17-24-7 24m21-15-13 21" stroke="#f8d594" stroke-width="5"/><path d="m12 66 17-9-6 14zm76 0-17-9 6 14z" fill="#b47530"/>';
  } else if (dessert) {
    drawing =
      '<path d="m18 62 60-29 7 38-62 12z" fill="#e4bf7d"/><path d="m18 57 60-29 7 32-62 12z" fill="#f5e7c9"/><path d="m18 57 60-29-22-8-38 29z" fill="#fff5dc"/><circle cx="56" cy="32" r="6" fill="#a44932"/>';
  } else {
    const drinkColor =
      p.id === "matcha" ? "#809b4a" : p.id === "tea" ? "#9a443c" : "#58341e";
    drawing = `<ellipse cx="48" cy="79" rx="32" ry="6" fill="#ffffff15"/><path d="M68 38h8c17 0 15 24-2 24h-6" fill="none" stroke="#cfbca4" stroke-width="6"/><path d="M22 32h49l-4 36q-20 21-41 0z" fill="#e7ddce"/><ellipse cx="46.5" cy="32" rx="24.5" ry="8" fill="#f5e9d5"/><ellipse cx="46.5" cy="32" rx="20" ry="5" fill="${drinkColor}"/><path d="M40 13q-5 5 0 10m12-14q-5 5 0 10" stroke="#ffffff55" stroke-width="2" fill="none"/>`;
  }
  return `<div class="product-placeholder ${dessert ? "dessert" : ""}" role="img" aria-label="${safe(p.name)} — иллюстрация"><svg viewBox="0 0 100 100" aria-hidden="true">${drawing}</svg></div>`;
}
function productCard(p, compact = false) {
  return `<article class="product ${compact ? "compact" : ""}"><button class="product-image" data-detail="${p.id}" aria-label="Подробнее: ${safe(p.name)}">${productArt(p)}${p.id === "latte" ? '<span class="hit">ХИТ</span>' : ""}</button><div class="product-info"><button class="product-name" data-detail="${p.id}">${safe(p.name)}</button><p>${safe(p.desc)}</p><div class="product-bottom"><strong>${money(p.price)}</strong><button class="add-button" data-add="${p.id}" aria-label="Добавить ${safe(p.name)}">${icon("plus")}</button></div></div></article>`;
}
function statusMarkup() {
  return loading
    ? '<div class="empty loading">Загружаем меню…</div>'
    : loadError
      ? '<div class="empty">Не получилось загрузить меню.<button class="secondary" data-action="retry">Попробовать ещё раз</button></div>'
      : "";
}
function homePage() {
  const popular = ["latte", "cappuccino", "raf", "ice-latte"]
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
  return cats
    .slice(1)
    .map((c) => {
      const group = list.filter((p) => p.category === c);
      return group.length
        ? `<section class="menu-group"><h2>${c}</h2><div class="menu-grid">${group.map((p) => productCard(p, true)).join("")}</div></section>`
        : "";
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
    localStorage.setItem("bk-profile", JSON.stringify(profile));
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
function totals() {
  return menu.reduce(
    (s, p) => ({
      qty: s.qty + (cart[p.id] || 0),
      total: s.total + p.price * (cart[p.id] || 0),
    }),
    { qty: 0, total: 0 },
  );
}
function persist() {
  localStorage.setItem("bk-cart", JSON.stringify(cart));
  drawCart();
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
function addProduct(id, qty = 1) {
  if (!menu.some((p) => p.id === id)) return;
  if ((cart[id] || 0) >= 20) {
    toast("Можно добавить не больше 20 порций");
    return;
  }
  cart[id] = Math.min(20, (cart[id] || 0) + qty);
  persist();
  tg?.HapticFeedback?.impactOccurred("light");
  toast("Добавлено в корзину");
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
  $("#sheet").focus();
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
  openSheet(
    `${head(safe(p.name))}<div class="detail-image">${productArt(p)}</div><div class="detail-description"><h3>${safe(p.name)} <span>${money(p.price)}</span></h3><p>${safe(p.desc)}</p><p class="fine">Базовая порция из меню. Уточнить состав можно у бариста.</p></div><button class="primary full" data-detail-add="${p.id}">Добавить в корзину · ${money(p.price)} ${icon("plus")}</button>`,
  );
}
function openCart() {
  const items = menu.filter((p) => cart[p.id]),
    { total } = totals();
  openSheet(
    `${head("Корзина")}${items.length ? `<div class="cart-list">${items.map((p) => `<div class="cart-row"><div class="cart-image">${productArt(p)}</div><div class="cart-item-info"><b>${safe(p.name)}</b><small>${money(p.price)} / шт.</small><div class="qty"><button data-dec="${p.id}" aria-label="Убрать один ${safe(p.name)}">−</button><span>${cart[p.id]}</span><button data-inc="${p.id}" aria-label="Добавить один ${safe(p.name)}" ${cart[p.id] >= 20 ? "disabled" : ""}>+</button></div></div><strong>${money(p.price * cart[p.id])}</strong></div>`).join("")}</div><div class="cart-coins">${coin()}<span>Начислим за этот заказ</span><b>+${Math.floor(total * 0.05)} коинов</b></div><div class="total-row"><span>Итого</span><strong>${money(total)}</strong></div><form id="checkoutForm"><div class="choice-row"><button type="button" class="choice ${type === "pickup" ? "selected" : ""}" data-type="pickup">${icon("bag")}С собой</button><button type="button" class="choice ${type === "here" ? "selected" : ""}" data-type="here">${icon("chair")}В кофейне</button></div><label class="form-label" for="branch">Город</label><select id="branch"><option ${branch === "Волжский" ? "selected" : ""}>Волжский</option><option ${branch === "Волгоград" ? "selected" : ""}>Волгоград</option></select><label class="form-label" for="customerName">Твоё имя</label><input id="customerName" autocomplete="name" placeholder="Имя" maxlength="80" required value="${safe(profile.name || "")}"><label class="form-label" for="customerPhone">Телефон для заказа</label><input id="customerPhone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00" maxlength="30" required value="${safe(profile.phone || "")}"><p class="fine">Оплата при получении. Выбор конкретной точки пока недоступен — кофейня уточнит место выдачи по телефону.</p><button class="primary full" id="submitOrder">Оформить заказ · ${money(total)} ${icon("arrow")}</button></form>` : `<div class="empty">${icon("bag")}<h3>Здесь будет твой кофе</h3><p>Добавь что-нибудь вкусное из меню.</p><button class="primary" data-action="toMenu">Выбрать напиток ${icon("arrow")}</button></div>`}`,
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
        items: menu
          .filter((p) => cart[p.id])
          .map((p) => ({ id: p.id, qty: cart[p.id] })),
        customer: profile,
        branch,
        type,
      }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Не удалось оформить заказ");
    localStorage.setItem("bk-profile", JSON.stringify(profile));
    localStorage.setItem("bk-branch", branch);
    localStorage.setItem("bk-coins", String(coins() + result.coinsEarned));
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
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.add) addProduct(b.dataset.add);
  if (b.dataset.detail) productDetail(b.dataset.detail);
  if (b.dataset.detailAdd) {
    addProduct(b.dataset.detailAdd);
    closeSheet();
  }
  if (b.dataset.cat) {
    selected = b.dataset.cat;
    render();
  }
  if (b.dataset.order) {
    type = b.dataset.order;
    location.hash = "menu";
  }
  if (b.dataset.inc || b.dataset.dec) {
    saveCheckoutDraft();
    const id = b.dataset.inc || b.dataset.dec;
    cart[id] = Math.min(20, (cart[id] || 0) + (b.dataset.inc ? 1 : -1));
    if (cart[id] <= 0) delete cart[id];
    persist();
    openCart();
  }
  if (b.dataset.type) {
    saveCheckoutDraft();
    type = b.dataset.type;
    openCart();
  }
  if (b.dataset.city) {
    branch = b.dataset.city;
    localStorage.setItem("bk-branch", branch);
    render();
    closeSheet();
    toast("Выбран город: " + branch);
  }
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
  actions[b.dataset.action]?.();
});
$("#locationTop").onclick = openLocation;
$("#cartTop").onclick = $("#floatingCart").onclick = openCart;
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
      last = focusables.at(-1);
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
  window.scrollTo({ top: 0, behavior: "instant" });
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
    cart = Object.fromEntries(
      Object.entries(cart)
        .filter(
          ([id, qty]) =>
            menu.some((p) => p.id === id) && Number.isInteger(qty) && qty > 0,
        )
        .map(([id, qty]) => [id, Math.min(20, qty)]),
    );
    persist();
  } catch {
    loadError = true;
  } finally {
    loading = false;
    render();
    drawCart();
  }
}
hydrateIcons();
loadMenu();
