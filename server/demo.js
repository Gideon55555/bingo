// Demo players for testing and classroom demos — NOT for real-money use.
// The server refuses to start with DEMO_PLAYERS=true when NODE_ENV=production, and the app shows a
// "demo — test money" ribbon to everyone while it is on.
//
// They behave like ordinary Bingo players: each takes ONE cartela in a waiting room, pays the entry
// from a play-money balance, and presses BINGO a moment after getting a line.
import { config } from './config.js';
import { db, upsertUser, getUser } from './db.js';

const NAMES = ['አበበ', 'ከበደ', 'ትግስት', 'ሄኖክ', 'ሰላም', 'ዳዊት', 'ማህሌት', 'ዮናስ', 'ቤተልሔም', 'ሳሙኤል', 'ሕይወት', 'ተስፋዬ',
  'መሠረት', 'ብሩክ', 'ራሔል', 'ናትናኤል', 'ፍቅርተ', 'ግርማ', 'አስቴር', 'ኤልያስ', 'ሊዲያ', 'ታደሰ', 'ሜሮን', 'ያሬድ'];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function startDemoPlayers(games) {
  if (!config.demo.players || config.production) return () => {};
  const bots = NAMES.slice(0, Math.max(2, Math.min(NAMES.length, config.demo.count))).map((first_name, i) => upsertUser({ id: `demo:${i + 1}`, first_name }));
  const topUp = db.prepare("UPDATE users SET balance = 100000000 WHERE id LIKE 'demo:%' AND balance < 50000000");
  const want = new Map();     // stake → how many demo players this round should get
  const claiming = new Set(); // `${stake}:${uid}` already about to press BINGO
  console.log(`[demo] ${bots.length} demo Bingo players are on (play money, testing only)`);

  const tick = () => {
    if (!config.bingoEnabled || games.paused) return;
    topUp.run();
    for (const room of games.rooms.values()) {
      const inRoom = bots.filter((b) => room.players.has(b.id));
      if (['waiting', 'countdown'].includes(room.state) && !room.retired) {
        if (!inRoom.length && !want.has(room.stake)) want.set(room.stake, rnd(Math.min(3, bots.length), Math.min(8, bots.length)));
        const target = want.get(room.stake) ?? 0;
        // people trickle in rather than all arriving at once
        if (inRoom.length < target && Math.random() < 0.45) {
          const free = bots.filter((b) => !room.players.has(b.id) && ![...games.rooms.values()].some((r) => r !== room && r.players.has(b.id)));
          const bot = free[rnd(0, free.length - 1)];
          if (bot) {
            for (let tries = 0; tries < 20; tries++) {
              const card = rnd(1, config.cardCount);
              if (room.cardOwners.has(card)) continue;
              try { room.pick(getUser(bot.id), card); } catch { /* room just started or card taken */ }
              break;
            }
          }
        }
      } else if (room.state === 'playing') {
        want.delete(room.stake);
        for (const b of inRoom) {
          const p = room.players.get(b.id), key = `${room.stake}:${b.id}`;
          if (p.disqualified || claiming.has(key) || !room.winningCards(p).length) continue;
          claiming.add(key);
          setTimeout(() => {
            claiming.delete(key);
            try { if (room.state === 'playing' && room.players.has(b.id)) room.claim(b); } catch { /* someone was faster */ }
          }, rnd(700, 2600)); // reaction time, like a person
        }
      } else want.delete(room.stake);
    }
  };
  const iv = setInterval(tick, 1500);
  iv.unref?.();
  return () => clearInterval(iv);
}
