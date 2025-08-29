import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { z } from "zod";

const PORT = parseInt(process.env.PORT || "8080", 10);
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://chat:chat@localhost:5432/chat";

const pool = new Pool({ connectionString: DATABASE_URL });

// --- tiny logger ---
function log(evt: string, meta: Record<string, unknown> = {}) {
  const rec = { ts: Date.now(), evt, ...meta };
  console.log(JSON.stringify(rec));
}

const app = express();
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    log("http", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(durMs),
    });
  });
  next();
});

// --- zod schemas ---
const CreateRoomRequest = z.object({ name: z.string().min(1).max(120) });
const SendMsgReq = z.object({
  user_id: z.string().uuid(),
  body: z.string().min(1).max(4000),
});

app.post("/rooms", async (req, res) => {
  const parse = CreateRoomRequest.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const client = await pool.connect();

  try {
    const row = await client.query(
      `INSERT INTO room(name) VALUES($1) RETURNING id::text, name`,
      [parse.data.name]
    );
    const r = row.rows[0];
    log("create_room", { name: r.name });
    res.json({ id: r.id, name: r.name });
  } finally {
    client.release();
  }
});

app.post("/rooms/:roomId/messages", async (req, res) => {
  const { roomId } = req.params;
  const parse = SendMsgReq.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const client = await pool.connect();

  try {
    const exists = await client.query("SELECT 1 FROM room WHERE id = $1", [roomId]);
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "room not found" });
    }

    await client.query(
      `INSERT INTO message(room_id, user_id, body) VALUES ($1, $2, $3)`,
      [roomId, parse.data.user_id, parse.data.body]
    );

    log("send_message", { room_id: roomId });
    res.status(201).json({ status: "ok" });
  } finally {
    client.release();
  }
});

app.get("/rooms/:roomId/messages", async (req, res) => {
  const { roomId } = req.params;
  const afterSeq = Number(req.query.after_seq ?? "0");
  const limit = Math.min(Math.max(Number(req.query.limit ?? "50"), 1), 200);

  if (!Number.isFinite(afterSeq) || afterSeq < 0) {
    return res.status(400).json({ error: "after_seq must be >= 0" });
  }

  const client = await pool.connect();

  try {
    const rows = await client.query(
      `
      SELECT id::text, room_id::text, user_id::text, seq, body, created_at::text
      FROM message
      WHERE room_id = $1 AND seq > $2
      ORDER BY seq ASC
      LIMIT $3
      `,
      [roomId, afterSeq, limit]
    );
    const messages = rows.rows;
    const next_after_seq = messages.length
      ? messages[messages.length - 1].seq
      : afterSeq;

    log("poll", {
      room_id: roomId,
      after_seq: afterSeq,
      returned: messages.length,
    });
    res.json({ messages, next_after_seq });
  } finally {
    client.release();
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => {
  log("boot", { port: PORT });
});
