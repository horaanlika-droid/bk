// Team page: stop/go lists, kitchen recipe cards, today's shift roster and an
// internal question board. There is no login form: the page is opened from the
// bot, Telegram confirms who the user is, and every admin gets the full tool
// set. Changes are signed with the admin's name. Kept to ES2020 like app.js
// for older WebViews.
const $ = (s) => document.querySelector(s);
const safe = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};
let token = store.get("bk-staff-token") || "";
let me = null;
try {
  me = JSON.parse(store.get("bk-staff-me")) || null;
} catch {
  me = null;
}
let state = {
  stop: [],
  go: [],
  shift: [],
  board: [],
  recipes: {},
  menu: [],
  permissions: { viewStations: [], manageStations: [], recipes: false, shift: true, board: true },
};
let tab = "stop";
let station = "Кухня";
let shiftRole = "Бар";
let selectedRecipeId = "";
let pollTimer = null;
const staffPermissions = () =>
  state.permissions ||
  (me && me.permissions) ||
  { viewStations: [], manageStations: [], recipes: false, shift: true, board: true };

function toast(text, ms = 3000) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("#announcements").append(el);
  setTimeout(() => el.remove(), ms);
}
function showLoginError(message) {
  const el = $("#loginError");
  if (!el || !message) return;
  el.textContent = message;
  el.hidden = false;
}
function logout(message) {
  token = "";
  me = null;
  store.remove("bk-staff-token");
  store.remove("bk-staff-me");
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  show();
  showLoginError(message);
}
async function api(path, body) {
  const options = body
    ? {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Staff-Token": token,
        },
        body: JSON.stringify(body),
      }
    : { headers: { "X-Staff-Token": token }, cache: "no-store" };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    logout(data.error || "Сессия истекла — войди заново");
    throw new Error(data.error || "Сессия истекла");
  }
  if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
  return data;
}
async function refresh(silent) {
  try {
    const data = await api("/api/staff/state");
    state = data;
    if (data.me) {
      me = data.me;
      store.set("bk-staff-me", JSON.stringify(me));
    }
    renderTab();
  } catch (err) {
    if (!silent) toast("Не получилось обновить: " + err.message, 5000);
  }
}
// Every action returns the fresh state, so the whole team sees the change on
// the next poll and the author immediately.
async function act(path, body, okText) {
  try {
    const data = await api(path, body);
    state = { ...state, ...data };
    renderTab();
    if (okText) toast(okText);
  } catch (err) {
    toast(err.message, 5000);
  }
}
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toTimeString().slice(0, 5);
};
const signature = (entry) =>
  [when(entry.at), entry.by].filter(Boolean).join(" · ");
const stationTag = (s) =>
  `<span class="station ${s === "Бар" ? "bar" : ""}">${safe(s)}</span>`;

// --- Стоп-лист и гоу-лист -------------------------------------------------
function listTab(kind) {
  const isStop = kind === "stop";
  const permissions = staffPermissions();
  const viewStations = permissions.viewStations || [];
  const manageStations = permissions.manageStations || [];
  if (manageStations.length && !manageStations.includes(station))
    station = manageStations[0];
  const entries = (state[kind] || []).filter((entry) =>
    viewStations.includes(entry.station),
  );
  const canManage = manageStations.length > 0;
  const stationPicker =
    manageStations.length > 1
      ? `<div class="chips" role="group" aria-label="Станция">${manageStations
          .map(
            (s) =>
              `<button type="button" data-station="${s}" class="${station === s ? "selected" : ""}">${s}</button>`,
          )
          .join("")}</div>`
      : `<p class="fine">Рабочая зона: <b>${safe(manageStations[0] || "только просмотр")}</b></p>`;
  const form = canManage
    ? `<div class="tool-card"><h2>${isStop ? "Поставить на стоп" : "Добавить в гоу-лист"}</h2>
  <p class="hint">${
    isStop
      ? "Найдите позицию по ключевым словам и выберите её из меню. Она пропадёт из продажи у гостей, а заказ с ней не пройдёт."
      : "Найдите позицию по ключевым словам и выберите её из меню. Гоу-лист подсказывает, что сегодня предлагаем в первую очередь."
  }</p>
  <form id="listForm">
    <div class="row"><input id="itemSearch" placeholder="Ключевые слова для поиска в меню…" maxlength="80" autocomplete="off"></div>
    <div id="menuMatches" class="menu-matches" aria-live="polite"><p class="fine">Начните вводить название блюда или напитка.</p></div>
    <input id="selectedItemId" type="hidden" required>
    ${isStop ? "" : '<div class="row"><input id="itemNote" placeholder="Комментарий (по желанию): почему предлагаем" maxlength="120"></div>'}
    ${stationPicker}
    <button class="primary full" type="submit">${isStop ? "В стоп-лист" : "В гоу-лист"}</button>
  </form></div>`
    : '<div class="tool-card"><h2>Только просмотр</h2><p class="hint">Изменять стоп- и гоу-листы может повар своей кухни, бариста своего бара или администратор.</p></div>';
  return `${form}
  <p class="list-title">${isStop ? "Сейчас на стопе" : "Сейчас в гоу-листе"}</p>
  ${
    entries.length
      ? entries
          .map(
            (e) => `<div class="entry">${stationTag(e.station)}<div class="entry-info"><b>${safe(e.name)}</b><small>${safe([signature(e), e.note].filter(Boolean).join(" · "))}</small></div>${manageStations.includes(e.station) ? `<div class="entry-actions"><button data-remove="${kind}:${safe(e.id)}">${isStop ? "Вернуть в продажу" : "Убрать"}</button></div>` : ""}</div>`,
          )
          .join("")
      : `<div class="empty-list">${isStop ? "Стоп-лист пуст — всё в продаже 👌" : "Гоу-лист пуст. Добавь, что сегодня продаём активнее."}</div>`
  }`;
}
function bindListTab(kind) {
  const form = $("#listForm");
  if (!form) return;
  const search = $("#itemSearch");
  const matches = $("#menuMatches");
  const selected = $("#selectedItemId");
  let selectedName = "";
  const renderMatches = () => {
    const words = search.value
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .split(/[^a-zа-я0-9]+/i)
      .filter(Boolean);
    selected.value = "";
    selectedName = "";
    if (!words.length) {
      matches.innerHTML = '<p class="fine">Начните вводить название блюда или напитка.</p>';
      return;
    }
    const found = (state.menu || [])
      .filter((item) => item.station === station)
      .map((item) => ({
        item,
        haystack: [item.name, item.category, item.group]
          .join(" ").toLocaleLowerCase("ru").replace(/ё/g, "е"),
      }))
      .filter(({ haystack }) => words.every((word) => haystack.includes(word)))
      .slice(0, 8);
    matches.innerHTML = found.length
      ? found.map(({ item }) => `<button type="button" class="menu-match" data-pick-item="${safe(item.id)}" data-pick-name="${safe(item.name)}"><b>${safe(item.name)}</b><small>${safe(item.category)} · ${safe(item.station)}</small></button>`).join("")
      : '<p class="fine">В этой станции совпадений нет. Попробуйте другие ключевые слова.</p>';
  };
  search.addEventListener("input", renderMatches);
  matches.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick-item]");
    if (!button) return;
    selected.value = button.dataset.pickItem;
    selectedName = button.dataset.pickName;
    search.value = selectedName;
    matches.innerHTML = `<p class="selected-menu-item">Выбрано из меню: <b>${safe(selectedName)}</b></p>`;
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!selected.value) {
      toast("Сначала найдите и выберите позицию из меню", 4000);
      search.focus();
      return;
    }
    act(
      "/api/staff/" + kind,
      {
        itemId: selected.value,
        name: selectedName,
        station,
        note: $("#itemNote") ? $("#itemNote").value.trim() : "",
      },
      kind === "stop" ? "Поставлено на стоп" : "Добавлено в гоу-лист",
    );
  });
}

// --- Технологические карты кухни -----------------------------------------
function recipesTab() {
  const dishes = (state.menu || []).filter((item) => item.category === "Еда");
  const recipes = state.recipes || {};
  if (!dishes.length)
    return '<div class="empty-list">В меню пока нет блюд кухни.</div>';
  if (!dishes.some((item) => item.id === selectedRecipeId))
    selectedRecipeId = dishes[0].id;
  const recipe = recipes[selectedRecipeId] || {};
  const filled = dishes.filter((item) => recipes[item.id] && recipes[item.id].text).length;
  const options = dishes
    .map(
      (item) =>
        `<option value="${safe(item.id)}" ${item.id === selectedRecipeId ? "selected" : ""}>${safe(item.name)}${item.group ? " · " + safe(item.group) : ""}</option>`,
    )
    .join("");
  return `<div class="tool-card"><h2>Технологическая карта блюда</h2>
  <p class="hint">Добавьте порядок действий, подготовку и важные детали. При новом заказе алгоритм отправится в Telegram рядом с заказом.</p>
  <p class="fine">Заполнено карт: ${filled} из ${dishes.length}.</p>
  <form id="recipeForm">
    <label class="form-label" for="recipeDish">Блюдо</label>
    <select id="recipeDish" required>${options}</select>
    <label class="form-label" for="recipeText">Алгоритм действий</label>
    <textarea id="recipeText" maxlength="2000" placeholder="Например: 1. Подготовить…\n2. Приготовить…\n3. Проверить подачу…" required>${safe(recipe.text || "")}</textarea>
    <p class="fine">До 2 000 символов. Указания по количеству заказа бот покажет рядом с картой.</p>
    <button class="primary full" type="submit">Сохранить техкарту</button>
  </form>
  ${recipe.text ? `<div class="entry"><div class="entry-info"><b>Карта сохранена</b><small>${safe([signature(recipe), recipe.by ? "автор: " + recipe.by : ""].filter(Boolean).join(" · "))}</small></div><div class="entry-actions"><button class="danger" type="button" data-clear-recipe="${safe(selectedRecipeId)}">Удалить</button></div></div>` : ""}
  </div>`;
}
function bindRecipesTab() {
  const select = $("#recipeDish");
  if (select)
    select.addEventListener("change", () => {
      selectedRecipeId = select.value;
      renderTab();
    });
  const form = $("#recipeForm");
  if (form)
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      act(
        "/api/staff/recipes",
        { itemId: $("#recipeDish").value, text: $("#recipeText").value },
        "Технологическая карта сохранена",
      );
    });
}

// --- Смена ------------------------------------------------------------------
function shiftTab() {
  const roles = ["Бар", "Кухня", "Касса"];
  const mine = me ? me.name : "";
  const onShift = me && state.shift.some((s) => s.name === me.name);
  return `<div class="tool-card"><h2>Кто сегодня на смене</h2>
  <p class="hint">Список обнуляется каждый день сам. Отметь себя или коллегу — команде и админам видно, кто работает.</p>
  <form id="shiftForm"><div class="row"><input id="shiftName" placeholder="Имя" maxlength="60" value="${onShift ? "" : safe(mine)}" required></div>
  <div class="chips" role="group" aria-label="Роль">
    ${roles.map((r) => `<button type="button" data-role="${r}" class="${shiftRole === r ? "selected" : ""}">${r}</button>`).join("")}
  </div>
  <button class="primary full" type="submit">Отметить на смене</button></form></div>
  <p class="list-title">Сегодня работают</p>
  ${
    state.shift.length
      ? state.shift
          .map(
            (s) => `<div class="entry">${stationTag(s.role === "Касса" ? "Бар" : s.role)}<div class="entry-info"><b>${safe(s.name)}</b><small>${safe(s.role)} · с ${when(s.at)}</small></div><div class="entry-actions"><button data-remove="shift:${safe(s.id)}">Снять</button></div></div>`,
          )
          .join("")
      : '<div class="empty-list">Пока никто не отметился. Начни с себя ☕</div>'
  }`;
}

// --- Вопросы ------------------------------------------------------------------
function boardTab() {
  return `<div class="tool-card"><h2>Внутренние вопросы</h2>
  <p class="hint">Заканчивается ростер? Сломалась кофемолка? Нужно поменяться сменами? Пиши сюда — решённое отмечаем галочкой.</p>
  <form id="boardForm"><textarea id="boardText" placeholder="Что случилось или что нужно решить…" maxlength="500" required></textarea>
  <button class="primary full" type="submit">Отправить</button></form></div>
  <p class="list-title">Лента</p>
  ${
    state.board.length
      ? state.board
          .map(
            (n) => `<div class="entry ${n.done ? "done" : ""}"><div class="entry-info"><b>${safe(n.text)}</b><small>${safe(signature(n))}${n.done ? " · решено" : ""}</small></div><div class="entry-actions"><button data-toggle="${safe(n.id)}">${n.done ? "Вернуть" : "Решено"}</button><button class="danger" data-remove="board:${safe(n.id)}">×</button></div></div>`,
          )
          .join("")
      : '<div class="empty-list">Вопросов нет — отличная смена 🎉</div>'
  }`;
}

function renderTab() {
  const permissions = staffPermissions();
  const allowed = {
    stop: (permissions.viewStations || []).length > 0,
    go: (permissions.viewStations || []).length > 0,
    shift: !!permissions.shift,
    board: !!permissions.board,
    recipes: !!permissions.recipes,
  };
  const available = Object.keys(allowed).filter((key) => allowed[key]);
  if (!allowed[tab]) tab = available[0] || "shift";
  const counts = {
    stop: "#stopCount",
    go: "#goCount",
    board: "#boardCount",
    recipes: "#recipeCount",
  };
  for (const [key, selector] of Object.entries(counts)) {
    const list =
      key === "board"
        ? (state.board || []).filter((entry) => !entry.done)
        : key === "recipes"
          ? Object.values(state.recipes || {}).filter((entry) => entry && entry.text)
          : state[key] || [];
    const badge = $(selector);
    badge.textContent = list.length;
    badge.hidden = !list.length;
  }
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.hidden = !allowed[button.dataset.tab];
    button.classList.toggle("selected", button.dataset.tab === tab);
  });
  const views = {
    stop: () => listTab("stop"),
    go: () => listTab("go"),
    shift: shiftTab,
    board: boardTab,
    recipes: recipesTab,
  };
  $("#tabContent").innerHTML = views[tab]();
  if (tab === "stop" || tab === "go") bindListTab(tab);
  if (tab === "recipes") bindRecipesTab();
  if (tab === "shift")
    $("#shiftForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#shiftName").value.trim();
      if (!name) return;
      act(
        "/api/staff/shift",
        { name, role: shiftRole },
        name + " на смене — хорошего дня!",
      );
    });
  if (tab === "board")
    $("#boardForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = $("#boardText").value.trim();
      if (!text) return;
      act("/api/staff/board", { text }, "Записано");
    });
}

function show() {
  const authed = !!token;
  $("#login").hidden = authed;
  $("#panel").hidden = !authed;
  $("#logout").hidden = !authed;
  $("#me").hidden = !authed || !me;
  if (me) $("#me").textContent = me.name + " · " + me.role;
  if (authed) {
    refresh(true);
    if (!pollTimer) pollTimer = setInterval(() => refresh(true), 30000);
  }
}

// Entrance. Opened from the bot, Telegram's signed initData is the password;
// a one-time link from the bot (…/staff#key=…) covers a plain browser. The key
// is wiped from the address bar so a used link is never left lying around.
const initData = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initData || "" : "";
async function start() {
  try {
    if (window.Telegram && window.Telegram.WebApp) {
      try {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      } catch (err) {}
    }
    if (token) return show();
    const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const key = hash.get("key");
    let data;
    if (key) {
      data = await api("/api/staff/key", { key });
      if (history.replaceState)
        history.replaceState(null, "", location.pathname + location.search);
    } else if (initData) {
      data = await api("/api/staff/telegram", { initData });
    } else {
      return logout(
        "Откройте страницу из бота: меню администратора → «🛠 Открыть /staff».",
      );
    }
    token = data.token;
    me = data.me;
    store.set("bk-staff-token", token);
    store.set("bk-staff-me", JSON.stringify(me));
    show();
    toast("Привет, " + me.name + "!");
  } catch (err) {
    logout(err.message);
  }
}
$("#logout").addEventListener("click", () => {
  api("/api/staff/logout", {}).catch(() => {});
  logout("До встречи!");
});
// One listener for tabs, chips and list actions: a single broken handler must
// not take down the rest of the page.
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.tab) {
      tab = b.dataset.tab;
      renderTab();
    }
    if (b.dataset.station) {
      station = b.dataset.station;
      renderTab();
    }
    if (b.dataset.role) {
      shiftRole = b.dataset.role;
      document
        .querySelectorAll("[data-role]")
        .forEach((x) => x.classList.toggle("selected", x.dataset.role === shiftRole));
    }
    if (b.dataset.remove) {
      const parts = b.dataset.remove.split(":");
      act(
        "/api/staff/" + parts[0],
        { action: "remove", id: parts[1] },
        parts[0] === "stop" ? "Снято со стопа" : "Убрано",
      );
    }
    if (b.dataset.toggle)
      act("/api/staff/board", { action: "toggle", id: b.dataset.toggle });
    if (b.dataset.clearRecipe)
      act(
        "/api/staff/recipes",
        { action: "remove", itemId: b.dataset.clearRecipe },
        "Техкарта удалена",
      );
  } catch (err) {
    toast("Что-то пошло не так: " + err.message, 5000);
  }
});
start();
