// Amharic (default) + English. Every player-facing text goes through t().
import { useSyncExternalStore } from 'react';

const D = {
  am: {
    // general
    loading: 'በመጫን ላይ…', games: 'ጨዋታዎች', play: 'ተጫወት', wallet: 'ቦርሳ', rules: 'ደንቦች', back: 'ተመለስ',
    join: 'ተቀላቀል', leave: 'ውጣ', cancel: 'ሰርዝ', gotIt: 'ገባኝ፣ እንጫወት', players: 'ተጫዋቾች', prize: 'ሽልማት', pot: 'ጠቅላላ ገንዘብ',
    you: 'እርስዎ', paused: 'ጨዋታዎች ለጥገና ቆመዋል። እባክዎ ቆይተው ይመለሱ።', pausedShort: 'ለጥገና ቆሟል', live: 'በቀጥታ',
    playingNow: '{n} እየተጫወቱ', openFromBot: 'እባክዎ ይህን መተግበሪያ ከቴሌግራም ቦት ይክፈቱ።',
    replacedConn: 'መተግበሪያው በሌላ ስልክ ወይም መስኮት ተከፍቷል — እዚህ ተቋርጧል። ለመቀጠል እንደገና ይክፈቱ።',
    restarting: 'አገልጋዩ ለጥገና እየተነሳ ነው — እንደገና በመገናኘት ላይ… ያልተጠናቀቀ ጨዋታ ገንዘብ ይመለሳል።',
    ageNote: '🔞 {age}+ ብቻ · በኃላፊነት ይጫወቱ', help: 'እርዳታ', balanceLow: 'ቀሪ ሂሳብዎ በቂ አይደለም — በቦርሳ ገንዘብ ያስገቡ።',
    backToGames: '← ጨዋታዎች', seconds: '{n} ሰከንድ', language: 'ቋንቋ',
    // game names + taglines
    g_aviator: 'አቪዬተር', g_bingo: 'ቢንጎ', g_keno: 'ኬኖ', g_ludo: 'ሉዶ', g_pool: '8-ቦል ፑል', g_kerenbula: 'ከረንቡላ',
    tag_aviator: 'አውሮፕላኑ ከመብረሩ በፊት ይውሰዱ', tag_bingo: 'መስመር ያሟሉ፣ ቢንጎ ይበሉ', tag_keno: 'እስከ 10 ቁጥሮች ይምረጡ',
    tag_ludo: '1 ለ 1 ወይም 4 ተጫዋቾች', tag_pool: '1 ለ 1 የችሎታ ጨዋታ', tag_kerenbula: '1 ለ 1 · በእጅ የሚንከባለል', moreSoon: 'ተጨማሪ ጨዋታዎች', moreSoonTag: 'በቅርቡ ይመጣሉ',
    st_betting: 'ውርርድ ክፍት', st_flying: 'በበረራ ላይ', st_open: 'ክፍት', st_drawing: 'እጣ በማውጣት ላይ', st_pvp: 'ተጫዋች ከተጫዋች', st_skill: 'ችሎታ',
    // bingo
    bingoRooms: 'የቢንጎ ክፍሎች', bingoIntro: 'ካርድ ይምረጡ፣ ቁጥሮቹን ይጠብቁ፣ ረድፍ፣ አምድ፣ ሰያፍ ወይም አራቱን ማዕዘኖች ሲያሟሉ ቢንጎ ይጫኑ። አሸናፊው ሽልማቱን ይወስዳል።',
    r_waiting: 'ተጫዋቾችን በመጠበቅ ላይ', r_countdown: 'በቅርቡ ይጀምራል', r_playing: 'በሂደት ላይ', r_finished: 'ተጠናቋል',
    startsIn: 'በ{n} ሰከንድ ይጀምራል', watch: 'ተመልከት', room: 'ክፍል', gameStartsIn: 'ጨዋታው በ{n} ሰከንድ ይጀምራል',
    waitingMore: '{n} ተጨማሪ ተጫዋች(ዎች) በመጠበቅ ላይ…', switchCard: 'ወደ ካርድ #{n} ቀይር', playCard: 'ካርድ #{n} ይጫወቱ — {amount}',
    inWithCard: '✅ በካርድ #{n} ገብተዋል', leaveRefund: 'ውጣ እና ገንዘብ ተመላሽ', pickCard: 'ካርድዎን ይምረጡ', pickCards: 'እስከ {max} ካርዶች ይምረጡ',
    practiceFree: 'ልምምድ (ነፃ)', signupBonusGot: '🎁 እንኳን ደህና መጡ! {amount} የመመዝገቢያ ስጦታ ተጨምሯል።', settings: 'ቅንብሮች', setEffects: 'የጨዋታ ድምፆች', setVoice: 'የቢንጎ የድምፅ ጠሪ (አማርኛ)', setVoiceHelp: 'ቁጥሮችን ጮክ ብሎ ይጠራል', setLowData: 'ዳታ ቆጣቢ', setLowDataHelp: 'ጨዋታዎችን አስቀድሞ አያወርድም',
    dailyTitle: 'የዕለት ስጦታ', dailyReady: 'ዛሬ {amount} ይውሰዱ!', dailyTomorrow: 'ዛሬ ወስደዋል — ነገ ይመለሱ', dailyDepositFirst: 'የመጀመሪያ ተቀማጭዎን ሲያስገቡ ይከፈታል',
    claim: 'ውሰድ', dailyClaimed: '🎁 {amount} ተጨምሯል!', refTitle: 'ጓደኛ ጋብዘው {amount} ያግኙ', refHow: 'ጓደኛዎ በሊንክዎ ገብቶ {min} ወይም በላይ ሲያስገባ።',
    refStats: '{invited} ተጋብዘዋል · {qualified} አስገብተዋል · {earned} አግኝተዋል', share: 'አጋራ', refShareText: 'ቢንጎ፣ ሉዶ፣ ፑል፣ ከረንቡላ እና ሌሎችም — ና አብረን እንጫወት! 🎮',
    lbTitle: 'የሳምንቱ ምርጥ አሸናፊዎች', lbEmpty: 'በዚህ ሳምንት እስካሁን አሸናፊ የለም — የመጀመሪያው ይሁኑ!', showAll: 'ሁሉንም አሳይ', showLess: 'ያነሰ አሳይ',
    tx_bonus: 'ጉርሻ', bonusLocked: 'አሁን ማውጣት የሚችሉት፦ {amount}። {toPlay} ተጨማሪ ሲጫወቱ የጉርሻ ገንዘብዎ ይከፈታል።', inviteFriend: 'ጓደኛ ጋብዝ', inviteHow: 'የግል ጠረጴዛ ለመክፈት ጠረጴዛ ይምረጡ — ከዚያ ሊንኩን ለጓደኛዎ ይላኩ።',
    inviteCode: 'የግብዣ ኮድ', sendInvite: 'ግብዣ ላክ', copyLink: 'ሊንክ ቅዳ', copied: 'ተቀድቷል', inviteShareText: 'ና አብረን እንጫወት! 🎮',
    inviteExpires: 'ጓደኛዎ በ30 ደቂቃ ውስጥ ካልመጣ ገንዘብዎ ይመለሳል።', privateTable: 'የግል ጠረጴዛ — ጓደኛዎን በመጠበቅ ላይ',
    practiceBadge: '🤖 ልምምድ — ነፃ፣ ገንዘብ የለም', practiceWon: '🎉 አሸነፉ! (ልምምድ)', practiceLost: 'ቦቱ አሸነፈ — እንደገና ይሞክሩ!', playAgain: 'እንደገና ተጫወት', online: '{n} በመስመር ላይ',
    ageTitle: 'እድሜዎ {age} ወይም ከዚያ በላይ ነው?', ageText: 'በገንዘብ የሚደረጉ ጨዋታዎች ለ{age} ዓመት እና ከዚያ በላይ ለሆኑ ብቻ ናቸው።', ageYes: 'አዎ፣ {age} ዓመት ወይም በላይ ነኝ',
    ageUnder: 'አይ፣ ከ{age} በታች ነኝ', ageNo: 'ይቅርታ — እነዚህ ጨዋታዎች ለ{age}+ ብቻ ናቸው።', back: 'ተመለስ',
    rcTitle: 'ትንሽ እረፍት?', rcPlayed: 'ለ{min} ደቂቃ ተጫውተዋል።', rcStaked: 'ዛሬ የተወራረዱት', rcWon: 'ያሸነፉት', rcNet: 'ውጤት', rcContinue: 'ቀጥል', rcBreak: 'እረፍት ልውሰድ',
    playSafe: 'በኃላፊነት ይጫወቱ', depLimits: 'የተቀማጭ ገደብ', depLimitsHelp: 'ገደብ መቀነስ ወዲያውኑ ይሰራል፤ መጨመር ወይም ማንሳት ከ24 ሰዓት በኋላ ይሰራል።',
    perDay: 'በቀን', perWeek: 'በሳምንት', now: 'አሁን', used: 'ጥቅም ላይ የዋለ', noLimit: 'ገደብ የለም', saveLimits: 'ገደብ አስቀምጥ', limitSaved: 'ገደቡ ተቀምጧል',
    limitRaiseLater: 'ገደብ መጨመር {when} ላይ ይሰራል', limitPending: 'የገደብ ጭማሪ {when} ላይ ይሰራል',
    reminderTitle: 'የጨዋታ ጊዜ ማስታወሻ', everyMin: 'በየ{m} ደቂቃ', off: 'አጥፋ',
    takeBreak: 'ከጨዋታ እረፍት', takeBreakHelp: 'ለተመረጠው ጊዜ መጫወትና ገንዘብ ማስገባት አይችሉም (ቀሪ ሂሳብዎን ግን ማውጣት ይችላሉ)። ቀድሞ መሰረዝ አይቻልም።',
    nDays: '{n} ቀን', months6: '6 ወር', excludeConfirm: 'ለ{days} ቀናት እረፍት ይወስዳሉ? በዚህ ጊዜ መጫወትና ማስገባት አይችሉም፤ ቀድሞ መሰረዝ አይቻልም።',
    excludedUntil: 'እስከ {date} ድረስ እረፍት ላይ ነዎት', excludedBanner: 'እስከ {date} ድረስ እረፍት ላይ ነዎት። ቀሪ ሂሳብዎን ማውጣት ይችላሉ።', needHelp: 'እርዳታ ከፈለጉ፦', voiceCaller: 'የድምፅ ጠሪ', addCard: 'ካርድ #{n} ጨምር — {amount}', removeCard: 'ካርድ #{n} አስወግድ (ገንዘብ ይመለሳል)', myCardsN: 'የእርስዎ ካርዶች ({n}/{max})፦', maxCardsReached: '{max} ካርዶች ይዘዋል — ሌላ ለመምረጥ አንዱን ያስወግዱ', nCards: '{n} ካርዶች', changeCard: 'ካርድ ይቀይሩ',
    calledOf: '{n}/75 ተጠርቷል', falseBingo: '❌ የተሳሳተ ቢንጎ — ከዚህ ዙር ወጥተዋል።', autoMark: 'ራስ-ሰር ምልክት', bingoBtn: 'ቢንጎ!',
    watching: 'ይህን ጨዋታ እየተመለከቱ ነው። ቀጣዩ ዙር ይህ ሲያልቅ ይከፈታል።', youWon: '🎉 {amount} አሸንፈዋል!', gameOver: 'ጨዋታው አልቋል',
    noWinner: 'አሸናፊ የለም', nextRoundSoon: 'ቀጣዩ ዙር በቅርቡ ይጀምራል…', backToRooms: 'ወደ ክፍሎች ተመለስ', card: 'ካርድ #{n}',
    // wallet
    balance: 'ቀሪ ሂሳብ', deposit: 'ገንዘብ አስገባ', withdraw: 'ገንዘብ አውጣ', sendMoneyTo: 'ገንዘብ ወደዚህ ይላኩ፦',
    depositStep2: 'የላኩትን መጠን እና ከማረጋገጫ መልዕክቱ (SMS) ያገኙትን የግብይት ቁጥር ያስገቡ።', amountMin: 'መጠን (ቢያንስ {min})',
    txId: 'የግብይት ቁጥር (ለምሳሌ CHK3A1B2C)', phoneReceive: 'ገንዘብ የሚቀበሉበት ስልክ ቁጥር', submitDeposit: 'ተቀማጭ ላክ',
    requestWithdraw: 'ወጪ ጠይቅ', sending: 'በመላክ ላይ…', history: 'ታሪክ', noTx: 'እስካሁን ምንም ግብይት የለም።',
    depositSent: 'ተቀማጩ ተልኳል! ሲጸድቅ ቀሪ ሂሳብዎ ይዘመናል።', withdrawSent: 'የወጪ ጥያቄ ተልኳል። ገንዘቡ ሲላክ መልዕክት ይደርስዎታል።',
    tx_deposit: 'ተቀማጭ', tx_withdraw: 'ወጪ', tx_bet: 'ውርርድ / መግቢያ', tx_win: 'ሽልማት', tx_refund: 'ተመላሽ', tx_adjust: 'ቦነስ / ማስተካከያ',
    s_pending: 'በመጠባበቅ ላይ', s_approved: 'ጸድቋል', s_rejected: 'ውድቅ ሆኗል',
    // aviator
    placeBets: 'ውርርድዎን ያስቀምጡ', flewAway: 'በረረ!', bet: 'ተወራረድ', nextRound: 'ለቀጣዩ ዙር', cashOut: 'ውሰድ',
    waitingTakeoff: 'መነሳቱን በመጠበቅ ላይ', betNextRound: 'ለቀጣዩ ዙር ውርርድ', autoCashAt: 'በራስ-ሰር ውሰድ በ',
    yourBet: 'ውርርድዎ፦ {amount}', autoX: 'ራስ-ሰር {x}', wonAt: 'በ{x} {amount} አሸንፈዋል', lost: 'ተሸንፈዋል',
    betsThisRound: 'የዚህ ዙር ውርርዶች', noBets: 'እስካሁን ውርርድ የለም።', howFair: '📖 አጨዋወት እና ፍትሃዊነት', hide: 'ደብቅ',
    pausedMaint: '⏸ ለጥገና ቆሟል', roundHash: 'የዙሩ ሃሽ', lastSeed: 'የቀድሞው ዘር (seed)',
    provablyFair: 'ፍትሃዊነቱ የሚረጋገጥ ነው፦ ውርርድ ከመከፈቱ በፊት የሚስጥር ዘር (seed) ሃሽ ይታተማል፤ ዙሩ ካለቀ በኋላ ዘሩ ይገለጣል። SHA-256(ዘር) ከሃሹ ጋር መመሳሰሉን ያረጋግጡ — ውጤቱ ማንም ከመወራረዱ በፊት የተወሰነ ነበር። የመውደቂያው ነጥብ ከHMAC-SHA256(ዘር, "rocket") ይሰላል።',
    // keno
    nextDrawIn: 'ቀጣዩ እጣ በ', tickets: '{n} ቲኬት(ቶች)', drawingN: 'እጣ በማውጣት ላይ… {n}/20', youHitSoFar: 'ያገኙት፦ {n}',
    hitWon: '🎉 {h}/{p} አግኝተዋል — {amount} አሸንፈዋል', hitNoWin: '{h}/{p} አግኝተዋል — በዚህ ጊዜ አላሸነፉም', drawDone: 'እጣው ተጠናቋል',
    numbersPicked: '{n}/{max} ቁጥሮች ተመርጠዋል', quickPick: '🎲 ፈጣን ምርጫ', clear: 'አጽዳ', buyTicket: 'ቲኬት ግዛ',
    pickNumbers: 'ቁጥሮችን ይምረጡ', pickRange: 'ከሰሌዳው 1–{max} ቁጥሮችን ይምረጡ', nNumbers: '{n} ቁጥሮች · {amount}',
    cancelTicket: 'ቲኬት ሰርዝ', ticketInPlay: 'ቲኬቱ በጨዋታ ላይ ነው', forNextDraw: 'ለቀጣዩ እጣ · {n} ቁጥሮች · {amount}', buy: 'ግዛ',
    cancelNextTicket: 'የቀጣዩን እጣ ቲኬት', payoutsFor: 'ለ{n} ቁጥር(ሮች) ክፍያ', hits: '{n} ግጥሚያ', winnersDraw: 'የዚህ እጣ አሸናፊዎች',
    maxPicks: 'እስከ {n} ቁጥሮች መምረጥ ይችላሉ',
    kenoFair: 'ፍትሃዊነቱ የሚረጋገጥ ነው፦ ቲኬት ሽያጭ ከመዘጋቱ በፊት የሚስጥር ዘር ሃሽ ይታተማል፤ ከእጣው በኋላ ዘሩ ይገለጣል። 20ዎቹ ቁጥሮች ከዘሩ በHMAC-SHA256 የሚወጡ ናቸው — ማንም ማረጋገጥ ይችላል።',
    // ludo
    ludoIntro: '{tokens} ጠጠሮችዎን ከተጋጣሚዎችዎ በፊት ወደ ቤት ያስገቡ። ከቤት ለመውጣት 6 ይጣሉ፣ ተጋጣሚን በመርገጥ ወደ ቤቱ ይመልሱ። አሸናፊው {pct}% ይወስዳል። ለእያንዳንዱ ተራ {sec} ሰከንድ።',
    oneVone: '1 ለ 1', fourPlayers: '4 ተጫዋቾች', waitingN: '{n}/{size} በመጠበቅ ላይ', waitingPlayers: 'ተጫዋቾችን በመጠበቅ ላይ…',
    tableInfo: '{kind} · መግቢያ {stake} · ሽልማት {prize}', startsWhenFull: 'ጠረጴዛው እንደሞላ ጨዋታው ይጀምራል። በቴሌግራምም መልዕክት እንልክልዎታለን።',
    leaveTable: 'ጠረጴዛውን ልቀቅ እና ገንዘብ ተመላሽ', tables: '← ጠረጴዛዎች', leftGame: 'ጨዋታውን ለቋል', missedN: '⚠️ {n}/{max} አምልጧል',
    yourTurnRoll: 'ተራዎ ነው — ዳይሱን ይንኩ!', tapToken: 'ለማንቀሳቀስ የሚያበራ ጠጠር ይንኩ', turnOf: 'የ{name} ተራ', sixAgain: 'ስድስት! እንደገና ይጣሉ…',
    noMove: 'የሚቻል እንቅስቃሴ የለም', youRolled: '{n} ጣሉ', gameStarting: 'ጨዋታው በመጀመር ላይ…', youWonPrize: '🏆 {amount} አሸንፈዋል!',
    nameWon: '{name} አሸነፈ', allHome: 'ሁሉንም ጠጠሮች መጀመሪያ ወደ ቤት አስገብቷል።', wonBecause: 'ያሸነፈው፦ {how}', backToTables: 'ወደ ጠረጴዛዎች ተመለስ',
    diceSeed: 'የዳይስ ዘር (seed)፦ {seed}', confirmForfeit: 'ጨዋታውን ትተው ይውጡ? የ{amount} መግቢያዎን ያጣሉ።', diceVerify: 'ዳይሶቹ በአገልጋዩ ይጣላሉ፤ ከእያንዳንዱ ጨዋታ በኋላ በሚታየው ዘር (seed) ማረጋገጥ ይቻላል።',
    // pool
    poolIntro: 'ክላሲክ 8-ቦል፣ 1 ለ 1። የእርስዎን ሙሉ ቀለም ወይም ባለ መስመር ኳሶች ያስገቡ፣ ከዚያ 8 ቁጥርን። ጥፋት ለተጋጣሚዎ "ኳስ በእጅ" ይሰጣል። ለእያንዳንዱ ምት {sec} ሰከንድ። አሸናፊው {pct}% ይወስዳል።',
    winX: '🏆 {amount} ያሸንፉ', oneWaiting: '1 ተጫዋች እየጠበቀ ነው — አሁን ይቀላቀሉ!', findingOpp: 'ተጋጣሚ በመፈለግ ላይ…',
    poolEntryInfo: 'መግቢያ {stake} · አሸናፊው {prize} ያገኛል', matchStartsWhen: 'ሌላ ተጫዋች እንደተቀላቀለ ጨዋታው ይጀምራል። በቴሌግራምም መልዕክት እንልክልዎታለን።',
    breaking: 'በመስበር ላይ', openTable: 'ክፍት ጠረጴዛ', timeoutsN: '⏱ {n}/{max} ሰዓት አልፏል', matchStarting: 'ጨዋታው በመጀመር ላይ…',
    yourBreak: 'የእርስዎ መስበሪያ! ነጩን ኳስ (ከመስመሩ በታች) ይጎትቱ፣ ያነጣጥሩ፣ ከዚያ ዱላውን ይጎትቱ',
    ballInHand: 'ኳስ በእጅ፦ ነጩን ኳስ ወደ ፈለጉበት ይጎትቱ፣ ያነጣጥሩ፣ ከዚያ ዱላውን ይጎትቱ',
    yourShot: 'የእርስዎ ምት፦ ለማነጣጠር ጠረጴዛውን ይንኩ፣ ለመምታት ዱላውን ወደ ታች ይጎትቱ', isAiming: '{name} እያነጣጠረ ነው…',
    pull: 'ጎትት', fine: 'ጥቂት', foulBy: 'ጥፋት በ{name}፦ {reason}', foulBallInHand: 'ጥፋት በ{name}፦ {reason} — ኳስ በእጅ',
    kbIntro: 'ቀይ ከነጭ፣ እያንዳንዳችሁ 4 ኳሶች። ኳሶቹን በእጅ አንከባልላችሁ ወደ ሰማያዊው ኳስ አስጠጉ። ሰማያዊው ኳስ የሚጥለው እያንዳንዱ ፒን +{pin}፣ የራስዎ ኳስ በቀጥታ የሚጥለው −{pin}። መጀመሪያ {target} ነጥብ ያገኘ ያሸንፋል። ለእያንዳንዱ ውርወራ {sec} ሰከንድ። አሸናፊው {pct}% ይወስዳል።',
    kbServerPhysics: 'እያንዳንዱ ውርወራ ለሁለቱም ተጫዋቾች በአገልጋዩ በተመሳሳይ ፊዚክስ ይሰላል።',
    kbYourJack: 'ሰማያዊውን ኳስ ይወርውሩ፦ ከመሃል መስመሩ ማለፍ አለበት። እጅዎን ከታች ያንቀሳቅሱ፣ ለማነጣጠር ጠረጴዛውን ይንኩ፣ እጁን ወደ ታች ጎትተው ይልቀቁ',
    kbYourRoll: 'የእርስዎ ተራ፦ ኳስዎን ወደ ሰማያዊው ያስጠጉ — ፒኖቹን በራስዎ ኳስ አይምቱ!',
    kbRollingJack: '{name} ሰማያዊውን ኳስ እየወረወረ ነው…', kbNextFrame: 'ቀጣዩ ዙር በቅርቡ…',
    kbFrameOf: 'ዙር {n}/{max} · እስከ {target}', kbFrameWon: '{name} ይህን ዙር አሸንፏል፦ +{n}', kbFrameTie: 'ዙሩ እኩል ሆኗል — ነጥብ የለም',
    kbPinsLegal: '🎯 {name}፦ ሰማያዊው ኳስ {n} ፒን ጣለ (+{pts})', kbPinsFoul: '⚠️ {name}፦ የራሱ ኳስ {n} ፒን ጣለ (−{pts})',
    kbBadJack: '{name}፦ ሰማያዊው ኳስ መሃል መስመሩን አላለፈም — ተጋጣሚው ይወረውራል', kbTimeout: '{name}፦ ሰዓቱ አልቋል — ኳሱ ተቃጥሏል',
    kbPinsReset: 'ሰማያዊው ኳስ ሲወረወር የወደቁት ፒኖች ተመልሰው ቆመዋል',
    pottedEight: '8 ቁጥሩን አስገብቷል።', serverPhysics: 'እያንዳንዱ ምት ለሁለቱም ተጫዋቾች በአገልጋዩ በተመሳሳይ ፊዚክስ ይሰላል።',
    cantPlace: 'ነጩን ኳስ እዚያ ማስቀመጥ አይቻልም', breakPlace: 'በመስበሪያው ላይ ነጩን ኳስ ከመስመሩ በታች ያስቀምጡ', solids: 'ሙሉ ቀለም', stripes: 'ባለ መስመር',
    nPlayersCut: '{n} ተጫዋቾች (ካትስሮት)', yourBalls: 'የእርስዎ ኳሶች',
  },
  en: {
    loading: 'Loading…', games: 'Games', play: 'Play', wallet: 'Wallet', rules: 'Rules', back: 'Back',
    join: 'Join', leave: 'Leave', cancel: 'Cancel', gotIt: 'Got it — let’s play', players: 'Players', prize: 'Prize', pot: 'Pot',
    you: 'you', paused: 'Games are paused for maintenance. Please check back soon.', pausedShort: 'Paused', live: 'LIVE',
    playingNow: '{n} playing', openFromBot: 'Please open this app from the Telegram bot.',
    replacedConn: 'The app was opened on another device or window — this one was disconnected. Reopen it to continue.',
    restarting: 'Server is restarting for maintenance — reconnecting… Any unfinished game entry is refunded.',
    ageNote: '🔞 {age}+ only · Play responsibly', help: 'Help', balanceLow: 'Balance too low — deposit in Wallet.',
    backToGames: '← Games', seconds: '{n}s', language: 'Language',
    g_aviator: 'Aviator', g_bingo: 'Bingo', g_keno: 'Keno', g_ludo: 'Ludo', g_pool: '8-Ball Pool', g_kerenbula: 'Kerenbula',
    tag_aviator: 'Cash out before the plane flies away', tag_bingo: 'Complete a line, shout BINGO', tag_keno: 'Pick up to 10 numbers',
    tag_ludo: '1 vs 1 or 4 players', tag_pool: '1 vs 1 skill game', tag_kerenbula: '1 vs 1 · rolled by hand', moreSoon: 'More games', moreSoonTag: 'Coming soon',
    st_betting: 'Betting', st_flying: 'Flying', st_open: 'Open', st_drawing: 'Drawing', st_pvp: 'PvP', st_skill: 'Skill',
    bingoRooms: 'Bingo rooms', bingoIntro: 'Pick a card, wait for the numbers, and press BINGO when you complete a row, column, diagonal, or the four corners. The winner takes the prize.',
    r_waiting: 'Waiting for players', r_countdown: 'Starting soon', r_playing: 'In progress', r_finished: 'Finished',
    startsIn: 'Starts in {n}s', watch: 'Watch', room: 'Room', gameStartsIn: 'Game starts in {n}s',
    waitingMore: 'Waiting for {n} more player(s)…', switchCard: 'Switch to card #{n}', playCard: 'Play card #{n} — {amount}',
    inWithCard: '✅ You’re in with card #{n}', leaveRefund: 'Leave & refund', pickCard: 'Pick your card', pickCards: 'Pick up to {max} cards',
    practiceFree: 'Practice (free)', signupBonusGot: '🎁 Welcome! {amount} sign-up bonus added.', settings: 'Settings', setEffects: 'Game sounds', setVoice: 'Bingo voice caller (Amharic)', setVoiceHelp: 'calls the numbers out loud', setLowData: 'Data saver', setLowDataHelp: 'doesn’t download games in advance',
    dailyTitle: 'Daily reward', dailyReady: 'Claim {amount} today!', dailyTomorrow: 'Claimed today — come back tomorrow', dailyDepositFirst: 'Unlocks after your first deposit',
    claim: 'Claim', dailyClaimed: '🎁 {amount} added!', refTitle: 'Invite friends, get {amount}', refHow: 'When a friend joins with your link and deposits {min} or more.',
    refStats: '{invited} invited · {qualified} deposited · {earned} earned', share: 'Share', refShareText: 'Bingo, Ludo, Pool, Kerenbula and more — come play with me! 🎮',
    lbTitle: 'Top winners this week', lbEmpty: 'No winners yet this week — be the first!', showAll: 'Show all', showLess: 'Show less',
    tx_bonus: 'Bonus', bonusLocked: 'You can withdraw {amount} now. Play {toPlay} more to unlock your bonus money.', inviteFriend: 'Invite a friend', inviteHow: 'Pick a table to open a private table — then send the link to your friend.',
    inviteCode: 'Invite code', sendInvite: 'Send invite', copyLink: 'Copy link', copied: 'Copied', inviteShareText: 'Come play with me! 🎮',
    inviteExpires: 'If your friend doesn’t join within 30 minutes, you get your money back.', privateTable: 'Private table — waiting for your friend',
    practiceBadge: '🤖 Practice — free, no money', practiceWon: '🎉 You won! (practice)', practiceLost: 'The bot won — try again!', playAgain: 'Play again', online: '{n} online',
    ageTitle: 'Are you {age} or older?', ageText: 'Real-money games are only for people aged {age} and over.', ageYes: 'Yes, I am {age} or older',
    ageUnder: 'No, I am under {age}', ageNo: 'Sorry — these games are for {age}+ only.', back: 'Back',
    rcTitle: 'Time for a break?', rcPlayed: 'You have been playing for {min} minutes.', rcStaked: 'Played today', rcWon: 'Won', rcNet: 'Result', rcContinue: 'Continue', rcBreak: 'Take a break',
    playSafe: 'Play responsibly', depLimits: 'Deposit limits', depLimitsHelp: 'Lowering a limit works right away; raising or removing it takes effect after 24 hours.',
    perDay: 'Per day', perWeek: 'Per week', now: 'now', used: 'used', noLimit: 'No limit', saveLimits: 'Save limits', limitSaved: 'Limit saved',
    limitRaiseLater: 'Your higher limit starts {when}', limitPending: 'Limit increase takes effect {when}',
    reminderTitle: 'Play-time reminder', everyMin: 'Every {m} min', off: 'Off',
    takeBreak: 'Take a break', takeBreakHelp: 'You won’t be able to play or deposit for the chosen time (you can still withdraw your balance). It can’t be undone early.',
    nDays: '{n} days', months6: '6 months', excludeConfirm: 'Take a {days}-day break? You won’t be able to play or deposit during this time, and it can’t be undone early.',
    excludedUntil: 'You are on a break until {date}', excludedBanner: 'You are on a break until {date}. You can still withdraw your balance.', needHelp: 'Need help?', voiceCaller: 'Voice caller', addCard: 'Add card #{n} — {amount}', removeCard: 'Remove card #{n} (refund)', myCardsN: 'Your cards ({n}/{max}):', maxCardsReached: 'You have {max} cards — remove one to pick another', nCards: '{n} cards', changeCard: 'Change card',
    calledOf: '{n}/75 called', falseBingo: '❌ False BINGO — you’re out of this round.', autoMark: 'Auto-mark', bingoBtn: 'BINGO!',
    watching: 'You’re watching this game. Next round opens when it ends.', youWon: '🎉 You won {amount}!', gameOver: 'Game over',
    noWinner: 'No winner', nextRoundSoon: 'Next round starting shortly…', backToRooms: 'Back to rooms', card: 'Card #{n}',
    balance: 'Balance', deposit: 'Deposit', withdraw: 'Withdraw', sendMoneyTo: 'Send money to:',
    depositStep2: 'Enter the amount you sent and the transaction ID from your confirmation SMS.', amountMin: 'Amount (min {min})',
    txId: 'Transaction ID (e.g. CHK3A1B2C)', phoneReceive: 'Phone number to receive money', submitDeposit: 'Submit deposit',
    requestWithdraw: 'Request withdrawal', sending: 'Sending…', history: 'History', noTx: 'No transactions yet.',
    depositSent: 'Deposit submitted! Your balance updates as soon as it is approved.', withdrawSent: 'Withdrawal requested. You will be notified when it is sent.',
    tx_deposit: 'Deposit', tx_withdraw: 'Withdrawal', tx_bet: 'Bet / entry', tx_win: 'Win', tx_refund: 'Refund', tx_adjust: 'Bonus / adjustment',
    s_pending: 'pending', s_approved: 'approved', s_rejected: 'rejected',
    placeBets: 'Place your bets', flewAway: 'Flew away!', bet: 'BET', nextRound: 'next round', cashOut: 'CASH OUT',
    waitingTakeoff: 'waiting for take-off', betNextRound: 'bet for next round', autoCashAt: 'Auto cash out at',
    yourBet: 'Your bet: {amount}', autoX: 'auto {x}', wonAt: 'won {amount} at {x}', lost: 'lost',
    betsThisRound: 'Bets this round', noBets: 'No bets yet.', howFair: '📖 How to play & fairness', hide: 'Hide',
    pausedMaint: '⏸ Paused for maintenance', roundHash: 'Round hash', lastSeed: 'Last seed',
    provablyFair: 'Provably fair: before each round we publish the hash of a secret seed; after the round we reveal the seed. Check that SHA-256(seed) equals the hash — the result was fixed before anyone bet. The crash point comes from HMAC-SHA256(seed, "rocket").',
    nextDrawIn: 'Next draw in', tickets: '{n} ticket(s)', drawingN: 'Drawing… {n}/20', youHitSoFar: 'you hit {n}',
    hitWon: '🎉 You hit {h}/{p} — won {amount}', hitNoWin: 'You hit {h}/{p} — no win this time', drawDone: 'Draw complete',
    numbersPicked: '{n}/{max} numbers picked', quickPick: '🎲 Quick pick', clear: 'Clear', buyTicket: 'BUY TICKET',
    pickNumbers: 'Pick numbers', pickRange: 'choose 1–{max} on the board', nNumbers: '{n} numbers · {amount}',
    cancelTicket: 'Cancel ticket', ticketInPlay: 'Ticket in play', forNextDraw: 'for next draw · {n} numbers · {amount}', buy: 'BUY',
    cancelNextTicket: 'ticket for next draw', payoutsFor: 'Payouts for {n} number(s)', hits: '{n} hits', winnersDraw: 'Winners this draw',
    maxPicks: 'You can pick up to {n} numbers',
    kenoFair: 'Provably fair: before tickets close we publish the hash of a secret seed; after the draw we reveal the seed. The 20 numbers come from the seed via HMAC-SHA256 — anyone can check them.',
    ludoIntro: 'Race your {tokens} tokens home before your opponents. Roll a 6 to leave base, land on others to send them back. Winner takes {pct}% of the pot. {sec}s per turn.',
    oneVone: '1 vs 1', fourPlayers: '4 players', waitingN: '{n}/{size} waiting', waitingPlayers: 'Waiting for players…',
    tableInfo: '{kind} · entry {stake} · prize {prize}', startsWhenFull: 'The game starts as soon as the table is full. We’ll also message you on Telegram.',
    leaveTable: 'Leave table & refund', tables: '← Tables', leftGame: 'left the game', missedN: '⚠️ {n}/{max} missed',
    yourTurnRoll: 'Your turn — tap the dice!', tapToken: 'Tap a glowing token to move', turnOf: '{name}’s turn', sixAgain: 'Six! Roll again…',
    noMove: 'No move possible', youRolled: 'You rolled {n}', gameStarting: 'Game starting…', youWonPrize: '🏆 You won {amount}!',
    nameWon: '{name} won', allHome: 'All tokens home first.', wonBecause: 'Won because {how}.', backToTables: 'Back to tables',
    diceSeed: 'Dice seed: {seed}', confirmForfeit: 'Leave and forfeit this game? You will lose your {amount} entry.', diceVerify: 'Dice are rolled on the server and can be verified with the seed shown after each game.',
    poolIntro: 'Classic 8-ball, 1 vs 1. Pot all your solids or stripes, then the 8. Fouls give your opponent ball in hand. {sec}s per shot. Winner gets {pct}% of the pot.',
    winX: '🏆 Win {amount}', oneWaiting: '1 player waiting — join now!', findingOpp: 'Finding an opponent…',
    poolEntryInfo: 'Entry {stake} · winner gets {prize}', matchStartsWhen: 'The match starts as soon as another player joins. We’ll also message you on Telegram.',
    breaking: 'breaking', openTable: 'open table', timeoutsN: '⏱ {n}/{max} timeouts', matchStarting: 'Match starting…',
    yourBreak: 'Your break! Drag the white ball (behind the line), aim, then pull the cue',
    ballInHand: 'Ball in hand: drag the white ball anywhere, aim, then pull the cue',
    yourShot: 'Your shot: touch the table to aim, pull the cue down to shoot', isAiming: '{name} is aiming…',
    pull: 'PULL', fine: 'fine', foulBy: 'Foul by {name}: {reason}', foulBallInHand: 'Foul by {name}: {reason} — ball in hand',
    kbIntro: 'Red vs white, 4 balls each. Roll your balls by hand to get closest to the blue ball. Every pin the blue ball knocks over is +{pin}; every pin your own ball hits directly is −{pin}. First to {target} points wins. {sec}s per roll. Winner gets {pct}% of the pot.',
    kbServerPhysics: 'Every roll is calculated on the server with the same physics for both players.',
    kbYourJack: 'Roll the blue ball: it must pass the middle line. Slide your hand along the bottom, touch the table to aim, pull the hand down and let go',
    kbYourRoll: 'Your roll: get close to the blue ball — don’t hit the pins with your own ball!',
    kbRollingJack: '{name} is rolling the blue ball…', kbNextFrame: 'Next frame coming up…',
    kbFrameOf: 'Frame {n}/{max} · to {target}', kbFrameWon: '{name} wins the frame: +{n}', kbFrameTie: 'Frame tied — no points',
    kbPinsLegal: '🎯 {name}: the blue ball knocked {n} pin(s) (+{pts})', kbPinsFoul: '⚠️ {name}: own ball hit {n} pin(s) (−{pts})',
    kbBadJack: '{name}: the blue ball didn’t pass the middle — the opponent rolls it', kbTimeout: '{name}: out of time — that ball is lost',
    kbPinsReset: 'Pins knocked by the blue ball’s first roll were stood back up',
    pottedEight: 'Potted the 8 ball.', serverPhysics: 'Every shot is calculated on the server with the same physics for both players.',
    cantPlace: 'The cue ball can’t go there', breakPlace: 'On the break, place the cue ball behind the line', solids: 'solids', stripes: 'stripes',
    nPlayersCut: '{n} players (Cutthroat)', yourBalls: 'Your balls',
  },
};

// ---- Server messages (they arrive in English) → translated ----
const SERVER_AM = {
  'Insufficient balance. Please deposit first.': 'በቂ ቀሪ ሂሳብ የለም። እባክዎ መጀመሪያ ገንዘብ ያስገቡ።',
  'Insufficient balance': 'በቂ ቀሪ ሂሳብ የለም',
  'Games are paused for maintenance. Please try again later.': 'ጨዋታዎች ለጥገና ቆመዋል። እባክዎ ቆይተው ይሞክሩ።',
  'Game already started': 'ጨዋታው ተጀምሯል', 'Card already taken': 'ካርዱ ተይዟል', 'Invalid card': 'ልክ ያልሆነ ካርድ',
  'No game in progress': 'በሂደት ላይ ያለ ጨዋታ የለም', 'You are not in this game': 'በዚህ ጨዋታ ውስጥ የሉም',
  'You were disqualified for a false BINGO': 'በተሳሳተ ቢንጎ ከጨዋታው ተሰርዘዋል',
  'Not a BINGO yet — you are disqualified from this round.': 'ገና ቢንጎ አይደለም — ከዚህ ዙር ተሰርዘዋል።',
  'Bets are closed — wait for the next round.': 'ውርርድ ተዘግቷል — ቀጣዩን ዙር ይጠብቁ።',
  'You already placed a bet this round.': 'በዚህ ዙር አስቀድመው ተወራርደዋል።',
  'Too late to cancel — the round has started.': 'ለመሰረዝ ዘግይቷል — ዙሩ ተጀምሯል።',
  'Nothing to cash out right now.': 'አሁን የሚወሰድ ነገር የለም።', 'You have no bet in this round.': 'በዚህ ዙር ውርርድ የለዎትም።',
  'Already cashed out.': 'አስቀድመው ወስደዋል።', 'Too late — it already crashed!': 'ዘግይቷል — አውሮፕላኑ በሯል!',
  'Tickets are closed — wait for the next round.': 'ቲኬት ሽያጭ ተዘግቷል — ቀጣዩን እጣ ይጠብቁ።',
  'You already have a ticket this round. Cancel it to change numbers.': 'በዚህ እጣ ቲኬት አለዎት። ቁጥሮችን ለመቀየር ይሰርዙት።',
  'Too late to cancel — the draw has started.': 'ለመሰረዝ ዘግይቷል — እጣው ተጀምሯል።',
  'Pick your numbers': 'ቁጥሮችዎን ይምረጡ', 'Each number can only be picked once': 'እያንዳንዱ ቁጥር አንድ ጊዜ ብቻ ይመረጣል',
  'Pick between 1 and 10 numbers': 'ከ1 እስከ 10 ቁጥሮች ይምረጡ', 'Numbers must be between 1 and 80': 'ቁጥሮች ከ1 እስከ 80 መሆን አለባቸው',
  'You are already at a Ludo table': 'አስቀድመው በሉዶ ጠረጴዛ ላይ ነዎት', 'You are already at a pool table': 'አስቀድመው በፑል ጠረጴዛ ላይ ነዎት',
  'No such table': 'እንዲህ ያለ ጠረጴዛ የለም', "It's not your turn to roll": 'የመጣል ተራዎ አይደለም',
  "It's not your turn to move": 'የማንቀሳቀስ ተራዎ አይደለም', 'That token can’t move': 'ያ ጠጠር መንቀሳቀስ አይችልም',
  'You are not in a Ludo game': 'በሉዶ ጨዋታ ውስጥ የሉም', 'You are not in a pool match': 'በፑል ጨዋታ ውስጥ የሉም',
  "It's not your shot": 'የመምታት ተራዎ አይደለም', 'Invalid shot': 'ልክ ያልሆነ ምት', 'Invalid power': 'ልክ ያልሆነ ኃይል',
  'Place the cue ball behind the line': 'ነጩን ኳስ ከመስመሩ በታች ያስቀምጡ', 'You can’t place the cue ball there': 'ነጩን ኳስ እዚያ ማስቀመጥ አይቻልም',
  'Slow down a little 🙂': 'ትንሽ ቀስ ይበሉ 🙂', 'Server not responding': 'አገልጋዩ ምላሽ እየሰጠ አይደለም',
  'Enter the transaction ID exactly as it appears in your payment SMS': 'የግብይት ቁጥሩን በክፍያ መልዕክቱ ላይ እንዳለ በትክክል ያስገቡ',
  'You already have deposits waiting for approval. Please wait for them first.': 'ማረጋገጫ የሚጠብቁ ተቀማጮች አሉዎት። እባክዎ መጀመሪያ እነሱን ይጠብቁ።',
  'This transaction reference was already submitted': 'ይህ የግብይት ቁጥር ቀደም ብሎ ገብቷል',
  'Enter a valid phone number': 'ትክክለኛ ስልክ ቁጥር ያስገቡ',
  'You already have withdrawals being processed. Please wait for them first.': 'በሂደት ላይ ያሉ የወጪ ጥያቄዎች አሉዎት። እባክዎ መጀመሪያ እነሱን ይጠብቁ።',
  'Too many requests. Please wait a moment and try again.': 'በጣም ብዙ ጥያቄዎች። እባክዎ ትንሽ ቆይተው ይሞክሩ።',
  'This game is not available': 'ይህ ጨዋታ አይገኝም', 'Game not found': 'ጨዋታው አልተገኘም',
  // pool fouls & results
  'Cue ball potted': 'ነጩ ኳስ ገብቷል', 'No ball hit': 'ምንም ኳስ አልተመታም', 'Must hit the 8 ball first': 'መጀመሪያ 8 ቁጥርን መምታት ነበረበት',
  'Hit the 8 ball first on an open table': 'ክፍት ጠረጴዛ ላይ መጀመሪያ 8 ቁጥርን መታ', 'No ball touched a cushion after contact': 'ከግጭቱ በኋላ ምንም ኳስ ጠርዙን አልነካም',
  'Ran out of time': 'ሰዓቱ አልቋል', 'potted the 8 ball': '8 ቁጥሩን አስገብቷል', '8 ball potted too early': '8 ቁጥሩ ቀድሞ ገብቷል',
  'last player with balls on the table': 'ጠረጴዛ ላይ ኳስ የቀረው የመጨረሻው ተጫዋች ነው', 'all tokens home': 'ሁሉም ጠጠሮች ቤት ገብተዋል',
  'Must hit your own balls (solids) first': 'መጀመሪያ የራስዎን (ሙሉ ቀለም) ኳሶች መምታት ነበረበት',
  'Must hit your own balls (stripes) first': 'መጀመሪያ የራስዎን (ባለ መስመር) ኳሶች መምታት ነበረበት',
  'You can’t release the ball there': 'ኳሱን እዚያ መልቀቅ አይችሉም', 'Roll the ball up the table': 'ኳሱን ወደ ጠረጴዛው ፊት ያንከባልሉ',
  'You are already at a Kerenbula table': 'አስቀድመው የከረንቡላ ጠረጴዛ ላይ ነዎት', 'You are not in a Kerenbula match': 'የከረንቡላ ጨዋታ ውስጥ አይደሉም',
  "It's not your turn": 'የእርስዎ ተራ አይደለም', 'Invalid roll': 'ልክ ያልሆነ ውርወራ',
  'missed too many turns': 'ብዙ ተራዎችን አሳልፏል', 'resigned': 'ራሱን አግልሏል', 'ran out of time too many times': 'ብዙ ጊዜ ሰዓት አልፎበታል',
};
const KIND_AM = { deposit: 'ተቀማጭ', withdrawal: 'ወጪ', bet: 'ውርርድ', ticket: 'ቲኬት' };
const PATTERNS_AM = [
  [/^Minimum (deposit|withdrawal|bet|ticket) is (.+)$/, (m) => `ዝቅተኛው ${KIND_AM[m[1]]} ${m[2]} ነው`],
  [/^Maximum (deposit|bet|ticket) is (.+)$/, (m) => `ከፍተኛው ${KIND_AM[m[1]]} ${m[2]} ነው`],
  [/^Auto cash-out must be between 1\.01x and (\d+)x$/, (m) => `ራስ-ሰር መውሰጃ ከ1.01x እስከ ${m[1]}x መሆን አለበት`],
  [/^8 ball potted with a foul \((.+)\)$/, (m) => `8 ቁጥሩ ከጥፋት ጋር ገብቷል (${trServer(m[1])})`],
  [/^(.+) (missed too many turns|resigned|ran out of time too many times)$/, (m) => `${m[1]} ${trServer(m[2])}`],
  [/^reached (\d+) points$/, (m) => `${m[1]} ነጥብ ደርሷል`],
  [/^led after (\d+) frames$/, (m) => `ከ${m[1]} ዙሮች በኋላ እየመራ ነበር`],
  [/^You can hold up to (\d+) cards$/, (m) => `እስከ ${m[1]} ካርዶች ብቻ መያዝ ይችላሉ`],
  [/^(.+) left the game \((.+)\)$/, (m) => `${m[1]} ጨዋታውን ለቋል (${trServer(m[2])})`],
];

// ---- language state ----
const KEY = 'app_lang';
let lang = (() => { try { return localStorage.getItem(KEY) || 'am'; } catch { return 'am'; } })();
const listeners = new Set();
document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'am';
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  listeners.forEach((f) => f());
}
/** Re-render the component when the language changes. */
export const useLang = () => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => lang);

/** Translate a key. vars fill in {placeholders}. */
export function t(key, vars = {}) {
  const s = D[lang][key] ?? D.en[key] ?? key;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

/** Display name for the crash game: the default "Aviator" is shown in the player's language. */
export const crashName = (cfg) => (!cfg.crash?.name || cfg.crash.name === 'Aviator' ? t('g_aviator') : cfg.crash.name);

/** Translate a message that came from the server (errors, fouls, results). */
export function trServer(msg) {
  if (lang !== 'am' || !msg) return msg;
  if (SERVER_AM[msg]) return SERVER_AM[msg];
  for (const [re, fn] of PATTERNS_AM) { const m = String(msg).match(re); if (m) return fn(m); }
  return msg;
}
