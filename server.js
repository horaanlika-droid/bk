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
const menu = [
  {
    "id": "хот-дог-бк",
    "name": "Хот-дог БК",
    "category": "Еда",
    "price": 230,
    "desc": "Чевапчичи, огурец маринованный, капуста, лук фри, соус гриль",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "с-курицей",
    "name": "С курицей",
    "category": "Еда",
    "price": 230,
    "desc": "Рулет куриный, огурец, капуста, горошек свежий, айсберг, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "ветчина-сыр",
    "name": "Ветчина-сыр",
    "category": "Еда",
    "price": 245,
    "desc": "Ветчина, сыр гауда, томаты, айсберг, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "с-окороком",
    "name": "С окороком",
    "category": "Еда",
    "price": 240,
    "desc": "Окорок, томаты, капуста, горошек свежий, айсберг, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "с-соусом-песто",
    "name": "С соусом песто",
    "category": "Еда",
    "price": 245,
    "desc": "Куриный рулет, томаты, айсберг, крем-чиз, соус песто",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "new-york",
    "name": "New York",
    "category": "Еда",
    "price": 260,
    "desc": "Сальчичон, томаты, айсберг, крем-чиз",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "с-тунцом",
    "name": "С тунцом",
    "category": "Еда",
    "price": 240,
    "desc": "Тунец, огурец маринованный, капуста, горошек свежий, айсберг, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "с-лососем-и-крем-чизом",
    "name": "С лососем и крем-чизом",
    "category": "Еда",
    "price": 345,
    "desc": "Лосось слабосолёный, огурец, айсберг, крем-чиз, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "брат-мясника",
    "name": "Брат мясника",
    "category": "Еда",
    "price": 280,
    "desc": "Куриный рулет, окорок, ветчина, сальчичон, томаты, огурец, капуста, горошек свежий, айсберг, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "дон-бекон",
    "name": "Дон Бекон",
    "category": "Еда",
    "price": 250,
    "desc": "Бекон обжаренный, огурец маринованный, капуста, айсберг, соус барбекю",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "цезарь",
    "name": "Цезарь",
    "category": "Еда",
    "price": 250,
    "desc": "Куриный рулет, сыр гауда, томаты, айсберг, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "чикен-фреш",
    "name": "Чикен фреш",
    "category": "Еда",
    "price": 280,
    "desc": "Наггетсы, крем-чиз, огурец, томаты, айсберг",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "чикен-гриль",
    "name": "Чикен гриль",
    "category": "Еда",
    "price": 310,
    "desc": "Стрипсы, сыр гауда, томаты, айсберг, соус гриль",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "вегетарианский",
    "name": "Вегетарианский",
    "category": "Еда",
    "price": 230,
    "desc": "Сыр тофу, огурец маринованный, капуста, горошек свежий, айсберг, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "ролл-16",
    "name": "Ролл 16",
    "category": "Еда",
    "price": 230,
    "desc": "Чевапчичи, капуста, огурец, соус гриль",
    "group": "Сэндвичи",
    "breads": [
      "лепешка",
      "хлеб",
      "булочка"
    ],
    "extras": true
  },
  {
    "id": "милано",
    "name": "Милано",
    "category": "Еда",
    "price": 260,
    "desc": "Ветчина, моцарелла, томаты, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка"
    ],
    "extras": true
  },
  {
    "id": "чикен-чиз",
    "name": "Чикен-чиз",
    "category": "Еда",
    "price": 260,
    "desc": "Куриный рулет, капуста, огурец, горошек свежий, сыр моцарелла, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка"
    ],
    "extras": true
  },
  {
    "id": "мит-чиз",
    "name": "Мит-чиз",
    "category": "Еда",
    "price": 255,
    "desc": "Окорок, сыр моцарелла, томаты, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка"
    ],
    "extras": true
  },
  {
    "id": "маргарита",
    "name": "Маргарита",
    "category": "Еда",
    "price": 230,
    "desc": "Сыр моцарелла, томаты, соус барбекю",
    "group": "Сэндвичи",
    "breads": [
      "лепешка"
    ],
    "extras": true
  },
  {
    "id": "маргарита-сальчичон",
    "name": "Маргарита сальчичон",
    "category": "Еда",
    "price": 260,
    "desc": "Сальчичон, сыр моцарелла, томаты, соус барбекю",
    "group": "Сэндвичи",
    "breads": [
      "лепешка"
    ],
    "extras": true
  },
  {
    "id": "фиш-чиз",
    "name": "Фиш-чиз",
    "category": "Еда",
    "price": 255,
    "desc": "Тунец, огурец маринованный, сыр моцарелла, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка"
    ],
    "extras": true
  },
  {
    "id": "клаб",
    "name": "Клаб",
    "category": "Еда",
    "price": 285,
    "desc": "Окорок, куриный рулет, ветчина, сальчичон, томаты, огурец, горошек свежий, сыр моцарелла, соус фирменный",
    "group": "Сэндвичи",
    "breads": [
      "лепешка"
    ],
    "extras": true
  },
  {
    "id": "наггетсы-6-шт",
    "name": "Наггетсы 6 шт.",
    "category": "Еда",
    "price": 119,
    "desc": "",
    "group": "Наггетсы"
  },
  {
    "id": "наггетсы-12-шт",
    "name": "Наггетсы 12 шт.",
    "category": "Еда",
    "price": 179,
    "desc": "",
    "group": "Наггетсы"
  },
  {
    "id": "фирменный-соус",
    "name": "Фирменный соус",
    "category": "Еда",
    "price": 40,
    "desc": "",
    "group": "Соусы"
  },
  {
    "id": "соус-барбекю",
    "name": "Соус барбекю",
    "category": "Еда",
    "price": 40,
    "desc": "",
    "group": "Соусы"
  },
  {
    "id": "соус-гриль",
    "name": "Соус гриль",
    "category": "Еда",
    "price": 40,
    "desc": "",
    "group": "Соусы"
  },
  {
    "id": "эспрессо",
    "name": "Эспрессо",
    "category": "Кофе",
    "price": 140,
    "desc": "30/60 мл · профессиональная кофемашина 155/180 ₽",
    "art": "espresso"
  },
  {
    "id": "американо",
    "name": "Американо",
    "category": "Кофе",
    "price": 160,
    "desc": "150/300 мл · профессиональная кофемашина 180/200 ₽",
    "art": "hot-coffee"
  },
  {
    "id": "cappuccino",
    "name": "Капучино",
    "category": "Кофе",
    "price": 180,
    "desc": "250/400 мл · профессиональная кофемашина 210/250 ₽",
    "art": "latte"
  },
  {
    "id": "большой-латте",
    "name": "Большой латте",
    "category": "Кофе",
    "price": 200,
    "desc": "400 мл · профессиональная кофемашина 250 ₽",
    "art": "latte"
  },
  {
    "id": "большой-латте-со-сливками",
    "name": "Большой латте со сливками",
    "category": "Кофе",
    "price": 270,
    "desc": "400 мл · профессиональная кофемашина 295 ₽",
    "art": "cocoa"
  },
  {
    "id": "большой-латте-со-сгущёнкой",
    "name": "Большой латте со сгущёнкой",
    "category": "Кофе",
    "price": 270,
    "desc": "400 мл · профессиональная кофемашина 295 ₽",
    "art": "latte"
  },
  {
    "id": "большой-матча-латте",
    "name": "Большой матча-латте",
    "category": "Кофе",
    "price": 210,
    "desc": "400 мл · профессиональная кофемашина 275 ₽",
    "art": "matcha-hot"
  },
  {
    "id": "большой-раф",
    "name": "Большой раф",
    "category": "Кофе",
    "price": 245,
    "desc": "350 мл · профессиональная кофемашина 285 ₽",
    "art": "latte"
  },
  {
    "id": "флэт-уайт",
    "name": "Флэт уайт",
    "category": "Кофе",
    "price": 205,
    "desc": "300 мл · профессиональная кофемашина 240 ₽",
    "art": "latte"
  },
  {
    "id": "кофе-по-венски",
    "name": "Кофе по-венски",
    "category": "Кофе",
    "price": 210,
    "desc": "250/450 мл · профессиональная кофемашина 235/285 ₽",
    "art": "cocoa"
  },
  {
    "id": "красный-глаз",
    "name": "Красный глаз",
    "category": "Кофе",
    "price": 180,
    "desc": "180 мл · профессиональная кофемашина 200 ₽",
    "art": "hot-coffee"
  },
  {
    "id": "ройбушино",
    "name": "Ройбушино",
    "category": "Кофе",
    "price": 210,
    "desc": "250/400 мл · 210/250 ₽",
    "art": "latte"
  },
  {
    "id": "какао",
    "name": "Какао",
    "category": "Кофе",
    "price": 220,
    "desc": "400 мл",
    "art": "cocoa"
  },
  {
    "id": "дабл-какао",
    "name": "Дабл какао",
    "category": "Кофе",
    "price": 280,
    "desc": "400 мл",
    "art": "cocoa"
  },
  {
    "id": "snickers-hot",
    "name": "Snickers Hot",
    "category": "Кофе",
    "price": 290,
    "desc": "400 мл",
    "art": "cocoa"
  },
  {
    "id": "горячий-шоколад",
    "name": "Горячий шоколад",
    "category": "Кофе",
    "price": 260,
    "desc": "150 мл",
    "art": "cocoa"
  },
  {
    "id": "чай",
    "name": "Чай",
    "category": "Чай",
    "price": 140,
    "desc": "400 мл",
    "art": "tea"
  },
  {
    "id": "чай-tasteabrew",
    "name": "Чай TasteaBrew",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл",
    "art": "tea"
  },
  {
    "id": "чай-bags",
    "name": "Чай Bags",
    "category": "Чай",
    "price": 70,
    "desc": "250 мл",
    "art": "tea"
  },
  {
    "id": "облепиховый-чай",
    "name": "Облепиховый чай",
    "category": "Чай",
    "price": 220,
    "desc": "400 мл",
    "art": "citrus-tea"
  },
  {
    "id": "вишнёвый-пунш",
    "name": "Вишнёвый пунш",
    "category": "Чай",
    "price": 210,
    "desc": "400 мл",
    "art": "punch"
  },
  {
    "id": "глинтвейн-б-а",
    "name": "Глинтвейн б/а",
    "category": "Чай",
    "price": 210,
    "desc": "400 мл",
    "art": "punch"
  },
  {
    "id": "марокканский-мятный-чай",
    "name": "Марокканский мятный чай",
    "category": "Чай",
    "price": 230,
    "desc": "400 мл",
    "art": "tea"
  },
  {
    "id": "малина-имбирь",
    "name": "Малина-имбирь",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл",
    "art": "punch"
  },
  {
    "id": "лимон-имбирь",
    "name": "Лимон-имбирь",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл",
    "art": "citrus-tea"
  },
  {
    "id": "пряный-пунш",
    "name": "Пряный пунш",
    "category": "Чай",
    "price": 200,
    "desc": "400 мл",
    "art": "punch"
  },
  {
    "id": "брусничный-глинтвейн",
    "name": "Брусничный глинтвейн",
    "category": "Чай",
    "price": 220,
    "desc": "400 мл",
    "art": "punch"
  },
  {
    "id": "гляссе",
    "name": "Гляссе",
    "category": "Напитки",
    "price": 255,
    "desc": "200/400 мл · 255/310 ₽",
    "art": "iced-latte"
  },
  {
    "id": "аффогато",
    "name": "Аффогато",
    "category": "Напитки",
    "price": 330,
    "desc": "350 мл",
    "art": "iced-latte"
  },
  {
    "id": "матча-аффогато",
    "name": "Матча-аффогато",
    "category": "Напитки",
    "price": 330,
    "desc": "350 мл",
    "art": "iced-matcha"
  },
  {
    "id": "манговый-латте",
    "name": "Манговый латте",
    "category": "Напитки",
    "price": 320,
    "desc": "400/650 мл · 320/395 ₽",
    "art": "lemonade-orange"
  },
  {
    "id": "ice-latte",
    "name": "Айс-латте",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "iced-latte"
  },
  {
    "id": "айс-раф",
    "name": "Айс-раф",
    "category": "Напитки",
    "price": 255,
    "desc": "500 мл",
    "art": "iced-latte"
  },
  {
    "id": "айс-матча",
    "name": "Айс-матча",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "iced-matcha"
  },
  {
    "id": "айс-ти",
    "name": "Айс-ти",
    "category": "Напитки",
    "price": 180,
    "desc": "500 мл",
    "art": "lemonade-orange"
  },
  {
    "id": "марокканский-мятный-чай-айс",
    "name": "Холодный марокканский мятный чай",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "lemonade-green"
  },
  {
    "id": "облепиховый-чай-айс",
    "name": "Холодный облепиховый чай",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "lemonade-orange"
  },
  {
    "id": "молочный-коктейль",
    "name": "Молочный коктейль",
    "category": "Напитки",
    "price": 260,
    "desc": "500 мл",
    "art": "iced-latte"
  },
  {
    "id": "молочный-коктейль-с-ванилью",
    "name": "Молочный коктейль с ванилью",
    "category": "Напитки",
    "price": 290,
    "desc": "450 мл",
    "art": "iced-latte"
  },
  {
    "id": "шоколадный-взрыв",
    "name": "Шоколадный взрыв",
    "category": "Напитки",
    "price": 325,
    "desc": "450 мл",
    "art": "iced-latte"
  },
  {
    "id": "манго-шейк",
    "name": "Манго-шейк",
    "category": "Напитки",
    "price": 290,
    "desc": "500 мл",
    "art": "lemonade-orange"
  },
  {
    "id": "банановый-смузи",
    "name": "Банановый смузи",
    "category": "Напитки",
    "price": 320,
    "desc": "400/650 мл · 320/395 ₽",
    "art": "lemonade-yellow"
  },
  {
    "id": "фраппе",
    "name": "Фраппе",
    "category": "Напитки",
    "price": 190,
    "desc": "300 мл",
    "art": "iced-latte"
  },
  {
    "id": "фраппучино",
    "name": "Фраппучино",
    "category": "Напитки",
    "price": 230,
    "desc": "500 мл",
    "art": "iced-latte"
  },
  {
    "id": "бамбл-кофе",
    "name": "Бамбл кофе",
    "category": "Напитки",
    "price": 260,
    "desc": "500 мл",
    "art": "iced-latte"
  },
  {
    "id": "клубничный-холодный-чай",
    "name": "Клубничный холодный чай",
    "category": "Напитки",
    "price": 320,
    "desc": "400/650 мл · 320/395 ₽",
    "art": "lemonade-red"
  },
  {
    "id": "мороженое",
    "name": "Мороженое",
    "category": "Напитки",
    "price": 165,
    "desc": "100 мл",
    "art": "cocoa"
  },
  {
    "id": "классический-лимонад",
    "name": "Классический лимонад",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "lemonade-yellow"
  },
  {
    "id": "лимонад-сицилийский",
    "name": "Лимонад сицилийский",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "lemonade-yellow"
  },
  {
    "id": "лимонад-аранчата",
    "name": "Лимонад аранчата",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "lemonade-orange"
  },
  {
    "id": "матча-апельсин",
    "name": "Матча-апельсин",
    "category": "Напитки",
    "price": 220,
    "desc": "500 мл",
    "art": "iced-matcha"
  },
  {
    "id": "клубника-в-сливках",
    "name": "Клубника в сливках",
    "category": "Напитки",
    "price": 240,
    "desc": "500 мл",
    "art": "lemonade-pink"
  },
  {
    "id": "крем-сода",
    "name": "Крем-сода",
    "category": "Напитки",
    "price": 240,
    "desc": "500 мл",
    "art": "lemonade-yellow"
  },
  {
    "id": "грейпфрут",
    "name": "Грейпфрут",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-orange"
  },
  {
    "id": "летний",
    "name": "Летний",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-orange"
  },
  {
    "id": "розовая-пантера",
    "name": "Розовая пантера",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-pink"
  },
  {
    "id": "тархун",
    "name": "Тархун",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-green"
  },
  {
    "id": "гренадин-лаванда",
    "name": "Гренадин-лаванда",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-purple"
  },
  {
    "id": "пина-колада",
    "name": "Пина колада",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-yellow"
  },
  {
    "id": "мохито-клубничный",
    "name": "Мохито клубничный",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл",
    "art": "lemonade-red"
  },
  {
    "id": "малина-маракуйя",
    "name": "Малина-маракуйя",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл",
    "art": "lemonade-red"
  },
  {
    "id": "малиновый-грейпфрут",
    "name": "Малиновый грейпфрут",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл",
    "art": "lemonade-red"
  },
  {
    "id": "малина-имбирь-лимонад",
    "name": "Малина-имбирь лимонад",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл",
    "art": "lemonade-red"
  },
  {
    "id": "лимон-имбирь-лимонад",
    "name": "Лимон-имбирь лимонад",
    "category": "Напитки",
    "price": 200,
    "desc": "450 мл",
    "art": "lemonade-yellow"
  },
  {
    "id": "голубая-лагуна",
    "name": "Голубая лагуна",
    "category": "Напитки",
    "price": 170,
    "desc": "450 мл",
    "art": "lemonade-blue"
  },
  {
    "id": "бабл-гам",
    "name": "Бабл гам",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-pink"
  },
  {
    "id": "клубника-со-сливками",
    "name": "Клубника со сливками",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-pink"
  },
  {
    "id": "вишнёвый",
    "name": "Вишнёвый",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-red"
  },
  {
    "id": "цветок-жасмина",
    "name": "Цветок жасмина",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-green"
  },
  {
    "id": "роса-розы",
    "name": "Роса розы",
    "category": "Напитки",
    "price": 180,
    "desc": "450 мл",
    "art": "lemonade-pink"
  }
];
// Sandwich builder: bread choice and extras from the «Сэндвичи» menu page.
const breads = [
  { id: "лепешка", name: "В лепёшке" },
  { id: "хлеб", name: "В хлебе" },
  { id: "булочка", name: "В булочке" },
];
const extras = [
  { id: "перец-халапеньо", name: "Перец халапеньо", price: 35, group: "Добавки" },
  { id: "овощи", name: "Овощи", price: 55, group: "Добавки" },
  { id: "мясо", name: "Мясо", price: 70, group: "Добавки" },
  { id: "крем-сыр", name: "Крем-сыр", price: 55, group: "Добавки" },
  { id: "моцарелла", name: "Моцарелла", price: 55, group: "Добавки" },
  { id: "соус-фирменный", name: "Соус фирменный", price: 40, group: "Соус" },
  { id: "соус-барбекю", name: "Соус барбекю", price: 40, group: "Соус" },
  { id: "соус-гриль", name: "Соус гриль", price: 40, group: "Соус" },
];
const catalogue = menu.map((p) =>
  p.breads
    ? {
        ...p,
        breads: p.breads.map((id) => breads.find((b) => b.id === id)),
        extras: p.extras ? extras : [],
      }
    : p,
);
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
  if (p.breads) {
    const bread =
      p.breads.length === 1
        ? p.breads[0]
        : p.breads.find((id) => id === input.bread);
    if (!bread) throw new Error(`Выберите, в чём приготовить «${p.name}»`);
    line.bread = breads.find((b) => b.id === bread).name;
    const chosen = [...new Set(Array.isArray(input.extras) ? input.extras : [])]
      .slice(0, extras.length)
      .map((id) => extras.find((e) => e.id === id))
      .filter(Boolean);
    if (p.extras && chosen.length) {
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
  if (url.pathname === "/api/menu") return json(res, 200, catalogue);
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
    if (pathname === "/index.html") {
      // Telegram's WebView keeps old app.js/style.css much longer than a
      // browser does, so after an update the Mini App kept running the old
      // cart code. A content hash in the URL forces a fresh copy every time.
      const html = fs
        .readFileSync(target, "utf8")
        .replace(/(src|href)="(app\.js|style\.css)"/g, (m, attr, name) => {
          const hash = crypto
            .createHash("sha1")
            .update(fs.readFileSync(path.join(root, name)))
            .digest("hex")
            .slice(0, 10);
          return `${attr}="${name}?v=${hash}"`;
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
