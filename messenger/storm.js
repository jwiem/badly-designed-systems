// Run: node storm.js --help
const API = process.env.API || "http://localhost:8080";

function parseArgs(argv) {
  return Object.fromEntries(
    argv.map((kv) => {
      const [k, v] = kv.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
  );
}

const raw = parseArgs(process.argv.slice(2));
if (raw.help || raw.h) {
  printHelp();
  process.exit(0);
}

const config = {
  rooms: num(raw.rooms, 3),
  users: num(raw.users, 200),
  publishers: num(raw.publishers, 50),
  rate: num(raw.rate, 200), // global messages/sec target
  durationSec: num(raw.duration, 60),
  burstEverySec: num(raw.burstEvery, 0), // 0 = steady
  burstFactor: num(raw.burstFactor, 3),
  hotSkew: num(raw.hotSkew, 1.2), // Zipf skew (1.0 uniform, higher = hotter head)
  bodyBytes: num(raw.bodyBytes, 60),
};
log("config", config);

// ---------- helpers ----------
function randInt(n) {
}

function randUUID() {
  return crypto.randomUUID();
}
function randomBody(n) {
  const abc = "abcdefghijklmnopqrstuvwxyz      0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += abc[randInt(abc.length)];
  return s;
}

// generate Zipf-ish weights for rooms
function zipfWeights(n, skew) {
  const w = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, skew));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

function pickWeighted(arr, weights) {
  let r = Math.random(),
    acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += weights[i];
    if (r <= acc) return arr[i];
  }
  return arr[arr.length - 1];
}
// rudimentary histogram for p50/p95/p99
function makeHist() {
  const buckets = [
    1, 2, 5, 10, 20, 50, 75, 100, 200, 400, 800, 1200, 2000, 5000, 10000,
  ];
  const counts = new Array(buckets.length).fill(0);
  let n = 0;
  return {
    add: (ms) => {
      n++;
      const x = ms;
      let i = 0;
      while (i < buckets.length && x > buckets[i]) i++;
      counts[Math.min(i, buckets.length - 1)]++;
    },
    quantile: (q) => {
      const need = Math.ceil(n * q);
      let cum = 0;
      for (let i = 0; i < buckets.length; i++) {
        cum += counts[i];
        if (cum >= need) return buckets[i];
      }
      return buckets[buckets.length - 1];
    },
    n: () => n,
  };
}

// ---------- bootstrap rooms/users ----------
async function createRoom(name) {
  const r = await fetch(`${API}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`createRoom ${name} -> ${r.status}`);
  const j = await r.json();
  return j.id;
}

async function ensureRooms(n) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await createRoom(`room-${i + 1}`));
  return ids;
}

function makeUsers(n) {
  return Array.from({ length: n }, () => randUUID());
}

// ---------- rate limiter (token bucket + optional bursts) ----------
function makeRateLimiter(ratePerSec, burstEvery, burstFactor) {
  let tokens = 0;
  const baseRefill = ratePerSec; // per second
  setInterval(() => {
    const bursting =
      burstEvery > 0 && Math.floor(Date.now() / 1000) % burstEvery === 0;
    const refill = bursting ? baseRefill * burstFactor : baseRefill;
    tokens = Math.min(tokens + refill, ratePerSec * Math.max(1, burstFactor));
  }, 1000);
  return () => {
    if (tokens >= 1) {
      tokens -= 1;
      return true;
    }
    return false;
  };
}

// ---------- publisher ----------
async function publish(roomId, userId, body) {
  const t0 = performance.now();
  const r = await fetch(`${API}/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_id: userId, body }),
  });
  const ms = performance.now() - t0;
  if (!r.ok) throw new Error(String(r.status));
  return ms;
}

(async () => {
  // setup
  const rooms = await ensureRooms(cfg.rooms);
  const users = makeUsers(cfg.users);
  const weights = zipfWeights(rooms.length, cfg.hotSkew);
  const pickRoom = () => pickWeighted(rooms, weights);

  const limitOk = makeRateLimiter(cfg.rate, cfg.burstEverySec, cfg.burstFactor);
  const lat = makeHist();
  let ok = 0,
    fail = 0;

  // publishers (they spin, grabbing tokens when available)
  function runPublisher(id) {
    (async function loop() {
      try {
        if (limitOk()) {
          const roomId = pickRoom();
          const userId = users[randInt(users.length)];
          const body = randomBody(cfg.bodyBytes);
          const ms = await publish(roomId, userId, body);
          lat.add(ms);
          ok++;
        }
      } catch (e) {
        fail++;
      } finally {
        setTimeout(loop, 0); // tight loop; rate controlled by tokens
      }
    })();
  }
  for (let i = 0; i < cfg.publishers; i++) runPublisher(i);

  // stats printer
  const tStart = Date.now();
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - tStart) / 1000);
    const rps = Math.round(ok / Math.max(1, sec));
    process.stdout.write(
      `t=${sec}s sent=${ok} fail=${fail} rps≈${rps} p50=${lat.quantile(
        0.5
      )}ms ` + `p95=${lat.quantile(0.95)}ms p99=${lat.quantile(0.99)}ms      \r`
    );
  }, 1000);

  // stop after duration
  setTimeout(() => {
    clearInterval(timer);
    console.log("\nDONE");
    console.log({
      sent: ok,
      failed: fail,
      p50_ms: lat.quantile(0.5),
      p95_ms: lat.quantile(0.95),
      p99_ms: lat.quantile(0.99),
    });
    process.exit(0);
  }, cfg.durationSec * 1000);
})().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
