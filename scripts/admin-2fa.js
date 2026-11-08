// Sets up the 6-digit code (2-step login) for the browser admin panel.
//   npm run admin:2fa
// Scan the QR code with Google Authenticator / Microsoft Authenticator / Authy, then put the
// printed ADMIN_TOTP_SECRET line in .env and restart the app.
import QRCode from 'qrcode';
import { newSecret, totp } from '../server/totp.js';

const secret = process.argv[2] || newSecret();
const label = encodeURIComponent(process.env.TOTP_LABEL || 'Bingo admin');
const url = `otpauth://totp/${label}?secret=${secret}&issuer=${label}&algorithm=SHA1&digits=6&period=30`;
console.log('\n1) Scan this with your authenticator app:\n');
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
console.log(`   (or type the key by hand: ${secret.replace(/(.{4})/g, '$1 ').trim()})\n`);
console.log('2) Add this line to .env and restart the app:\n');
console.log(`   ADMIN_TOTP_SECRET=${secret}\n`);
console.log(`3) Check: your app should show ${totp(secret)} right now.\n`);
