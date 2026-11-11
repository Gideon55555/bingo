// Demo players for testing and classroom demos — NOT for real-money use.
// The server refuses to start with DEMO_PLAYERS=true when NODE_ENV=production, and the app shows a
// "demo — test money" ribbon to everyone while it is on.
//
// They behave like ordinary Bingo players: each takes ONE cartela in a waiting room, pays the entry
// from a play-money balance, and presses BINGO a moment after getting a line.
import { config } from './config.js';
import { db, upsertUser, getUser } from './db.js';
import { KENO_NUMBERS } from '../shared/keno.js';

const NAMES = ['አበበ', 'ከበደ', 'ትግስት', 'ሄኖክ', 'ሰላም', 'ዳዊት', 'ማህሌት', 'ዮናስ', 'ቤተልሔም', 'ሳሙኤል', 'ሕይወት', 'ተስፋዬ',
  'መሠረት', 'ብሩክ', 'ራሔል', 'ናትናኤል', 'ፍቅርተ', 'ግርማ', 'አስቴር', 'ኤልያስ', 'ሊዲያ', 'ታደሰ', 'ሜሮን', 'ያሬድ',
  'ሙሉጌታ', 'ሰናይት', 'በረከት', 'እየሩሳሌም', 'ዮሐንስ', 'ማርታ', 'ፀጋዬ', 'ሀና', 'ቴዎድሮስ', 'አልማዝ', 'ካሳሁን', 'ትዕግስት',
  'መላኩ', 'ሶስና', 'አማኑኤል', 'ገነት', 'ደረጀ', 'ብርቱካን', 'ሚካኤል', 'ዘነበች', 'ፍሬው', 'ሩት', 'አንዱዓለም', 'ወይንሸት',
  'እዮብ', 'ሳራ', 'ጌታቸው', 'ቅድስት', 'ሀብታሙ', 'ንግስት', 'ቢኒያም', 'የሺ', 'ኪሩቤል', 'አዜብ', 'መስፍን', 'ሄለን'];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[rnd(0, arr.length - 1)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/** Round-looking bet sizes (in cents) inside a game's limits, small ones more common. */
const betSizes = (min, max) => { const v = [5, 5, 10, 10, 10, 20, 20, 50, 100, 200].map((e) => e * 100).filter((c) => c >= min && c <= max); return v.length ? v : [min]; };

export function startDemoPlayers(games) {
  if (!config.demo.players || config.production) return () => {};
  const { bingo, aviator, keno } = config.demo;
  const all = NAMES.map((first_name, i) => upsertUser({ id: `demo:${i + 1}`, first_name }));
  const crew = (n) => shuffle(all).slice(0, Math.max(0, Math.min(all.length, n)));
  const bots = crew(bingo);          // Bingo regulars
  const flyers = crew(aviator);      // Aviator regulars
  const tickets = crew(keno);        // Keno regulars
  const topUp = db.prepare("UPDATE users SET balance = 100000000 WHERE id LIKE 'demo:%' AND balance < 50000000");
  const want = new Map();     // stake → how many demo players this Bingo round should get
  const claiming = new Set(); // `${stake}:${uid}` already about to press BINGO
  const round = { crash: null, keno: null }; // who is still to bet in the current round
  console.log(`[demo] demo players are on (play money, testing only): Bingo ${bots.length}, Aviator ${flyers.length}, Keno ${tickets.length}`);

  /** Aviator / Keno: a different part of the crowd joins each round, a few at a time during betting. */
  const trickle = (key, game, crowd, place) => {
    if (!game || !crowd.length || game.phase !== 'betting') { if (game?.phase !== 'betting') round[key] = null; return; }
    if (!round[key] || round[key].no !== game.roundNo) round[key] = { no: game.roundNo, queue: shuffle(crowd).slice(0, rnd(Math.ceil(crowd.length * 0.6), crowd.length)) };
    for (let k = rnd(0, Math.max(1, Math.ceil(round[key].queue.length / 2.5))); k > 0 && round[key].queue.length; k--) {
      const u = round[key].queue.pop();
      try { place(getUser(u.id)); } catch { /* betting just closed */ }
    }
  };

  const tick = () => {
    if (games.paused) return;
    topUp.run();
    if (config.crash.enabled) trickle('crash', games.crash, flyers, (u) => {
      // most people cash out early, a few hold on for a big one
      const auto = Math.min(config.crash.maxMultiplier, Math.round(100 * (1.1 + -Math.log(1 - Math.random()) * 1.4)));
      games.crash.bet(u, pick(betSizes(config.crash.minBet, config.crash.maxBet)), Math.max(101, auto));
    });
    if (config.keno.enabled) trickle('keno', games.keno, tickets, (u) => {
      const nums = shuffle(Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1)).slice(0, rnd(2, 8));
      games.keno.buy(u, nums, pick(betSizes(config.keno.minBet, config.keno.maxBet)));
    });
    if (!config.bingoEnabled) return;
    for (const room of games.rooms.values()) {
      const inRoom = bots.filter((b) => room.players.has(b.id));
      if (['waiting', 'countdown'].includes(room.state) && !room.retired) {
        if (!inRoom.length && !want.has(room.stake)) want.set(room.stake, rnd(Math.min(3, bots.length), Math.min(8, bots.length)));
        const target = want.get(room.stake) ?? 0;
        // people trickle in rather than all arriving at once
        if (inRoom.length < target && Math.random() < 0.3) {
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
  const iv = setInterval(tick, 900);
  iv.unref?.();
  return () => clearInterval(iv);
}
