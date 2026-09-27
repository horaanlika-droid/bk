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
    "id": "хот-дог-бк",
    "name": "Хот-дог БК",
    "category": "Еда",
    "price": 230,
    "desc": "Чиабатта, сосиска маринованная, капуста, лук, сыр, соус гриль"
  },
  {
    "id": "с-курицей",
    "name": "С курицей",
    "category": "Еда",
    "price": 230,
    "desc": "Рулет куриный, огурец, капуста, горошек свежий, айсберг, соус фирменный"
  },
  {
    "id": "ветчина-сыр",
    "name": "Ветчина-сыр",
    "category": "Еда",
    "price": 245,
    "desc": "Ветчина, сыр гауда, томаты, айсберг, соус фирменный"
  },
  {
    "id": "с-огурком",
    "name": "С огурком",
    "category": "Еда",
    "price": 240,
    "desc": "Огурок, томаты, капуста, горошек свежий, айсберг, соус фирменный"
  },
  {
    "id": "с-соусом-песто",
    "name": "С соусом песто",
    "category": "Еда",
    "price": 245,
    "desc": "Куриный рулет, томаты, айсберг, крем-чиз, соус песто"
  },
  {
    "id": "new-york",
    "name": "New York",
    "category": "Еда",
    "price": 260,
    "desc": "Салями, томаты, айсберг, крем-чиз"
  },
  {
    "id": "с-тунцом",
    "name": "С тунцом",
    "category": "Еда",
    "price": 240,
    "desc": "Тунец, огурцы маринованные, капуста, горошек свежий, айсберг, соус фирменный"
  },
  {
    "id": "с-лососем-и-крем-чизом",
    "name": "С лососем и крем-чизом",
    "category": "Еда",
    "price": 345,
    "desc": "Лосось слабосолёный, огурец, айсберг, крем-чиз, соус фирменный"
  },
  {
    "id": "брат-мясника",
    "name": "Брат мясника",
    "category": "Еда",
    "price": 280,
    "desc": "Куриный рулет, ветчина, салями, томаты, огурцы, капуста, горошек свежий, айсберг, соус фирменный"
  },
  {
    "id": "дон-бекон",
    "name": "Дон Бекон",
    "category": "Еда",
    "price": 250,
    "desc": "Бекон обжаренный, огурцы маринованные, капуста, айсберг, соус барбекю"
  },
  {
    "id": "цезарь",
    "name": "Цезарь",
    "category": "Еда",
    "price": 250,
    "desc": "Куриное филе, сыр, салат, томаты, айсберг, соус фирменный"
  },
  {
    "id": "чикен-фреш",
    "name": "Чикен фреш",
    "category": "Еда",
    "price": 280,
    "desc": "Маринованное куриное филе, огурцы, томаты, айсберг"
  },
  {
    "id": "чикен-гриль",
    "name": "Чикен гриль",
    "category": "Еда",
    "price": 310,
    "desc": "Куриное филе гриль, томаты, айсберг, соус гриль"
  },
  {
    "id": "вегетарианский",
    "name": "Вегетарианский",
    "category": "Еда",
    "price": 230,
    "desc": "Сыр, томаты, маринованная капуста, горошек свежий, айсберг"
  },
  {
    "id": "ролл-16",
    "name": "Ролл 16",
    "category": "Еда",
    "price": 230,
    "desc": "Ветчина, капуста, огурец, соус гриль"
  },
  {
    "id": "милано",
    "name": "Милано",
    "category": "Еда",
    "price": 260,
    "desc": "Ветчина, моцарелла, томаты, соус фирменный"
  },
  {
    "id": "чикен-чиз",
    "name": "Чикен-чиз",
    "category": "Еда",
    "price": 260,
    "desc": "Куриный рулет, капуста, огурцы, горошек свежий, сыр моцарелла, соус фирменный"
  },
  {
    "id": "мит-чиз",
    "name": "Мит-чиз",
    "category": "Еда",
    "price": 255,
    "desc": "Огурец, сыр моцарелла, томаты, соус фирменный"
  },
  {
    "id": "маргарита",
    "name": "Маргарита",
    "category": "Еда",
    "price": 230,
    "desc": "Сыр моцарелла, томаты, соус барбекю"
  },
  {
    "id": "маргарита-сальчичон",
    "name": "Маргарита сальчичон",
    "category": "Еда",
    "price": 260,
    "desc": "Сальчичон, сыр моцарелла, томаты, соус барбекю"
  },
  {
    "id": "фиш-чиз",
    "name": "Фиш-чиз",
    "category": "Еда",
    "price": 255,
    "desc": "Тунец, огурцы маринованные, сыр моцарелла, соус фирменный"
  },
  {
    "id": "клаб",
    "name": "Клаб",
    "category": "Еда",
    "price": 285,
    "desc": "Огурец, куриный рулет, ветчина, сальчичон, томаты, горошек свежий, сыр моцарелла, соус фирменный"
  },
  {
    "id": "наггетсы-6-шт",
    "name": "Наггетсы 6 шт.",
    "category": "Еда",
    "price": 119,
    "desc": ""
  },
  {
    "id": "наггетсы-12-шт",
    "name": "Наггетсы 12 шт.",
    "category": "Еда",
    "price": 179,
    "desc": ""
  },
  {
    "id": "фирменный-соус",
    "name": "Фирменный соус",
    "category": "Еда",
    "price": 40,
    "desc": ""
  },
  {
    "id": "соус-барбекю",
    "name": "Соус барбекю",
    "category": "Еда",
    "price": 40,
    "desc": ""
  },
  {
    "id": "соус-гриль",
    "name": "Соус гриль",
    "category": "Еда",
    "price": 40,
    "desc": ""
  },
  {
    "id": "перец-халапеньо",
    "name": "Перец халапеньо",
    "category": "Еда",
    "price": 35,
    "desc": ""
  },
  {
    "id": "овощи",
    "name": "Овощи",
    "category": "Еда",
    "price": 55,
    "desc": ""
  },
  {
    "id": "мясо",
    "name": "Мясо",
    "category": "Еда",
    "price": 70,
    "desc": ""
  },
  {
    "id": "крем-сыр",
    "name": "Крем-сыр",
    "category": "Еда",
    "price": 55,
    "desc": ""
  },
  {
    "id": "моцарелла",
    "name": "Моцарелла",
    "category": "Еда",
    "price": 55,
    "desc": ""
  },
  {
    "id": "эспрессо",
    "name": "Эспрессо",
    "category": "Кофе",
    "price": 140,
    "desc": "30/60 мл · профессиональная кофемашина 155/180 ₽"
  },
  {
    "id": "американо",
    "name": "Американо",
    "category": "Кофе",
    "price": 160,
    "desc": "150/300 мл · профессиональная кофемашина 180/200 ₽"
  },
  {
    "id": "cappuccino",
    "name": "Капучино",
    "category": "Кофе",
    "price": 180,
    "desc": "250/400 мл · профессиональная кофемашина 210/250 ₽"
  },
  {
    "id": "большой-латте",
    "name": "Большой латте",
    "category": "Кофе",
    "price": 200,
    "desc": "400 мл · профессиональная кофемашина 250 ₽"
  },
  {
    "id": "большой-латте-со-сливками",
    "name": "Большой латте со сливками",
    "category": "Кофе",
    "price": 270,
    "desc": "400 мл · профессиональная кофемашина 295 ₽"
  },
  {
    "id": "большой-латте-со-сгущёнкой",
    "name": "Большой латте со сгущёнкой",
    "category": "Кофе",
    "price": 270,
    "desc": "400 мл · профессиональная кофемашина 295 ₽"
  },
  {
    "id": "большой-матча-латте",
    "name": "Большой матча-латте",
    "category": "Кофе",
    "price": 210,
    "desc": "400 мл · профессиональная кофемашина 275 ₽"
  },
  {
    "id": "большой-раф",
    "name": "Большой раф",
    "category": "Кофе",
    "price": 245,
    "desc": "350 мл · профессиональная кофемашина 285 ₽"
  },
  {
    "id": "флэт-уайт",
    "name": "Флэт уайт",
    "category": "Кофе",
    "price": 205,
    "desc": "300 мл · профессиональная кофемашина 240 ₽"
  },
  {
    "id": "кофе-по-венски",
    "name": "Кофе по-венски",
    "category": "Кофе",
    "price": 210,
    "desc": "250/450 мл · профессиональная кофемашина 235/285 ₽"
  },
  {
    "id": "красный-глаз",
    "name": "Красный глаз",
    "category": "Кофе",
    "price": 180,
    "desc": "180 мл · профессиональная кофемашина 200 ₽"
  },
  {
    "id": "ройбушино",
    "name": "Ройбушино",
    "category": "Кофе",
    "price": 210,
    "desc": "250/400 мл · 210/250 ₽"
  },
  {
    "id": "какао",
    "name": "Какао",
    "category": "Кофе",
    "price": 220,
    "desc": "400 мл"
  },
  {
    "id": "дабл-какао",
    "name": "Дабл какао",
    "category": "Кофе",
    "price": 280,
    "desc": "400 мл"
  },
  {
    "id": "snickers-hot",
    "name": "Snickers Hot",
    "category": "Кофе",
    "price": 290,
    "desc": "400 мл"
  },
  {
    "id": "горячий-шоколад",
    "name": "Горячий шоколад",
    "category": "Кофе",
    "price": 260,
    "desc": "150 мл"
  },
  {
    "id": "чай",
    "name": "Чай",
    "category": "Чай",
    "price": 140,
    "desc": "400 мл"
  },
  {
    "id": "чай-tasteabrew",
    "name": "Чай TasteaBrew",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл"
  },
  {
    "id": "чай-bags",
    "name": "Чай Bags",
    "category": "Чай",
    "price": 70,
    "desc": "250 мл"
  },
  {
    "id": "облепиховый-чай",
    "name": "Облепиховый чай",
    "category": "Чай",
    "price": 220,
    "desc": "400 мл"
  },
  {
    "id": "вишнёвый-пунш",
    "name": "Вишнёвый пунш",
    "category": "Чай",
    "price": 210,
    "desc": "400 мл"
  },
  {
    "id": "глинтвейн-б-а",
    "name": "Глинтвейн б/а",
    "category": "Чай",
    "price": 210,
    "desc": "400 мл"
  },
  {
    "id": "марокканский-мятный-чай",
    "name": "Марокканский мятный чай",
    "category": "Чай",
    "price": 230,
    "desc": "400 мл"
  },
  {
    "id": "малина-имбирь",
    "name": "Малина-имбирь",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл"
  },
  {
    "id": "лимон-имбирь",
    "name": "Лимон-имбирь",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл"
  },
  {
    "id": "пряный-пунш",
    "name": "Пряный пунш",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл"
  },
  {
    "id": "брусничный-глинтвейн",
    "name": "Брусничный глинтвейн",
    "category": "Чай",
    "price": 220,
    "desc": "400 мл"
  },
  {
    "id": "гляссе",
    "name": "Гляссе",
    "category": "Напитки",
    "price": 255,
    "desc": "200/400 мл · 255/310 ₽"
  },
  {
    "id": "аффогато",
    "name": "Аффогато",
    "category": "Напитки",
    "price": 330,
    "desc": "350 мл"
  },
  {
    "id": "матча-аффогато",
    "name": "Матча-аффогато",
    "category": "Напитки",
    "price": 330,
    "desc": "350 мл"
  },
  {
    "id": "манговый-латте",
    "name": "Манговый латте",
    "category": "Напитки",
    "price": 320,
    "desc": "400/650 мл · 320/395 ₽"
  },
  {
    "id": "ice-latte",
    "name": "Айс-латте",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "айс-раф",
    "name": "Айс-раф",
    "category": "Напитки",
    "price": 255,
    "desc": "500 мл"
  },
  {
    "id": "айс-матча",
    "name": "Айс-матча",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "айс-ти",
    "name": "Айс-ти",
    "category": "Напитки",
    "price": 180,
    "desc": "500 мл"
  },
  {
    "id": "марокканский-мятный-чай",
    "name": "Марокканский мятный чай",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "облепиховый-чай",
    "name": "Облепиховый чай",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "молочный-коктейль",
    "name": "Молочный коктейль",
    "category": "Напитки",
    "price": 260,
    "desc": "500 мл"
  },
  {
    "id": "молочный-коктейль-с-ванилью",
    "name": "Молочный коктейль с ванилью",
    "category": "Напитки",
    "price": 290,
    "desc": "450 мл"
  },
  {
    "id": "шоколадный-взрыв",
    "name": "Шоколадный взрыв",
    "category": "Напитки",
    "price": 325,
    "desc": "450 мл"
  },
  {
    "id": "манго-шейк",
    "name": "Манго-шейк",
    "category": "Напитки",
    "price": 290,
    "desc": "500 мл"
  },
  {
    "id": "банановый-смузи",
    "name": "Банановый смузи",
    "category": "Напитки",
    "price": 320,
    "desc": "400/650 мл · 320/395 ₽"
  },
  {
    "id": "фраппе",
    "name": "Фраппе",
    "category": "Напитки",
    "price": 190,
    "desc": "300 мл"
  },
  {
    "id": "фраппучино",
    "name": "Фраппучино",
    "category": "Напитки",
    "price": 230,
    "desc": "500 мл"
  },
  {
    "id": "бамбл-кофе",
    "name": "Бамбл кофе",
    "category": "Напитки",
    "price": 260,
    "desc": "500 мл"
  },
  {
    "id": "клубничный-холодный-чай",
    "name": "Клубничный холодный чай",
    "category": "Напитки",
    "price": 320,
    "desc": "400/650 мл · 320/395 ₽"
  },
  {
    "id": "мороженое",
    "name": "Мороженое",
    "category": "Напитки",
    "price": 165,
    "desc": "100 мл"
  },
  {
    "id": "классический-лимонад",
    "name": "Классический лимонад",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "лимонад-сицилийский",
    "name": "Лимонад сицилийский",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "лимонад-аранчата",
    "name": "Лимонад аранчата",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "матча-апельсин",
    "name": "Матча-апельсин",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл"
  },
  {
    "id": "клубника-в-сливках",
    "name": "Клубника в сливках",
    "category": "Напитки",
    "price": 240,
    "desc": "500 мл"
  },
  {
    "id": "крем-сода",
    "name": "Крем-сода",
    "category": "Напитки",
    "price": 240,
    "desc": "500 мл"
  },
  {
    "id": "грейпфрут",
    "name": "Грейпфрут",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "летний",
    "name": "Летний",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "розовая-пантера",
    "name": "Розовая пантера",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "тархун",
    "name": "Тархун",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "гренадин-лаванда",
    "name": "Гренадин-лаванда",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "пина-колада",
    "name": "Пина колада",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "мохито-клубничный",
    "name": "Мохито клубничный",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл"
  },
  {
    "id": "малина-маракуйя",
    "name": "Малина-маракуйя",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл"
  },
  {
    "id": "малиновый-грейпфрут",
    "name": "Малиновый грейпфрут",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл"
  },
  {
    "id": "малина-имбирь",
    "name": "Малина-имбирь",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл"
  },
  {
    "id": "лимон-имбирь",
    "name": "Лимон-имбирь",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл"
  },
  {
    "id": "голубая-лагуна",
    "name": "Голубая лагуна",
    "category": "Напитки",
    "price": 170,
    "desc": "450 мл"
  },
  {
    "id": "бабл-гам",
    "name": "Бабл гам",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "клубника-со-сливками",
    "name": "Клубника со сливками",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "вишнёвый",
    "name": "Вишнёвый",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "цветок-жасмина",
    "name": "Цветок жасмина",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  },
  {
    "id": "роса-розы",
    "name": "Роса розы",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл"
  }
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
