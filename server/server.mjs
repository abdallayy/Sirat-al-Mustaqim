import { createServer } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import webpush from "web-push";

const {
  VAPID_PUBLIC,
  VAPID_PRIVATE,
  VAPID_SUBJECT,
  ORIGIN,
  HOST = "127.0.0.1",
  PORT = "8787",
} = process.env;

if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT || !ORIGIN) {
  throw new Error("Set VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT and ORIGIN before starting the Push server.");
}

const allowedOrigin = new URL(ORIGIN).origin;
if (allowedOrigin !== ORIGIN.replace(/\/$/, "")) {
  throw new Error("ORIGIN must be an origin only, without a path or trailing slash.");
}
if (new URL(allowedOrigin).protocol !== "https:" && !["localhost", "127.0.0.1"].includes(new URL(allowedOrigin).hostname)) {
  throw new Error("ORIGIN must use HTTPS except for local development.");
}
const port = Number(PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const databasePath = fileURLToPath(new URL("./subscriptions.json", import.meta.url));
const temporaryPath = `${databasePath}.tmp`;
const subscriptions = new Map();
const requestCounts = new Map();
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 400;
const MAX_EVENT_HORIZON = 31 * 86_400_000;
let dispatchInProgress = false;

try {
  const saved = JSON.parse(await readFile(databasePath, "utf8"));
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    throw new Error("Subscription database must be a JSON object.");
  }
  for (const [endpoint, record] of Object.entries(saved)) {
    if (isValidEndpoint(endpoint) && isValidSubscription(record?.subscription) && Array.isArray(record.events)) {
      subscriptions.set(endpoint, {
        subscription: record.subscription,
        events: record.events.filter(isValidEvent),
        sent: record.sent && typeof record.sent === "object" ? record.sent : {},
      });
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function isValidEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "fcm.googleapis.com" ||
    host === "push.services.mozilla.com" ||
    host.endsWith(".push.services.mozilla.com") ||
    host === "push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host === "notify.windows.com" ||
    host.endsWith(".notify.windows.com")
  );
}

function isValidSubscription(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      isValidEndpoint(value.endpoint) &&
      value.keys &&
      typeof value.keys.p256dh === "string" &&
      /^[A-Za-z0-9_-]{40,160}$/.test(value.keys.p256dh) &&
      typeof value.keys.auth === "string" &&
      /^[A-Za-z0-9_-]{16,64}$/.test(value.keys.auth),
  );
}

function isValidEvent(value) {
  const now = Date.now();
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.id.length <= 120 &&
      Number.isFinite(value.at) &&
      value.at > now - 10 * 60_000 &&
      value.at < now + MAX_EVENT_HORIZON &&
      typeof value.title === "string" &&
      value.title.length > 0 &&
      value.title.length <= 120 &&
      typeof value.body === "string" &&
      value.body.length <= 240,
  );
}

async function saveDatabase() {
  const serializable = Object.fromEntries(subscriptions);
  await writeFile(temporaryPath, JSON.stringify(serializable), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, databasePath);
}

function reply(response, status, message, origin) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers.Vary = "Origin";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify({ message }));
}

function rateLimited(address) {
  const now = Date.now();
  if (requestCounts.size > 10_000) {
    for (const [client, timestamps] of requestCounts) {
      if (!timestamps.some((timestamp) => now - timestamp < 60_000)) requestCounts.delete(client);
    }
  }
  const recent = (requestCounts.get(address) ?? []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 60) {
    requestCounts.set(address, recent);
    return true;
  }
  recent.push(now);
  requestCounts.set(address, recent);
  return false;
}

async function readJson(request, response, origin) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    reply(response, 415, "Content-Type must be application/json.", origin);
    return null;
  }
  const announcedLength = Number(request.headers["content-length"] ?? 0);
  if (announcedLength > MAX_BODY_BYTES) {
    reply(response, 413, "Request body is too large.", origin);
    return null;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      reply(response, 413, "Request body is too large.", origin);
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    reply(response, 400, "Invalid JSON request body.", origin);
    return null;
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin !== allowedOrigin) {
    reply(response, 403, "Origin is not allowed.", origin);
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
    response.end();
    return;
  }
  if (request.method !== "POST") {
    reply(response, 405, "Method not allowed.", origin);
    return;
  }
  if (rateLimited(request.socket.remoteAddress ?? "unknown")) {
    reply(response, 429, "Too many requests.", origin);
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/sync" && url.pathname !== "/unsync") {
    reply(response, 404, "Not found.", origin);
    return;
  }
  const payload = await readJson(request, response, origin);
  if (payload === null) return;

  if (url.pathname === "/sync") {
    const subscription = payload?.subscription;
    const events = payload?.events;
    if (!isValidSubscription(subscription) || !Array.isArray(events) || events.length > MAX_EVENTS) {
      reply(response, 400, "Invalid subscription or event list.", origin);
      return;
    }
    const ids = new Set();
    for (const event of events) {
      if (!isValidEvent(event) || ids.has(event.id)) {
        reply(response, 400, "Events must be valid and have unique IDs.", origin);
        return;
      }
      ids.add(event.id);
    }
    const previous = subscriptions.get(subscription.endpoint);
    const validEvents = events.map(({ id, at, title, body }) => ({ id, at, title, body }));
    const validIds = new Set(validEvents.map((event) => event.id));
    const sent = Object.fromEntries(
      Object.entries(previous?.sent ?? {}).filter(([id]) => validIds.has(id)),
    );
    subscriptions.set(subscription.endpoint, { subscription, events: validEvents, sent });
    try {
      await saveDatabase();
      reply(response, 200, "Schedule synchronized.", origin);
    } catch (error) {
      console.error("Could not save subscription data.", error);
      reply(response, 500, "Could not save the schedule.", origin);
    }
    return;
  }

  const endpoint = payload?.endpoint;
  if (!isValidEndpoint(endpoint)) {
    reply(response, 400, "Invalid subscription endpoint.", origin);
    return;
  }
  subscriptions.delete(endpoint);
  try {
    await saveDatabase();
    reply(response, 200, "Subscription removed.", origin);
  } catch (error) {
    console.error("Could not remove subscription data.", error);
    reply(response, 500, "Could not remove the subscription.", origin);
  }
});

server.listen(port, HOST, () => {
  console.log(`Prayer Push server listening on ${HOST}:${port}; allowed origin: ${allowedOrigin}`);
});

const dispatchTimer = setInterval(async () => {
  if (dispatchInProgress) return;
  dispatchInProgress = true;
  try {
    const now = Date.now();
    for (const [endpoint, record] of subscriptions) {
      let updated = false;
      for (const event of record.events) {
        if (event.at > now || now - event.at >= 10 * 60_000 || record.sent[event.id]) continue;
        try {
          await webpush.sendNotification(record.subscription, JSON.stringify({
            id: event.id,
            title: event.title,
            body: event.body,
          }));
          record.sent[event.id] = now;
          updated = true;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            subscriptions.delete(endpoint);
            updated = true;
            break;
          }
          console.error(`Push delivery failed (${error.statusCode ?? "unknown status"}).`);
        }
      }
      if (updated) await saveDatabase();
    }
  } catch (error) {
    console.error("The Push scheduler encountered an error.", error);
  } finally {
    dispatchInProgress = false;
  }
}, 15_000);
dispatchTimer.unref();

function closeServer() {
  clearInterval(dispatchTimer);
  server.close((error) => {
    if (error) {
      console.error("Could not stop the Push server cleanly.", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);
