type Env = {
  ROOMS_DO: DurableObjectNamespace;
  ROOM_CODE_LEN: string;
};

type UserInfo = { userId: string; name?: string };
type Location = { lat: number; lon: number; ts?: number };

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
function genCode(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = req.method.toUpperCase();

    if (method === "POST" && path === "/rooms") {
      const code = genCode(parseInt(env.ROOM_CODE_LEN || "6", 10));
      const id = env.ROOMS_DO.idFromName(code);
      await env.ROOMS_DO.get(id).fetch("https://do/init");
      return json({ code });
    }

    const mState = path.match(/^\/rooms\/([A-Z0-9]{4,12})\/state$/);
    if (method === "GET" && mState) {
      const code = mState[1];
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/state");
    }

    const mJoin = path.match(/^\/rooms\/([A-Z0-9]{4,12})\/join$/);
    if (method === "POST" && mJoin) {
      const code = mJoin[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/join", { method: "POST", body: JSON.stringify(body) });
    }

    const mLeave = path.match(/^\/rooms\/([A-Z0-9]{4,12})\/leave$/);
    if (method === "POST" && mLeave) {
      const code = mLeave[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/leave", { method: "POST", body: JSON.stringify(body) });
    }

    const mLoc = path.match(/^\/rooms\/([A-Z0-9]{4,12})\/loc$/);
    if (method === "POST" && mLoc) {
      const code = mLoc[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/loc", { method: "POST", body: JSON.stringify(body) });
    }

    return new Response("Not Found", { status: 404 });
  },
};

export class RoomsDO {
  state: DurableObjectState;
  users = new Map<string, UserInfo>();
  locs = new Map<string, Location>();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const stored = (await this.state.storage.get<[string, UserInfo] | [string, Location]>(["users", "locs"])) as any;
      if (stored?.users) this.users = new Map(stored.users as [string, UserInfo][]);
      if (stored?.locs) this.locs = new Map(stored.locs as [string, Location][]);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/init") return new Response("ok");

    if (path === "/state") {
      return json({
        users: [...this.users.values()],
        locs: Object.fromEntries(this.locs.entries()),
      });
    }

    if (path === "/join" && req.method === "POST") {
      const body: any = await readAny(req);
      const userId = String(body.userId || "");
      const name = typeof body.name === "string" && body.name.length ? body.name : undefined;
      if (!userId) return json({ error: "userId required" }, { status: 400 });
      this.users.set(userId, { userId, name });
      await this.persistUsers();
      return json({ ok: true });
    }

    if (path === "/leave" && req.method === "POST") {
      const body: any = await readAny(req);
      const userId = String(body.userId || "");
      if (!userId) return json({ error: "userId required" }, { status: 400 });
      this.users.delete(userId);
      this.locs.delete(userId);
      await this.state.storage.put("users", [...this.users.entries()]);
      await this.state.storage.put("locs", [...this.locs.entries()]);
      return json({ ok: true });
    }

    if (path === "/loc" && req.method === "POST") {
      const body: any = await readAny(req);
      const userId = String(body.userId || "");
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      const ts = body.ts ? Number(body.ts) : Date.now();
      if (!userId || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return json({ error: "userId, lat, lon required" }, { status: 400 });
      }
      const user = this.users.get(userId) || { userId };
      this.users.set(userId, user);
      this.locs.set(userId, { lat, lon, ts });
      await this.state.storage.put("users", [...this.users.entries()]);
      await this.state.storage.put("locs", [...this.locs.entries()]);
      return json({ ok: true });
    }

    return new Response("Not Found", { status: 404 });
  }

  private async persistUsers() {
    await this.state.storage.put("users", [...this.users.entries()]);
  }
}

async function readAny(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}
