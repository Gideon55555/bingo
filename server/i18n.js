// Messages the bot sends to players, in each player's chosen language (Amharic by default).
// Admin-facing messages stay in English.
import { getUser } from './db.js';

const M = {
  am: {
    welcome: 'እንኳን ወደ Amigos Bingo በደህና መጡ! 🎮 ቢንጎ፣ አቪዬተር፣ ኬኖ፣ ሉዶ፣ ፑል እና ከረንቡላ ይጫወቱ። ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ።',
    refBonus: '🎁 የጋበዙት ጓደኛ ገንዘብ አስገብቷል — {amount} የግብዣ ጉርሻ ወደ ሂሳብዎ ተጨምሯል!',
    inviteOpen: '🎮 ጓደኛዎ ለጨዋታ ጋብዞዎታል! ለመቀላቀል ከታች ያለውን ቁልፍ ይጫኑ።', inviteButton: '🎮 ጨዋታውን ተቀላቀል',
    playButton: '🎮 ይጫወቱ',
    balance: 'ቀሪ ሂሳብዎ፦ {amount}',
    help: '/start — መጫወት\n/balance — ቀሪ ሂሳብ\n/id — የቴሌግራም መለያ ቁጥርዎ',
    yourId: 'የቴሌግራም መለያ ቁጥርዎ፦ {id}',
    depositApproved: '✅ {amount} ተቀማጭዎ ጸድቋል። መልካም ዕድል!',
    depositRejected: '❌ {amount} ተቀማጭዎ (የግብይት ቁጥር {ref}) ውድቅ ተደርጓል። ስህተት ከሆነ እባክዎ ያግኙን።',
    withdrawSent: '✅ {amount} ወጪዎ ወደ {phone} ተልኳል።',
    withdrawRejected: '❌ {amount} የወጪ ጥያቄዎ ውድቅ ተደርጓል፤ ገንዘቡ ወደ ቀሪ ሂሳብዎ ተመልሷል።',
    bonusAdded: '🎁 {amount} ወደ ቀሪ ሂሳብዎ ተጨምሯል።{note}',
    deducted: 'ℹ️ {amount} ከቀሪ ሂሳብዎ ተቀንሷል።{note}',
    refunded: '↩️ {amount} ({label}) ተመላሽ ተደርጓል — {why}።',
    whyRestart: 'ጨዋታው በአገልጋይ ዳግም ማስጀመር ምክንያት ተቋርጧል',
    whyMaintenance: 'አገልጋዩ ለጥገና እየተነሳ ነው',
    ludoStarted: '🎲 የሉዶ ጨዋታዎ ከ{names} ጋር ተጀምሯል! መተግበሪያውን ይክፈቱ — የተራ ሰዓትዎ እየሄደ ነው።',
    ludoWon: '🏆 የሉዶ ጨዋታውን አሸንፈዋል! {amount} ወደ ቀሪ ሂሳብዎ ተጨምሯል።',
    ludoLost: 'የሉዶ ጨዋታው አልቋል — {name} አሸንፏል። በሚቀጥለው መልካም ዕድል!',
    poolStarted: '🎱 የፑል ጨዋታዎ ከ{names} ጋር ተጀምሯል! መተግበሪያውን ይክፈቱ — የምት ሰዓቱ እየሄደ ነው።',
    poolWon: '🏆 የፑል ጨዋታውን አሸንፈዋል! {amount} ወደ ቀሪ ሂሳብዎ ተጨምሯል።',
    poolLost: 'የፑል ጨዋታው አልቋል — {name} አሸንፏል። በሚቀጥለው መልካም ዕድል!',
    huntStarted: '👮 የድብብቆሽ ጨዋታዎ ተጀምሯል! መተግበሪያውን ይክፈቱ — ቆጠራው ጀምሯል።',
    huntWon: '🏆 ድብብቆሹን አሸንፈዋል! {amount} ወደ ቀሪ ሂሳብዎ ተጨምሯል።',
    huntLost: 'ድብብቆሹ አልቋል — {name} አሸንፏል። በሚቀጥለው መልካም ዕድል!',
    kbStarted: '🔴 የከረንቡላ ጨዋታዎ ከ{name} ጋር ተጀምሯል! መተግበሪያውን ይክፈቱ — ሰዓቱ እየሄደ ነው።',
    kbWon: '🏆 የከረንቡላ ጨዋታውን አሸንፈዋል! {amount} ወደ ቀሪ ሂሳብዎ ተጨምሯል።',
    kbLost: 'የከረንቡላ ጨዋታው አልቋል — {name} አሸንፏል። በሚቀጥለው መልካም ዕድል!',
  },
  en: {
    welcome: 'Welcome to Amigos Bingo! 🎮 Play Bingo, Aviator, Keno, Ludo, Pool and Kerenbula. Tap the button below to start.',
    refBonus: '🎁 A friend you invited made a deposit — {amount} referral bonus added to your balance!',
    inviteOpen: '🎮 A friend invited you to a match! Tap the button below to join.', inviteButton: '🎮 Join the match',
    playButton: '🎮 Play',
    balance: 'Your balance: {amount}',
    help: '/start — play\n/balance — your balance\n/id — your Telegram id',
    yourId: 'Your Telegram id: {id}',
    depositApproved: '✅ Your deposit of {amount} was approved. Good luck!',
    depositRejected: '❌ Your deposit of {amount} (ref {ref}) was rejected. Contact support if this is a mistake.',
    withdrawSent: '✅ Your withdrawal of {amount} has been sent to {phone}.',
    withdrawRejected: '❌ Your withdrawal of {amount} was rejected and refunded to your balance.',
    bonusAdded: '🎁 {amount} was added to your balance.{note}',
    deducted: 'ℹ️ {amount} was deducted from your balance.{note}',
    refunded: '↩️ Your {amount} entry ({label}) was refunded — {why}.',
    whyRestart: 'the game was interrupted by a server restart',
    whyMaintenance: 'the server is restarting for maintenance',
    ludoStarted: '🎲 Your Ludo game has started against {names}! Open the app — your turn timer is running.',
    ludoWon: '🏆 You won the Ludo game! +{amount} added to your balance.',
    ludoLost: 'Ludo game over — {name} won. Better luck next time!',
    poolStarted: '🎱 Your pool match against {names} has started! Open the app — the shot clock is running.',
    poolWon: '🏆 You won the pool match! +{amount} added to your balance.',
    poolLost: 'Pool match over — {name} won. Better luck next time!',
    huntStarted: '👮 Your Dibibkosh game has started! Open the app — the count is on.',
    huntWon: '🏆 You won Dibibkosh! +{amount} added to your balance.',
    huntLost: 'Dibibkosh is over — {name} won. Better luck next time!',
    kbStarted: '🔴 Your Kerenbula match against {name} has started! Open the app — the clock is running.',
    kbWon: '🏆 You won the Kerenbula match! +{amount} added to your balance.',
    kbLost: 'Kerenbula match over — {name} won. Better luck next time!',
  },
};

export const langOf = (userId) => {
  const l = getUser(userId)?.lang;
  return l === 'am' ? 'am' : 'en'; // English is the default
};

/** Translate a message key for a user. vars fill in {placeholders}. */
export function tr(userId, key, vars = {}) {
  const lang = typeof userId === 'string' && (userId === 'am' || userId === 'en') ? userId : langOf(userId);
  const s = M[lang][key] ?? M.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}
