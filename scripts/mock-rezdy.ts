/**
 * A stand-in for Rezdy's agent API, for local development only.
 *
 *   npx tsx scripts/mock-rezdy.ts            (listens on 127.0.0.1:3199)
 *
 * Then in .env.local:
 *
 *   REZDY_API_KEY=mock-local
 *   REZDY_API_URL=http://127.0.0.1:3199/v1
 *   REZDY_WEBHOOK_SECRET=<anything>
 *
 * It serves the Rezdy simulator (lib/services/channels/rezdy/sim.ts) over the same
 * HTTP shapes Rezdy uses, so the real client, sync and booking code run end to end
 * without an approved agent key. The supplier "Reef Runner Charters" (alias
 * reefrunner) has four products: an automated-payment day trip with pickups, a
 * full-payment-to-agent sunset sail, a private charter the operator accepts by hand,
 * and a deposit-only trip Bluepass cannot sell.
 *
 * Open http://127.0.0.1:3199/ to act as the operator in Rezdy: cancel, confirm or
 * move a booking. With MOCK_REZDY_WEBHOOK_URL set, each change is also posted to
 * Bluepass the way Rezdy's webhooks would be.
 *
 * Refuses to start with NODE_ENV=production.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RezdyError } from "@/lib/services/channels/rezdy/api";
import { createRezdySim, reefRunnerOnRezdy } from "@/lib/services/channels/rezdy/sim";
import { localDateInZone } from "@/lib/services/operators/listing-availability";

if (process.env.NODE_ENV === "production") {
  console.error("mock-rezdy is for local development only.");
  process.exit(1);
}

const PORT = Number(process.env.MOCK_REZDY_PORT ?? 3199);
const WEBHOOK = process.env.MOCK_REZDY_WEBHOOK_URL?.trim() || null;
const sim = createRezdySim(reefRunnerOnRezdy(localDateInZone(new Date(), "Australia/Brisbane"), {
  days: 90,
  orderPrefix: `R${Date.now().toString(36).slice(-4).toUpperCase()}`,
}));

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function ok(res: ServerResponse, body: Record<string, unknown>) {
  send(res, 200, { requestStatus: { success: true, version: "v1" }, ...body });
}

function refuse(res: ServerResponse, error: unknown) {
  if (error instanceof RezdyError) {
    return send(res, error.status || 400, {
      requestStatus: { success: false, version: "v1", error: { errorCode: error.code, errorMessage: error.message, ...(error.detail ?? {}) } },
    });
  }
  send(res, 500, { requestStatus: { success: false, error: { errorMessage: error instanceof Error ? error.message : String(error) } } });
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function notify(orderNumber: string) {
  if (!WEBHOOK) return;
  const order = await sim.api.getBooking(orderNumber);
  await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(order) }).catch((e) => console.warn("webhook failed", e.message));
}

function page(res: ServerResponse) {
  const rows = [...sim.orders.values()].map((o) => {
    const item = o.items?.[0];
    return `<tr><td>${o.orderNumber}</td><td>${o.status}</td><td>${item?.productName ?? ""}</td><td>${item?.startTimeLocal ?? ""}</td>
      <td>${o.customer?.firstName ?? ""} ${o.customer?.lastName ?? ""}</td><td>${o.resellerReference ?? ""}</td><td>A$${o.totalAmount}</td>
      <td><form method="post" action="/__sim/orders/${o.orderNumber}/cancel"><button>Cancel</button></form>
      <form method="post" action="/__sim/orders/${o.orderNumber}/confirm"><button>Confirm</button></form>
      <form method="post" action="/__sim/orders/${o.orderNumber}/move"><input name="to" value="${item?.startTimeLocal ?? ""}" size="19"><button>Move</button></form></td></tr>`;
  }).join("");
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><meta charset="utf-8"><title>Mock Rezdy</title>
    <body style="font:14px -apple-system,sans-serif;padding:24px;background:#f7f7f5;color:#0f0f0f">
    <h1 style="font-size:20px">Mock Rezdy · Reef Runner Charters</h1>
    <p>Orders Bluepass has made through the agent API. Act as the operator: cancel, confirm or move one.</p>
    <table cellpadding="8" style="background:#fff;border-collapse:collapse"><tr><th>Order</th><th>Status</th><th>Product</th><th>When</th><th>Guest</th><th>Bluepass ref</th><th>Total</th><th></th></tr>${rows || '<tr><td colspan="8">No orders yet.</td></tr>'}</table>
    </body>`);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const q = Object.fromEntries(url.searchParams);

    if (url.pathname === "/") return page(res);
    if (parts[0] === "__sim" && req.method === "POST") {
      const [, , orderNumber, action] = parts;
      const form = new URLSearchParams(await (async () => { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); return Buffer.concat(c).toString(); })());
      if (action === "cancel") sim.supplier.cancel(orderNumber);
      if (action === "confirm") sim.supplier.confirm(orderNumber);
      if (action === "move") sim.supplier.move(orderNumber, form.get("to") ?? "");
      await notify(orderNumber);
      res.writeHead(303, { location: "/" });
      return res.end();
    }

    if (parts[0] !== "v1") return send(res, 404, { error: "Not found" });
    if (!q.apiKey) return send(res, 401, { requestStatus: { success: false, error: { errorCode: "AUTHENTICATION", errorMessage: "API key is required" } } });
    const path = parts.slice(1);

    if (req.method === "GET" && path[0] === "products" && path[1] === "marketplace") {
      const all = await sim.api.marketplaceProducts({ supplierAlias: q.supplierAlias, supplierId: q.supplierId });
      const offset = Number(q.offset ?? 0);
      return ok(res, { products: all.slice(offset, offset + Number(q.limit ?? 100)) });
    }
    if (req.method === "GET" && path[0] === "products" && path[2] === "pickups") return ok(res, { pickupLocations: await sim.api.pickups(path[1]) });
    if (req.method === "GET" && path[0] === "products" && path.length === 2) {
      const product = await sim.api.product(path[1]);
      return product ? ok(res, { product }) : send(res, 404, { requestStatus: { success: false, error: { errorMessage: "Product not found" } } });
    }
    if (req.method === "GET" && path[0] === "companies" && path[1] === "alias") {
      const company = await sim.api.company(path[2]);
      return company ? ok(res, { company }) : send(res, 404, { requestStatus: { success: false, error: { errorMessage: "Company not found" } } });
    }
    if (req.method === "GET" && path[0] === "availability") {
      const sessions = await sim.api.availability({ productCode: q.productCode, startTimeLocal: q.startTimeLocal, endTimeLocal: q.endTimeLocal });
      const offset = Number(q.offset ?? 0);
      return ok(res, { sessions: sessions.slice(offset, offset + Number(q.limit ?? 100)) });
    }
    if (path[0] === "bookings") {
      if (req.method === "POST" && path[1] === "quote") return ok(res, { booking: await sim.api.quote(await body(req)) });
      if (req.method === "POST" && path.length === 1) return ok(res, { booking: await sim.api.createBooking(await body(req)) });
      if (req.method === "GET" && path.length === 1) return ok(res, { bookings: await sim.api.searchBookings({ updatedSince: q.updatedSince, resellerReference: q.resellerReference }) });
      const orderNumber = path[1];
      if (req.method === "GET") {
        const booking = await sim.api.getBooking(orderNumber);
        return booking ? ok(res, { booking }) : send(res, 404, { requestStatus: { success: false, error: { errorMessage: "Booking not found" } } });
      }
      if (req.method === "PUT") return ok(res, { booking: await sim.api.updateBooking(orderNumber, await body(req)) });
      if (req.method === "DELETE") {
        const booking = await sim.api.cancelBooking(orderNumber);
        return booking ? ok(res, { booking }) : send(res, 404, { requestStatus: { success: false, error: { errorMessage: "Booking not found" } } });
      }
    }
    send(res, 404, { requestStatus: { success: false, error: { errorMessage: `No route for ${req.method} ${url.pathname}` } } });
  } catch (error) {
    refuse(res, error);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock Rezdy on http://127.0.0.1:${PORT}/v1 (orders at http://127.0.0.1:${PORT}/)`);
});
