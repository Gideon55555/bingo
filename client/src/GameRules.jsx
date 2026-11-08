import React from 'react';
import { t, useLang, getLang, crashName } from './i18n.js';
import { fmt } from '../../shared/money.js';
import { GAME_ART } from './GameArt.jsx';

// Rules for each game, in both languages: how to play, how to win, penalties, payouts.
function content(game, cfg, lang) {
  const c = cfg.currency;
  const m = (cents) => `${fmt(cents)} ${c}`;
  const am = lang === 'am';
  const pct = (x) => Math.round(x * 100);

  if (game === 'aviator') {
    const k = cfg.crash;
    return am ? {
      how: [`አውሮፕላኑ ከመነሳቱ በፊት ይወራረዱ (ውርርድ ለ${k.betSec} ሰከንድ ክፍት ነው)።`, 'አውሮፕላኑ ሲበር ማባዣው ከ1.00x ጀምሮ ይጨምራል።',
        'በማንኛውም ጊዜ "ውሰድ" ይጫኑ — ውርርድዎ × ማባዣው ይከፈልዎታል።', 'ራስ-ሰር መውሰጃ በማዘጋጀት በመረጡት ማባዣ በራሱ እንዲወሰድ ማድረግ ይችላሉ።'],
      win: ['አውሮፕላኑ ከመብረሩ በፊት ይውሰዱ።', `ምሳሌ፦ 10 ${c} በ2.50x ቢወስዱ = 25 ${c}።`],
      penalties: ['አውሮፕላኑ ከመውሰድዎ በፊት ከበረረ ውርርድዎን ያጣሉ።', 'አውሮፕላኑ ከተነሳ በኋላ ውርርድ መሰረዝ አይቻልም።', 'በአንድ ዙር አንድ ውርርድ ብቻ።'],
      payouts: [`ውርርድ፦ ${m(k.minBet)} – ${m(k.maxBet)}። በአንድ ውርርድ ከፍተኛ ሽልማት፦ ${m(k.maxWin)}።`, `በአማካይ ለተጫዋቾች የሚመለሰው ${100 - pct(k.houseEdge)}% ነው።`, 'በቴክኒክ ችግር ዙሩ ከተቋረጠ ያልተወሰዱ ውርርዶች ይመለሳሉ።'],
    } : {
      how: [`Place a bet before take-off (bets are open for ${k.betSec} seconds).`, 'As the plane climbs, the multiplier rises from 1.00x.',
        'Tap CASH OUT at any moment to win your bet × the multiplier.', 'Set Auto cash out to cash out automatically at the multiplier you choose.'],
      win: ['Cash out before the plane flies away.', `Example: 10 ${c} cashed out at 2.50x = 25 ${c}.`],
      penalties: ['If the plane flies away before you cash out, you lose your bet.', 'Bets can’t be cancelled after take-off.', 'One bet per round.'],
      payouts: [`Bets: ${m(k.minBet)} – ${m(k.maxBet)}. Maximum win per bet: ${m(k.maxWin)}.`, `Average return to players: ${100 - pct(k.houseEdge)}%.`, 'If a round is interrupted by a technical problem, bets that weren’t cashed out are refunded.'],
    };
  }
  if (game === 'bingo') {
    const cut = pct(cfg.houseCut);
    return am ? {
      how: ['ክፍል ይምረጡ — የክፍሉ መጠን የመግቢያ ክፍያዎ ነው።', 'ካርድ ቁጥር ይምረጡ። ጨዋታው እስኪጀምር ድረስ ካርድ መቀየር ወይም ገንዘብዎን ተመላሽ አድርገው መውጣት ይችላሉ።',
        `ቢያንስ ${cfg.minPlayers} ተጫዋቾች ሲገቡ ቆጠራ ይጀምራል፣ ከዚያ ጨዋታው ይጀምራል።`, 'ቁጥሮች አንድ በአንድ ይጠራሉ፤ በካርድዎ ላይ በራሳቸው ምልክት ይደረግባቸዋል።'],
      win: ['ረድፍ፣ አምድ፣ ሰያፍ ወይም አራቱን ማዕዘኖች ሲያሟሉ "ቢንጎ!" ይጫኑ።', 'መጀመሪያ ትክክለኛ ቢንጎ ያለ ሰው ሽልማቱን ያሸንፋል።', 'በአንድ ቁጥር ብዙ ሰዎች ካሟሉ ሽልማቱን እኩል ይካፈላሉ።'],
      penalties: ['መስመር ሳያሟሉ ቢንጎ ከጫኑ ከዙሩ ይሰረዛሉ፤ የመግቢያ ክፍያዎም አይመለስም።', 'ግንኙነትዎ ቢቋረጥ ጨዋታው ይቀጥላል።'],
      payouts: [`ሽልማት = ሁሉም የመግቢያ ክፍያዎች ሲቀነስ ${cut}% የአገልግሎት ክፍያ።`, 'ሁሉም 75 ቁጥሮች እስኪጠሩ ማንም ቢንጎ ካልጠየቀ መስመር ያሟሉ ሁሉ ይካፈላሉ።', 'በቴክኒክ ችግር ጨዋታው ከተቋረጠ ሁሉም ገንዘብ ይመለሳል።'],
    } : {
      how: ['Choose a room — the room amount is your entry fee.', 'Pick a card number. Until the game starts you can switch cards or leave with a full refund.',
        `Once ${cfg.minPlayers} players have joined, a countdown starts, then the game begins.`, 'Numbers are called one by one and marked on your card automatically.'],
      win: ['Complete a row, column, diagonal, or the four corners, then tap BINGO!', 'The first valid BINGO wins the prize.', 'If several players complete a line on the same number, they share the prize equally.'],
      penalties: ['Tapping BINGO without a complete line disqualifies you from the round — your entry fee is not returned.', 'If you lose connection, the game continues without you.'],
      payouts: [`Prize = all entry fees minus a ${cut}% service fee.`, 'If nobody claims before all 75 numbers are called, everyone holding a line shares the prize.', 'If a game is interrupted by a technical problem, every entry is refunded.'],
    };
  }
  if (game === 'keno') {
    const k = cfg.keno;
    return am ? {
      how: ['ከ1–80 ውስጥ ከ1 እስከ 10 ቁጥሮች ይምረጡ (ወይም "ፈጣን ምርጫ" ይጫኑ)።', 'የውርርድ መጠን ይምረጡና ቲኬት ይግዙ።', `ቲኬት ሽያጭ ለ${k.betSec} ሰከንድ ክፍት ነው፤ ከዚያ 20 ቁጥሮች አንድ በአንድ ይወጣሉ።`],
      win: ['ከመረጧቸው ቁጥሮች ብዙዎቹ በወጡ ቁጥር ብዙ ያሸንፋሉ።', 'የክፍያ ሰንጠረዡ ለቲኬትዎ ምን ያህል እንደሚከፈል ያሳያል።'],
      penalties: ['እጣው ከጀመረ በኋላ ቲኬት መሰረዝ ወይም መቀየር አይቻልም።', 'በአንድ እጣ አንድ ቲኬት ብቻ።'],
      payouts: [`ቲኬት፦ ${m(k.minBet)} – ${m(k.maxBet)}። በአንድ ቲኬት ከፍተኛ ሽልማት፦ ${m(k.maxWin)}።`, 'በአማካይ ለተጫዋቾች የሚመለሰው 94% ገደማ ነው።', 'እጣው በቴክኒክ ችግር ከተቋረጠ ሁሉም ቲኬቶች ይመለሳሉ።'],
    } : {
      how: ['Pick 1 to 10 numbers from 1–80 (or tap Quick pick).', 'Choose your stake and buy a ticket.', `Tickets are open for ${k.betSec} seconds, then 20 numbers are drawn one by one.`],
      win: ['The more of your numbers are drawn, the more you win.', 'The payout table shows exactly what your ticket pays.'],
      penalties: ['Tickets can’t be cancelled or changed after the draw starts.', 'One ticket per draw.'],
      payouts: [`Tickets: ${m(k.minBet)} – ${m(k.maxBet)}. Maximum win per ticket: ${m(k.maxWin)}.`, 'Average return to players: about 94%.', 'If a draw is interrupted by a technical problem, all tickets are refunded.'],
    };
  }
  if (game === 'ludo') {
    const l = cfg.ludo;
    return am ? {
      how: [`እያንዳንዱ ተጫዋች ${l.tokens} ጠጠሮች አሉት።`, 'ጠጠር ከቤት ለማውጣት 6 መጣል ያስፈልጋል። 6 ከጣሉ እንደገና ይጥላሉ (በተከታታይ ሦስተኛ 6 ተራውን ያሳጣል)።',
        'ተጋጣሚ ያለበት ቦታ ላይ ካረፉ ጠጠሩ ወደ ቤቱ ይመለሳል፣ እርስዎም እንደገና ይጥላሉ።', 'የኮከብ እና የመነሻ ቦታዎች ደህና ናቸው — እዚያ ማንም አይበላም።', 'ቤት ለመግባት ትክክለኛው ቁጥር ያስፈልጋል።'],
      win: ['ሁሉንም ጠጠሮቹን መጀመሪያ ወደ ቤት ያስገባ ያሸንፋል።'],
      penalties: [`ለእያንዳንዱ ተራ ${l.turnSec} ሰከንድ አለዎት። ሰዓቱ ካለቀ ጨዋታው ለእርስዎ ይንቀሳቀሳል።`, `በተከታታይ ${l.maxMisses} ተራዎችን ካሳለፉ ጨዋታውን ይሰረዛሉ፤ መግቢያዎንም ያጣሉ።`, 'በጨዋታ መሃል መውጣት እንደ መሸነፍ ይቆጠራል።'],
      payouts: [`አሸናፊው ከጠቅላላው ገንዘብ ${100 - pct(l.houseCut)}% ይወስዳል።`, 'ዳይሶቹ በአገልጋዩ ይጣላሉ፤ ከጨዋታው በኋላ በሚታየው ዘር (seed) ማረጋገጥ ይቻላል።', 'ጨዋታው በቴክኒክ ችግር ከተቋረጠ ሁሉም ገንዘብ ይመለሳል።'],
    } : {
      how: [`Each player has ${l.tokens} tokens.`, 'You need a 6 to bring a token out of base. A 6 gives another roll (a third 6 in a row ends your turn).',
        'Land on an opponent to send their token back to base — and roll again.', 'Star and start squares are safe — nobody can be captured there.', 'You need the exact number to reach home.'],
      win: ['The first player to bring all their tokens home wins.'],
      penalties: [`You have ${l.turnSec} seconds per turn. If time runs out, the game moves for you.`, `Miss ${l.maxMisses} turns in a row and you forfeit — your entry is lost.`, 'Leaving in the middle of a game counts as resigning.'],
      payouts: [`The winner takes ${100 - pct(l.houseCut)}% of the pot.`, 'Dice are rolled on the server and can be checked with the seed shown after the game.', 'If a game is interrupted by a technical problem, everyone is refunded.'],
    };
  }
  if (game === 'pool') {
    const p = cfg.pool;
    const multi = (p.sizes || []).some((s) => s > 2);
    const base = am ? {
      how: ['ለማነጣጠር ጠረጴዛውን ይንኩ (መስመሩ ኳሱ የት እንደሚሄድ ያሳያል)፤ ለመምታት የዱላውን አሞሌ ወደ ታች ጎትተው ይልቀቁ።',
        'መስበሪያው በኋላ ጠረጴዛው ክፍት ነው። መጀመሪያ በትክክል ያስገቡት ኳስ ቡድንዎን ይወስናል — ሙሉ ቀለም (1–7) ወይም ባለ መስመር (9–15)።', 'የራስዎን ኳስ እስካስገቡ ድረስ መምታትዎን ይቀጥላሉ።'],
      win: ['የቡድንዎን ኳሶች በሙሉ ያስገቡ፣ ከዚያ 8 ቁጥሩን ያስገቡ።'],
      penalties: ['ጥፋቶች (ተጋጣሚዎ "ኳስ በእጅ" ያገኛል — ነጩን ኳስ የፈለገበት ያስቀምጣል)፦ ነጩ ኳስ መግባቱ፤ ምንም ኳስ አለመምታት፤ መጀመሪያ የተጋጣሚን ኳስ ወይም 8ን መምታት፤ ከግጭቱ በኋላ ምንም ኳስ ጠርዙን አለመንካት።',
        'ወዲያውኑ ይሸነፋሉ፦ 8 ቁጥሩን ቀድመው ካስገቡ ወይም ከጥፋት ጋር ካስገቡ።', `ለእያንዳንዱ ምት ${p.shotSec} ሰከንድ። ሰዓቱ ካለቀ ጥፋት ነው፤ በተከታታይ ${p.maxMisses} ጊዜ ካለቀ ይሰረዛሉ።`, 'በጨዋታ መሃል መውጣት እንደ መሸነፍ ይቆጠራል።'],
      payouts: [`አሸናፊው ከጠቅላላው ገንዘብ ${100 - pct(p.houseCut)}% ይወስዳል።`, 'እያንዳንዱ ምት በአገልጋዩ ይሰላል — ማንም ውጤቱን ማጭበርበር አይችልም።', 'ጨዋታው በቴክኒክ ችግር ከተቋረጠ ሁሉም ገንዘብ ይመለሳል።'],
    } : {
      how: ['Touch the table to aim (the guide shows where the balls will go); pull the power bar down and let go to shoot.',
        'After the break the table is open. The first ball you legally pot decides your group — solids (1–7) or stripes (9–15).', 'You keep shooting as long as you pot your own balls.'],
      win: ['Pot all the balls in your group, then pot the 8 ball.'],
      penalties: ['Fouls (your opponent gets ball in hand — they can place the white ball anywhere): potting the white ball; hitting no ball; hitting the opponent’s ball or the 8 first; no ball touching a cushion after contact.',
        'Instant loss: potting the 8 too early, or together with a foul.', `${p.shotSec} seconds per shot. Running out of time is a foul; ${p.maxMisses} times in a row and you forfeit.`, 'Leaving in the middle of a match counts as resigning.'],
      payouts: [`The winner takes ${100 - pct(p.houseCut)}% of the pot.`, 'Every shot is calculated on the server — nobody can fake a result.', 'If a match is interrupted by a technical problem, everyone is refunded.'],
    };
    if (multi) {
      base.how.push(am ? '3 ወይም ከዚያ በላይ ተጫዋቾች (ካትስሮት)፦ እያንዳንዱ ተጫዋች የኳስ ቡድን አለው፤ የተጋጣሚዎችዎን ኳሶች ያስገቡ። ኳሱ የቀረው የመጨረሻው ተጫዋች ያሸንፋል። ጥፋት ከሰሩ እያንዳንዱ ተጋጣሚ አንድ ኳሱ ይመለስለታል።'
        : '3+ players (Cutthroat): each player owns a set of balls; pot your opponents’ balls. The last player with balls left wins. On a foul, every opponent gets one ball back.');
    }
    return base;
  }
  return { how: [], win: [], penalties: [], payouts: [] };
}

const TITLES = {
  am: { how: '🎮 አጨዋወት', win: '🏆 እንዴት ያሸንፋሉ', penalties: '⚠️ ቅጣቶች እና ጥፋቶች', payouts: '💰 ክፍያ' },
  en: { how: '🎮 How to play', win: '🏆 How to win', penalties: '⚠️ Penalties & fouls', payouts: '💰 Payouts' },
};

export default function GameRules({ game, cfg, onClose }) {
  useLang();
  const lang = getLang();
  const c = content(game, cfg, lang);
  const Art = GAME_ART[game];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="result rules" onClick={(e) => e.stopPropagation()}>
        <div className="rules-head">
          {Art && <div className="rules-art"><Art /></div>}
          <h2>{game === 'aviator' ? crashName(cfg) : t(`g_${game}`)}</h2>
        </div>
        {['how', 'win', 'penalties', 'payouts'].map((k) => c[k]?.length ? (
          <div key={k} className={`rules-sec ${k}`}>
            <h3>{TITLES[lang][k]}</h3>
            <ul>{c[k].map((line, i) => <li key={i}>{line}</li>)}</ul>
          </div>
        ) : null)}
        <div className="age">{t('ageNote', { age: cfg.minAge })}{cfg.supportContact ? ` · ${t('help')}: ${cfg.supportContact}` : ''}</div>
        <button className="primary" onClick={onClose}>{t('gotIt')}</button>
      </div>
    </div>
  );
}

const seenKey = (g) => `rules_seen_${g}`;
export const rulesSeen = (g) => { try { return localStorage.getItem(seenKey(g)) === '1'; } catch { return true; } };
export const markRulesSeen = (g) => { try { localStorage.setItem(seenKey(g), '1'); } catch { /* ignore */ } };
