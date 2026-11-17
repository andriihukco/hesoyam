// One-time interactive login. Prints a session string for TG_SESSION in .env.
// You type phone, code and 2FA password here yourself; nothing is stored except the printed string.
import { createInterface } from 'node:readline/promises';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import QRCode from 'qrcode';
import { env } from '../src/config/env.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q: string) => (await rl.question(q)).trim();

const apiId = env.TG_API_ID ?? Number(await ask('api_id: '));
const apiHash = env.TG_API_HASH ?? (await ask('api_hash: '));
if (!apiId || !apiHash) throw new Error('api_id and api_hash are required (https://my.telegram.org → API development tools)');

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
client.setLogLevel('error' as never);
await client.connect();

const finish = async () => {
  console.log('\nLogged in. Add this line to .env (keep it secret: it is full access to the account):\n');
  console.log(`TG_SESSION=${client.session.save()}\n`);
  await client.disconnect();
  rl.close();
  process.exit(0);
};

const method = (await ask('Login with [1] QR code (recommended) or [2] phone code? [1]: ')) || '1';
if (method === '1') {
  console.log('\nOn your phone: Telegram → Settings → Devices → Link Desktop Device, then scan the QR below.');
  console.log('A new QR is shown when the old one expires (about 30 s).\n');
  await client.signInUserWithQrCode({ apiId, apiHash }, {
    qrCode: async ({ token }) => {
      const url = `tg://login?token=${token.toString('base64url')}`;
      console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
    },
    password: async (hint) => ask(`2FA password${hint ? ` (hint: ${hint})` : ''}: `),
    onError: async (err) => {
      console.error(`Login error: ${err.message}`);
      return true; // stop, no retry loop
    },
  });
  await finish();
}

const where = (t: Api.auth.TypeSentCodeType): string => {
  if (t instanceof Api.auth.SentCodeTypeApp) return 'the Telegram app on your other device (chat named "Telegram", blue tick). Not SMS.';
  if (t instanceof Api.auth.SentCodeTypeSms) return 'SMS.';
  if (t instanceof Api.auth.SentCodeTypeEmailCode) return `your login email (${t.emailPattern}).`;
  if (t instanceof Api.auth.SentCodeTypeCall || t instanceof Api.auth.SentCodeTypeFlashCall) return 'a phone call.';
  if (t instanceof Api.auth.SentCodeTypeFragmentSms) return 'Fragment (fragment.com).';
  if (t instanceof Api.auth.SentCodeTypeSetUpEmailRequired)
    return 'nowhere yet: Telegram requires a login email. Open the official Telegram app → Settings → Privacy and Security → Login Email, then retry.';
  return `${t.className} (unusual type: try logging in once in the official app first).`;
};

const phone = (await ask('Phone with country code (e.g. +380...): ')).replace(/\s/g, '');
let sent = (await client.invoke(new Api.auth.SendCode({
  phoneNumber: phone, apiId, apiHash, settings: new Api.CodeSettings({}),
}))) as Api.auth.SentCode;
console.log(`\nCode sent via ${where(sent.type)}`);

let signedIn = false;
for (let attempt = 1; attempt <= 3 && !signedIn; ) {
  const raw = (await ask('Code (or "r" to resend, "q" to quit): ')).toLowerCase();
  if (raw === 'q') process.exit(1);
  const code = raw.replace(/\D/g, '');
  if (code === '' && raw !== 'r') continue;
  if (raw === 'r') {
    try {
      sent = (await client.invoke(new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash: sent.phoneCodeHash }))) as Api.auth.SentCode;
      console.log(`Resent via ${where(sent.type)}`);
    } catch (e) {
      const m = (e as Error).message;
      console.log(m.includes('SEND_CODE_UNAVAILABLE')
        ? 'Telegram has no other way to send it. Use the code already sent to the Telegram app (chat "Telegram").'
        : `Resend failed: ${m}`);
    }
    continue;
  }
  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: sent.phoneCodeHash, phoneCode: code }));
    signedIn = true;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      await client.signInWithPassword({ apiId, apiHash }, {
        password: async () => ask('2FA password: '),
        onError: async (err) => {
          console.error(err.message);
          return true; // stop instead of looping
        },
      });
      signedIn = true;
    } else if (msg.includes('PHONE_CODE_INVALID')) {
      console.log(`Wrong code (${attempt}/3).`);
      attempt++;
    } else {
      console.error(msg); // e.g. PHONE_CODE_EXPIRED, FLOOD_WAIT_x
      process.exit(1);
    }
  }
}
if (!signedIn) {
  console.error('Too many wrong codes. Wait a few minutes before trying again.');
  process.exit(1);
}

await finish();
