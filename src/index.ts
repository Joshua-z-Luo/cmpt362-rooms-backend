import type { DurableObjectNamespace, DurableObjectState, ExecutionContext } from "@cloudflare/workers-types";

type Env = {
  ROOMS_DO: DurableObjectNamespace;
  ROOM_CODE_LEN: string;
};

type UserInfo = { userId: string; name?: string };
type Location = { lat: number; lon: number; ts?: number };

type ClientMsg =
  | { type: "hello"; userId: string; name?: string }
  | { type: "loc"; lat: number; lon: number; ts?: number }
  | { type: "ping" };

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
function genCode(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/, "");
    const method = req.method.toUpperCase();

    if (method === "POST" && pathname === "/rooms") {
      const code = genCode(parseInt(env.ROOM_CODE_LEN || "6", 10));
      const id = env.ROOMS_DO.idFromName(code);
      await env.ROOMS_DO.get(id).fetch("https://do/init");
      return json({ code });
    }

    const matchState = pathname.match(/^\/rooms\/([A-Z0-9]{4,12})\/state$/);
    if (method === "GET" && matchState) {
      const code = matchState[1];
      const id = env.ROOMS_DO.idFromName(code);
      const resp = await env.ROOMS_DO.get(id).fetch("https://do/state");
      return resp;
    }

    const matchWs = pathname.match(/^\/rooms\/([A-Z0-9]{4,12})\/ws$/);
    if (method === "GET" && matchWs) {
      const code = matchWs[1];
      const id = env.ROOMS_DO.idFromName(code);
      const doStub = env.ROOMS_DO.get(id);

      const pair = new WebSocketPair();
      await doStub.fetch("https://do/ws", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        webSocket: pair[1],
      } as any);
      return new Response(null, { status: 101, webSocket: pair[0] as any });
    }

    return new Response("Not Found", { status: 404 });
  },
};

export class RoomsDO {
  state: DurableObjectState;
  env: Env;
  sockets = new Map<WebSocket, UserInfo>();
  locs = new Map<string, Location>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/init") return new Response("ok");

    if (url.pathname === "/state") {
      const users = [...this.sockets.values()];
      const locsObj: Record<string, Location> = {};
      for (const [uid, loc] of this.locs.entries()) locsObj[uid] = loc;
      return json({ users, locs: locsObj });
    }

    const maybeWs = (req as unknown as { webSocket?: WebSocket }).webSocket;
    if (url.pathname === "/ws" && maybeWs) {
      const client = maybeWs as WebSocket;
      client.accept();

      this.sockets.set(client, { userId: `anon-${Math.random().toString(16).slice(2)}` });
      this.sendSnapshot(client);

      client.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ClientMsg;
          this.onMessage(client, msg);
        } catch {
          // ignore malformed
        }
      });

      client.addEventListener("close", () => {
        const info = this.sockets.get(client);
        this.sockets.delete(client);
        if (info) this.broadcast({ type: "peer-left", userId: info.userId }, client);
      });

      return new Response(null, { status: 101, webSocket: client as any });
    }

    return new Response("Not Found", { status: 404 });
  }

  private onMessage(ws: WebSocket, msg: ClientMsg) {
    switch (msg.type) {
      case "hello": {
        const info: UserInfo = { userId: String(msg.userId || ""), name: msg.name };
        if (!info.userId) return;
        this.sockets.set(ws, info);
        this.broadcast({ type: "peer-join", user: info }, ws);
        return;
      }
      case "loc": {
        const info = this.sockets.get(ws);
        if (!info?.userId) return;
        const loc: Location = {
          lat: Number(msg.lat),
          lon: Number(msg.lon),
          ts: msg.ts ? Number(msg.ts) : Date.now(),
        };
        if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return;
        this.locs.set(info.userId, loc);
        this.broadcast({ type: "peer-loc", from: info, loc }, ws);
        return;
      }
      case "ping": {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        return;
      }
    }
  }

  private sendSnapshot(ws: WebSocket) {
    const users = [...this.sockets.values()];
    const locsObj: Record<string, Location> = {};
    for (const [uid, loc] of this.locs.entries()) locsObj[uid] = loc;
    ws.send(JSON.stringify({ type: "snapshot", users, locs: locsObj }));
  }

  private broadcast(payload: any, except?: WebSocket) {
    const data = JSON.stringify(payload);
    for (const sock of this.sockets.keys()) {
      if (sock !== except) {
        try {
          sock.send(data);
        } catch {}
      }
    }
  }
}

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}
