

import fetch from 'node-fetch'

const roomId = process.argv[2]
const userId = process.argv[3]

if (!roomId || !userId) {
  console.log('usage: npm run poller -- <roomId> <userId>')
  process.exit(1)
}

let afterSeq = 0

async function loop() {
  try {
    const res = await fetch(`http://localhost:8080/rooms/${roomId}/messages?after_seq=${afterSeq}`)
    const j = (await res.json()) as { messages: any[]; next_after_seq: number };

    for (const m of j.messages) {
      console.log(`[${m.seq}] ${m.user_id.slice(0, 8)}: ${m.body}`)
    }
    afterSeq = j.next_after_seq
  } catch(e:any) {
    console.error('poll error', e.message)
  } finally {
    // avoid thundering herds... kinda
    const jitterMs = 100 + Math.floor(Math.random() * 200)
    setTimeout(loop, 1000 + jitterMs)
  }
}

loop()
