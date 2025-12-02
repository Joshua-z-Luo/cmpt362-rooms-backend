type Env = {
  ROOMS_DO: DurableObjectNamespace;
  ROOM_CODE_LEN: string;
  ROOM_TTL_SEC: string;
};

type UserInfo = { userId: string; name?: string };
type Location = { lat: number; lon: number; ts?: number };
type AbilityActivation = { id: string; ts: number };
type PlayerStatus = { team?: string; role?: string; health?: number };

type SettingKV = { key: string; value: string };
type Settings = SettingKV[];

type Member = {
  userId: string;
  name?: string;
  loc?: Location;
  updatedAt: number;
  token?: string;
  abilities?: AbilityActivation[];
  status?: PlayerStatus;
};

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

const codeRe = (env: Env, tail: string) =>
  new RegExp(`^/rooms/([${ALPHABET}]{${(+env.ROOM_CODE_LEN || 6)}})/${tail}$`);

function genCode(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}

const newUserId = () => "u_" + crypto.randomUUID().replace(/-/g, "").slice(12);
const newToken = () => crypto.randomUUID().replace(/-/g, "");

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

    const mState = path.match(codeRe(env, "state"));
    if (method === "GET" && mState) {
      const code = mState[1];
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/state");
    }

    const mJoin = path.match(codeRe(env, "join"));
    if (method === "POST" && mJoin) {
      const code = mJoin[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/join", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    const mLeave = path.match(codeRe(env, "leave"));
    if (method === "POST" && mLeave) {
      const code = mLeave[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/leave", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    const mLoc = path.match(codeRe(env, "loc"));
    if (method === "POST" && mLoc) {
      const code = mLoc[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/loc", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    const mAbility = path.match(codeRe(env, "ability"));
    if (method === "POST" && mAbility) {
      const code = mAbility[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/ability", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    const mStatus = path.match(codeRe(env, "status"));
    if (method === "POST" && mStatus) {
      const code = mStatus[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/status", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    const mSettings = path.match(codeRe(env, "settings"));
    if (mSettings && method === "GET") {
      const code = mSettings[1];
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/settings");
    }

    if (mSettings && method === "POST") {
      const code = mSettings[1];
      const body = await readAny(req);
      const id = env.ROOMS_DO.idFromName(code);
      return env.ROOMS_DO.get(id).fetch("https://do/settings", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};

export class RoomsDOv2 {
  state: DurableObjectState;
  members = new Map<string, Member>();
  ttlMs = 0;
  settings: Settings = [];

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.ttlMs = Math.max(5, parseInt(env.ROOM_TTL_SEC || "300", 10)) * 1000;

    this.state.blockConcurrencyWhile(async () => {
      const m = (await this.state.storage.get("members")) as [string, Member][] | undefined;
      if (m) this.members = new Map(m);
      const s = (await this.state.storage.get("settings")) as Settings | undefined;
      if (s) this.settings = s;
      await this.maybeExpire(Date.now());
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/init") return new Response("ok");

    await this.maybeExpire(Date.now());

    if (path === "/state") {
      const publicMembers = [...this.members.values()].map(({ token, ...rest }) => rest);
      return json({ members: publicMembers });
    }

    if (path === "/join" && req.method === "POST") {
      const body: any = await readAny(req);
      let userId = typeof body.userId === "string" ? body.userId.trim() : "";
      const name = typeof body.name === "string" && body.name.length ? body.name : undefined;
      const team = typeof body.team === "string" && body.team.length ? body.team : undefined;
      const role = typeof body.role === "string" && body.role.length ? body.role : undefined;

      if (!userId) userId = newUserId();

      const now = Date.now();
      const prev = this.members.get(userId);
      const token = prev?.token ?? newToken();
      const health =
        typeof body.health === "number"
          ? body.health
          : prev?.status?.health ?? 100;

      const mem: Member = {
        userId,
        name: name ?? prev?.name,
        loc: prev?.loc,
        updatedAt: now,
        token,
        abilities: prev?.abilities ?? [],
        status: {
          team: team ?? prev?.status?.team,
          role: role ?? prev?.status?.role,
          health,
        },
      };

      this.members.set(userId, mem);
      await this.touchAndPersist(now);
      return json({ ok: true, userId, token });
    }

    if (path === "/leave" && req.method === "POST") {
      const body: any = await readAny(req);
      const userId = String(body.userId || "");
      const token = String(body.token || "");
      if (!userId || !token) return json({ error: "userId and token required" }, { status: 400 });

      const mem = this.members.get(userId);
      if (!mem || mem.token !== token) return json({ error: "unauthorized" }, { status: 403 });

      this.members.delete(userId);
      await this.touchAndPersist(Date.now());
      return json({ ok: true });
    }

    if (path === "/loc" && req.method === "POST") {
      const body: any = await readAny(req);
      const userId = String(body.userId || "");
      const token = String(body.token || "");
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      const ts = body.ts ? Number(body.ts) : Date.now();

      if (!userId || !token || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return json({ error: "userId, token, lat, lon required" }, { status: 400 });
      }

      const prev = this.members.get(userId);
      if (!prev || prev.token !== token) return json({ error: "unauthorized" }, { status: 403 });

      const now = Date.now();
      const mem: Member = {
        userId,
        name: prev.name,
        token: prev.token,
        loc: { lat, lon, ts },
        updatedAt: now,
        abilities: prev.abilities ?? [],
        status: prev.status,
      };
      this.members.set(userId, mem);
      await this.touchAndPersist(now);
      return json({ ok: true });
    }

    if (path === "/ability" && req.method === "POST") {
      const body: any = await readAny(req);
      const userId = String(body.userId || "");
      const token = String(body.token || "");
      const abilityId = String(body.abilityId || "");
      const ts = body.ts ? Number(body.ts) : Date.now();

      if (!userId || !token || !abilityId || !Number.isFinite(ts)) {
        return json({ error: "userId, token, abilityId required" }, { status: 400 });
      }

      const prev = this.members.get(userId);
      if (!prev || prev.token !== token) return json({ error: "unauthorized" }, { status: 403 });

      const now = Date.now();
      const abilities = prev.abilities ? [...prev.abilities] : [];
      abilities.push({ id: abilityId, ts });

      const mem: Member = {
        userId,
        name: prev.name,
        token: prev.token,
        loc: prev.loc,
        updatedAt: now,
        abilities,
        status: prev.status,
      };

      this.members.set(userId, mem);
      await this.touchAndPersist(now);
      return json({ ok: true });
    }

    if (path === "/status" && req.method === "POST") {
      const body: any = await readAny(req);
      const userId = String(body.userId || "");
      const token = String(body.token || "");
      const team = typeof body.team === "string" && body.team.length ? body.team : undefined;
      const role = typeof body.role === "string" && body.role.length ? body.role : undefined;

      if (!userId || !token) {
        return json({ error: "userId and token required" }, { status: 400 });
      }

      const prev = this.members.get(userId);
      if (!prev || prev.token !== token) return json({ error: "unauthorized" }, { status: 403 });

      let health = prev.status?.health ?? 100;
      if (body.health !== undefined) {
        const h = Number(body.health);
        if (Number.isFinite(h)) health = h;
      }

      const now = Date.now();
      const status: PlayerStatus = {
        team: team ?? prev.status?.team,
        role: role ?? prev.status?.role,
        health,
      };

      const mem: Member = {
        userId,
        name: prev.name,
        token: prev.token,
        loc: prev.loc,
        updatedAt: now,
        abilities: prev.abilities ?? [],
        status,
      };

      this.members.set(userId, mem);
      await this.touchAndPersist(now);
      return json({ ok: true });
    }

    if (path === "/settings" && req.method === "GET") {
      return json({ settings: this.settings });
    }

    if (path === "/settings" && req.method === "POST") {
      const body: any = await readAny(req);
      const raw = Array.isArray(body) ? body : body.settings;
      const list: SettingKV[] = Array.isArray(raw)
        ? raw
            .filter((kv: any) => kv && typeof kv.key === "string" && typeof kv.value === "string")
            .map((kv: any) => ({ key: kv.key, value: kv.value }))
        : [];
      this.settings = list;
      const now = Date.now();
      await this.touchAndPersist(now);
      return json({ ok: true });
    }

    return new Response("Not Found", { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.maybeExpire(Date.now());
  }

  private async touchAndPersist(now: number) {
    const maxUpdated = Math.max(0, ...Array.from(this.members.values()).map(m => m.updatedAt));
    await this.state.storage.put("members", [...this.members.entries()]);
    await this.state.storage.put("settings", this.settings);
    if (maxUpdated) await this.state.storage.setAlarm(maxUpdated + this.ttlMs);
  }

  private async maybeExpire(now: number) {
    const maxUpdated = Math.max(0, ...Array.from(this.members.values()).map(m => m.updatedAt));
    if (maxUpdated && now - maxUpdated >= this.ttlMs) {
      this.members.clear();
      await this.state.storage.deleteAll();
    }
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
