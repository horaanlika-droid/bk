// Team page: stop list and go list for the kitchen and the bar, today's
// shift roster and an internal question board. Access is personal — the
// admin issues a login and password in the bot (/adduser); the server signs
// every change with the account's name, so «кто поставил стоп» is never a
// guess. Kept to ES2020 like app.js: old WebViews drop the whole script on
// newer syntax.
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
let state = { stop: [], go: [], shift: [], board: [], menu: [] };
let tab = "stop";
let station = "Кухня";
let shiftRole = "Бар";
let pollTimer = null;

function toast(text, ms = 3000) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("#announcements").append(el);
  setTimeout(() => el.remove(), ms);
}
function logout(message) {
  token = "";
  me = null;
  store.remove("bk-staff-token");
  store.remove("bk-staff-me");
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  show();
  if (message) toast(message, 5000);
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
  const entries = state[kind] || [];
  const options = (state.menu || [])
    .map((p) => `<option value="${safe(p.name)}"></option>`)
    .join("");
  return `<div class="tool-card"><h2>${isStop ? "Поставить на стоп" : "Добавить в гоу-лист"}</h2>
  <p class="hint">${
    isStop
      ? "Позиция из меню пропадёт из продажи у гостей: карточка покажет «Стоп», заказ с ней не пройдёт. Можно вписать и то, чего нет в меню — молоко, сироп, тарталетки."
      : "Гоу-лист — что сегодня предлагаем в первую очередь: заканчивается срок, много заготовки, новинка."
  }</p>
  <form id="listForm"><div class="row">
    <input id="itemName" list="menuList" placeholder="Позиция или продукт…" maxlength="80" required>
    <datalist id="menuList">${options}</datalist>
  </div>
  ${isStop ? "" : '<div class="row"><input id="itemNote" placeholder="Комментарий (по желанию): почему предлагаем" maxlength="120"></div>'}
  <div class="chips" role="group" aria-label="Станция">
    ${["Кухня", "Бар"].map((s) => `<button type="button" data-station="${s}" class="${station === s ? "selected" : ""}">${s}</button>`).join("")}
  </div>
  <button class="primary full" type="submit">${isStop ? "В стоп-лист" : "В гоу-лист"}</button></form></div>
  <p class="list-title">${isStop ? "Сейчас на стопе" : "Сейчас в гоу-листе"}</p>
  ${
    entries.length
      ? entries
          .map(
            (e) => `<div class="entry">${stationTag(e.station)}<div class="entry-info"><b>${safe(e.name)}</b><small>${safe([signature(e), e.note].filter(Boolean).join(" · "))}</small></div><div class="entry-actions"><button data-remove="${kind}:${safe(e.id)}">${isStop ? "Вернуть в продажу" : "Убрать"}</button></div></div>`,
          )
          .join("")
      : `<div class="empty-list">${isStop ? "Стоп-лист пуст — всё в продаже 👌" : "Гоу-лист пуст. Добавь, что сегодня продаём активнее."}</div>`
  }`;
}
function bindListTab(kind) {
  $("#listForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#itemName").value.trim();
    if (!name) return;
    const match = (state.menu || []).find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    act(
      "/api/staff/" + kind,
      {
        itemId: match ? match.id : "",
        name,
        station,
        note: $("#itemNote") ? $("#itemNote").value.trim() : "",
      },
      kind === "stop" ? "Поставлено на стоп" : "Добавлено в гоу-лист",
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
  const counts = { stop: "#stopCount", go: "#goCount", board: "#boardCount" };
  for (const [key, sel] of Object.entries(counts)) {
    const list =
      key === "board"
        ? (state.board || []).filter((n) => !n.done)
        : state[key] || [];
    $(sel).textContent = list.length;
    $(sel).hidden = !list.length;
  }
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.tab === tab);
  });
  const views = {
    stop: () => listTab("stop"),
    go: () => listTab("go"),
    shift: shiftTab,
    board: boardTab,
  };
  $("#tabContent").innerHTML = views[tab]();
  if (tab === "stop" || tab === "go") bindListTab(tab);
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

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  $("#loginError").hidden = true;
  try {
    const data = await api("/api/staff/login", {
      login: $("#login-input").value.trim(),
      password: $("#password-input").value,
    });
    token = data.token;
    me = data.me;
    store.set("bk-staff-token", token);
    store.set("bk-staff-me", JSON.stringify(me));
    show();
    toast("Привет, " + me.name + "!");
  } catch (err) {
    $("#loginError").textContent = err.message;
    $("#loginError").hidden = false;
  } finally {
    button.disabled = false;
  }
});
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
      document
        .querySelectorAll("[data-station]")
        .forEach((x) =>
          x.classList.toggle("selected", x.dataset.station === station),
        );
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
  } catch (err) {
    toast("Что-то пошло не так: " + err.message, 5000);
  }
});
show();
