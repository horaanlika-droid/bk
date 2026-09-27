import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { once } from "node:events";

let process, directory, base;
before(async () => {
  // Isolated server: test orders never touch the app's data or Telegram.
  directory = await mkdtemp(join(tmpdir(), "bk-test-"));
  for (const file of [
    "server.js",
    "package.json",
    "index.html",
    "style.css",
    "app.js",
    "assets",
  ]) {
    await cp(new URL("../" + file, import.meta.url), join(directory, file), {
      recursive: true,
    });
  }
  await writeFile(join(directory, ".env"), "TEST_SECRET=not-public");
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  process = spawn(globalThis.process.execPath, ["server.js"], {
    cwd: directory,
    env: {
      ...globalThis.process.env,
      PORT: String(port),
      BOT_TOKEN: "",
      ADMIN_IDS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await Promise.race([
    once(process.stdout, "data"),
    once(process, "exit").then(() => {
      throw new Error("Test server exited before startup");
    }),
  ]);
});
after(async () => {
  if (process && process.exitCode === null) {
    const exited = once(process, "exit");
    process.kill();
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("menu and public assets load with correct MIME types", async () => {
  const menu = await (await fetch(base + "/api/menu")).json();
  assert.equal(menu.length, 102);
  assert.equal(menu.find((item) => item.id === "большой-латте").price, 200);
  for (const [url, type] of [
    ["/", "text/html"],
    ["/app.js", "text/javascript"],
    ["/style.css", "text/css"],
    ["/assets/logo.png", "image/png"],
    ["/assets/fonts/manrope-cyrillic-wght-normal.woff2", "font/woff2"],
  ]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get("content-type").startsWith(type), url);
  }
});

test("missing files return 404 without crashing; private files are not served", async () => {
  for (const path of [
    "/assets/missing.png",
    "/favicon.ico",
    "/server.js",
    "/.env",
    "/data/orders.json",
    "/.git/HEAD",
    "/assets/../server.js",
    "/assets/%2e%2e%2fserver.js",
  ]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + "/%E0%A4%A")).status, 400);
  assert.equal((await fetch(base + "/api/health")).status, 200);
});

test("checkout computes price and coins on the server, not from client input", async () => {
  const response = await fetch(base + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "большой-латте", qty: 2, price: 1 }],
      total: 2,
      type: "here",
      branch: "Волжский",
      customer: { name: "Тест", phone: "+7 900 000-00-00" },
    }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.total, 400);
  assert.equal(result.coinsEarned, 20);
  const orders = JSON.parse(
    await readFile(join(directory, "data/orders.json"), "utf8"),
  );
  assert.equal(orders.length, 1);
  assert.equal(orders[0].type, "here");
  assert.equal((await fetch(base + "/data/orders.json")).status, 404);
});

test("empty or invalid checkout is rejected", async () => {
  for (const body of [
    "{invalid",
    JSON.stringify({ items: [], customer: {}, branch: "Волжский" }),
  ]) {
    assert.equal(
      (await fetch(base + "/api/orders", { method: "POST", body })).status,
      400,
    );
  }
});
