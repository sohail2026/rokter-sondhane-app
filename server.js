// ============================================================
// রক্তের সন্ধানে আমরা বাংলাদেশ — Blood Donation & Social Welfare App
// Stack: Node.js + Express + PostgreSQL (Neon free tier)
// Auth: phone + SMS OTP (1 account per phone number). No passwords.
// Roles: user / moderator / admin. The FIRST registered user
// automatically becomes Super Admin (see README.md).
//
// Honest limits (also in README.md):
//  - Real SMS OTP needs a paid Bangladeshi SMS gateway API key.
//    Without SMS config, DEV_OTP=true shows the OTP on screen
//    (clearly labelled টেস্ট মোড) so the app is demoable.
//  - Notifications are IN-APP ONLY (no FCM / push yet).
//  - KYC files are access-controlled (admin-only endpoint) but
//    NOT encrypted at rest, and live on ephemeral disk on Render
//    free tier (uploads/ is wiped on redeploy/restart).
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const PORT = process.env.PORT || 3000;
const DEV_OTP = process.env.DEV_OTP === 'true';
const USE_PGMEM = process.env.USE_PGMEM === 'true';
const SESSION_DAYS = 30;
const OTP_TTL_MIN = 5;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_WRONG = 5;
const OTP_LOCK_MIN = 15;
const REG_TOKEN_TTL_MIN = 30;

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const FB_GROUP_URL_DEFAULT = 'https://www.facebook.com/share/g/1CYoKfm9sA/';
const MESSENGER_URL_DEFAULT = 'https://m.me/j/AbZe0t2QfrZ45zqT/?send_source=gc%3Acopy_invite_link_t';
const WHATSAPP_URL_DEFAULT = 'https://chat.whatsapp.com/Edd6YSYC0keEhyxlqpRvKU?s=cl&p=a&iam=2';
const HELPLINE1_DEFAULT = '09638877444';
const HELPLINE2_DEFAULT = '01966689599';

// ---------------- Database ----------------
// Production: PostgreSQL via DATABASE_URL (Neon). The app refuses to
// start without it — no SQLite/file fallback, so data can never
// silently end up in a file the host can wipe.
// Local smoke tests only: USE_PGMEM=true uses an in-memory Postgres
// (pg-mem, devDependency). Never used in production.
let pool;
if (USE_PGMEM) {
  const { newDb } = require('pg-mem');
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  pool = new Pool();
  console.log('[db] pg-mem in-memory Postgres (TEST MODE ONLY)');
} else {
  const { Pool, types } = require('pg');
  types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC
  types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT (COUNT(*))
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set. See README.md — "Neon free database setup".');
    process.exit(1);
  }
  const dbUrl = new URL(DATABASE_URL);
  const isLocalDb = ['localhost', '127.0.0.1', '::1'].includes(dbUrl.hostname);
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isLocalDb ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('Unexpected pool error:', err));
}

const q = (text, params) => pool.query(text, params);

// Tables are created one statement at a time (pg-mem compatible).
const SCHEMA = [
`CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  dob DATE,
  gender TEXT,
  blood_group TEXT NOT NULL,
  district TEXT,
  upazila TEXT,
  last_donation DATE,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  photo TEXT,
  photo_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  role TEXT NOT NULL DEFAULT 'user',
  verified_donor BOOLEAN NOT NULL DEFAULT FALSE,
  mod_district TEXT,
  mod_upazila TEXT,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS otps (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS reg_tokens (
  token TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  problem TEXT NOT NULL,
  blood_group TEXT NOT NULL,
  quantity TEXT NOT NULL,
  hemoglobin TEXT,
  hospital TEXT NOT NULL,
  upazila TEXT,
  district TEXT NOT NULL,
  donation_date DATE NOT NULL,
  donation_time TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  donor_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  user_a INTEGER NOT NULL REFERENCES users(id),
  user_b INTEGER NOT NULL REFERENCES users(id),
  request_id INTEGER REFERENCES requests(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  request_id INTEGER REFERENCES requests(id),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS moderator_applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  doc_type TEXT NOT NULL,
  doc_number TEXT NOT NULL,
  front_path TEXT NOT NULL,
  back_path TEXT,
  district TEXT NOT NULL,
  upazila TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS banners (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  link_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  bkash TEXT,
  nagad TEXT,
  bank TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS directory_entries (
  id SERIAL PRIMARY KEY,
  district TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS donations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  donation_date DATE NOT NULL,
  place TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS fund_members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  bkash TEXT,
  joined_date DATE,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS fund_payments (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES fund_members(id),
  month TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  payment_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  trxid TEXT,
  method TEXT,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS feedbacks (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  donor_id INTEGER NOT NULL REFERENCES users(id),
  giver_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, donor_id, giver_id)
)`,
];

// Backward-compatible migrations for DBs created before v1.1
// (production Neon already has these tables without the new column).
// CREATE TABLE IF NOT EXISTS above covers fresh installs; these cover
// existing ones. Each runs in try/catch so a quirk never blocks boot.
const MIGRATIONS = [
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS donor_id INTEGER REFERENCES users(id)`,
];

async function initDb() {
  for (const stmt of SCHEMA) await q(stmt);
  for (const stmt of MIGRATIONS) {
    try { await q(stmt); } catch (e) { console.error('migration (non-fatal):', e.message); }
  }
  // Default settings (only if not already set)
  const defaults = [
    ['helpline1', HELPLINE1_DEFAULT],
    ['helpline2', HELPLINE2_DEFAULT],
    ['fb_group_url', FB_GROUP_URL_DEFAULT],
    ['messenger_url', MESSENGER_URL_DEFAULT],
    ['whatsapp_url', WHATSAPP_URL_DEFAULT],
  ];
  for (const [key, value] of defaults) {
    const r = await q('SELECT key FROM settings WHERE key = $1', [key]);
    if (r.rows.length === 0) await q('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
  }
}

async function audit(userId, action, detail) {
  try { await q('INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3)', [userId, action, detail || null]); } catch (e) { console.error('audit failed:', e.message); }
}

async function getSetting(key) {
  const r = await q('SELECT value FROM settings WHERE key = $1', [key]);
  return r.rows.length ? r.rows[0].value : null;
}

async function setSetting(key, value) {
  const r = await q('SELECT key FROM settings WHERE key = $1', [key]);
  if (r.rows.length) await q('UPDATE settings SET value = $1 WHERE key = $2', [value, key]);
  else await q('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
}

// ---------------- Helpers ----------------
function isValidBdPhone(p) { return /^01[3-9]\d{8}$/.test(p || ''); }
// pg returns DATE columns as JS Date objects — String(date).slice(0,10)
// would give "Sun Nov 22", so always normalize to YYYY-MM-DD.
function dateOnly(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function randomToken() { return crypto.randomBytes(32).toString('hex'); }
function addMinutes(date, min) { return new Date(date.getTime() + min * 60000); }
function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }

function calcAge(dob) {
  if (!dob) return null;
  const d = new Date(dob); const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// Eligibility: under 18 = not eligible; otherwise last donation +
// 90 days (male / unset) or 120 days (female).
function donorEligibility(user) {
  const age = calcAge(user.dob);
  if (age !== null && age < 18) return { eligible: false, reason: 'under18', eligibleDate: null, age };
  if (!user.last_donation) return { eligible: true, reason: 'never', eligibleDate: null, age };
  const gap = user.gender === 'মহিলা' ? 120 : 90;
  const eligibleDate = addDays(new Date(user.last_donation), gap);
  const eligible = new Date() >= eligibleDate;
  return { eligible, reason: eligible ? 'ok' : 'waiting', eligibleDate: eligibleDate.toISOString().slice(0, 10), age };
}

// Public user shape — PRIVACY RULE (v1.1):
// An admin's or moderator's phone number and age are visible ONLY to the
// Super Admin (role 'admin') and to the user themself. Everyone else
// (general members, other moderators, anonymous visitors) gets null.
// General members' phones stay visible — calling donors is the core
// function of the app. date_of_birth is never in this shape at all;
// only /api/me (self) and /api/admin/users (super admin) return dob.
// EVERY endpoint that returns user data must use this helper.
function serializeUser(u, viewer) {
  const el = donorEligibility(u);
  const isStaff = u.role === 'admin' || u.role === 'moderator';
  const viewerIsAdmin = !!(viewer && viewer.role === 'admin');
  const isSelf = !!(viewer && viewer.id === u.id);
  const hidePrivate = isStaff && !viewerIsAdmin && !isSelf;
  return {
    id: u.id, name: u.name,
    phone: hidePrivate ? null : u.phone,
    blood_group: u.blood_group,
    district: u.district, upazila: u.upazila, gender: u.gender,
    available: u.available, verified_donor: u.verified_donor, role: u.role,
    photo: u.photo_hidden ? null : (u.photo || null),
    photo_hidden: !!u.photo_hidden,
    age: hidePrivate ? null : el.age,
    eligible: el.eligible,
    // 'under18' would reveal age, so mask it for hidden staff profiles
    eligibility_reason: (hidePrivate && el.reason === 'under18') ? 'waiting' : el.reason,
    eligible_date: el.eligibleDate, last_donation: u.last_donation,
    mod_district: u.mod_district, created_at: u.created_at,
    avg_rating: (u.avg_rating === null || u.avg_rating === undefined) ? null : Math.round(parseFloat(u.avg_rating) * 10) / 10,
    feedback_count: u.feedback_count ? parseInt(u.feedback_count, 10) : 0,
  };
}

// ---------------- SMS ----------------
// Provider hook: BulkSMSBD HTTP API is the documented example.
//   SMS_API_URL=https://bulksmsbd.net/api/smsapi
//   SMS_API_KEY=<your key>  SMS_SENDER_ID=<approved sender id>
// Any provider with the same query-param shape works; otherwise adapt
// this one function. Returns {sent, reason}.
async function sendSms(phone, text) {
  const apiUrl = process.env.SMS_API_URL;
  const apiKey = process.env.SMS_API_KEY;
  if (!apiUrl || !apiKey) return { sent: false, reason: 'not-configured' };
  try {
    const url = new URL(apiUrl);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('type', 'text');
    url.searchParams.set('number', phone);
    url.searchParams.set('senderid', process.env.SMS_SENDER_ID || '8809612444422');
    url.searchParams.set('message', text);
    const res = await fetch(url.toString(), { method: 'GET' });
    const body = await res.text();
    if (!res.ok) return { sent: false, reason: 'provider-http-' + res.status };
    return { sent: true, provider_response: body.slice(0, 200) };
  } catch (e) {
    console.error('SMS send failed:', e.message);
    return { sent: false, reason: 'provider-error' };
  }
}

// ---------------- Uploads (KYC only) ----------------
// KYC files live OUTSIDE public/ and are served only to Super Admin
// through an authenticated endpoint. NOTE: on Render free tier the
// disk is ephemeral — files are wiped on redeploy/restart.
const KYC_DIR = path.join(__dirname, 'uploads', 'kyc');
fs.mkdirSync(KYC_DIR, { recursive: true });
const kycUpload = multer({
  storage: multer.diskStorage({
    destination: KYC_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '') || '.jpg';
      cb(null, `kyc-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|jpg)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('শুধু ছবি (JPG/PNG/WebP) আপলোড করা যাবে'));
  },
});

// ---------------- App & auth middleware ----------------
const app = express();
app.use(express.json({ limit: '2mb' })); // profile photos arrive as data URLs
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'লগইন করা হয়নি' });
  const s = await q('SELECT s.*, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW()', [token]);
  if (!s.rows.length) return res.status(401).json({ error: 'সেশন শেষ হয়ে গেছে, আবার লগইন করুন' });
  const user = s.rows[0];
  if (user.banned) return res.status(403).json({ error: 'এই অ্যাকাউন্টটি ব্যান করা হয়েছে' });
  req.user = user;
  next();
}
// Optional auth: loads req.user when a valid token is sent, otherwise
// leaves req.user null (anonymous). Used by public endpoints that
// serialize user data differently for admins (privacy rules).
async function optionalAuth(req, res, next) {
  req.user = null;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    try {
      const s = await q('SELECT s.*, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW()', [token]);
      if (s.rows.length && !s.rows[0].banned) req.user = s.rows[0];
    } catch (e) { /* invalid/expired token -> anonymous */ }
  }
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'এই কাজের অনুমতি নেই' });
    next();
  };
}
const requireAdmin = requireRole('admin');
const requireModOrAdmin = requireRole('moderator', 'admin');

async function createSession(userId) {
  const token = randomToken();
  await q('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, addDays(new Date(), SESSION_DAYS)]);
  return token;
}

// ============================================================
// AUTH — phone + OTP (1 account per phone number)
// ============================================================
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    if (!isValidBdPhone(phone)) return res.status(400).json({ error: 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন (01XXXXXXXXX)' });
    const now = new Date();
    // Lock check: a locked-out number cannot request a new OTP
    const locked = await q("SELECT locked_until FROM otps WHERE phone = $1 AND locked_until > $2 ORDER BY id DESC LIMIT 1", [phone, now]);
    if (locked.rows.length) return res.status(429).json({ error: 'অনেকবার ভুল OTP দেওয়া হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন' });
    // Rate limit: max 5 OTP requests / hour / number
    const hourAgo = new Date(now.getTime() - 3600000);
    const cnt = await q('SELECT COUNT(*) AS c FROM otps WHERE phone = $1 AND created_at > $2', [phone, hourAgo]);
    if (parseInt(cnt.rows[0].c, 10) >= OTP_MAX_PER_HOUR) return res.status(429).json({ error: 'এক ঘণ্টায় সর্বোচ্চ ৫ বার OTP পাঠানো যাবে। পরে আবার চেষ্টা করুন' });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await q('INSERT INTO otps (phone, otp_hash, expires_at) VALUES ($1, $2, $3)', [phone, sha256(otp), addMinutes(now, OTP_TTL_MIN)]);

    const sms = await sendSms(phone, `রক্তের সন্ধানে আমরা বাংলাদেশ — আপনার OTP: ${otp} (৫ মিনিটের মধ্যে ব্যবহার করুন)`);
    if (sms.sent) return res.json({ ok: true, sms_sent: true });
    if (DEV_OTP) {
      // TEST MODE ONLY: show the OTP on screen. Turn DEV_OTP off in
      // production once SMS is configured.
      console.log(`[DEV_OTP] ${phone} -> ${otp}`);
      return res.json({ ok: true, sms_sent: false, dev_mode: true, dev_otp: otp });
    }
    return res.status(503).json({ error: 'SMS পাঠানো যাচ্ছে না। অ্যাডমিন SMS গেটওয়ে সেট করেননি — পরে আবার চেষ্টা করুন' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const otp = String(req.body.otp || '').trim();
    if (!isValidBdPhone(phone) || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'সঠিক নম্বর ও ৬ সংখ্যার OTP দিন' });
    const now = new Date();
    const r = await q('SELECT * FROM otps WHERE phone = $1 AND used = FALSE ORDER BY id DESC LIMIT 1', [phone]);
    if (!r.rows.length) return res.status(400).json({ error: 'কোনো OTP পাওয়া যায়নি — আবার OTP পাঠান' });
    const row = r.rows[0];
    if (row.locked_until && new Date(row.locked_until) > now) return res.status(429).json({ error: 'অনেকবার ভুল OTP দেওয়া হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন' });
    if (new Date(row.expires_at) <= now) return res.status(400).json({ error: 'OTP-এর মেয়াদ শেষ। আবার OTP পাঠান' });
    if (sha256(otp) !== row.otp_hash) {
      const attempts = row.attempts + 1;
      if (attempts >= OTP_MAX_WRONG) {
        await q('UPDATE otps SET attempts = $1, locked_until = $2 WHERE id = $3', [attempts, addMinutes(now, OTP_LOCK_MIN), row.id]);
        return res.status(429).json({ error: 'অনেকবার ভুল OTP দেওয়া হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন' });
      }
      await q('UPDATE otps SET attempts = $1 WHERE id = $2', [attempts, row.id]);
      return res.status(400).json({ error: `ভুল OTP। আর ${OTP_MAX_WRONG - attempts} বার চেষ্টা করা যাবে` });
    }
    await q('UPDATE otps SET used = TRUE WHERE id = $1', [row.id]);
    const u = await q('SELECT * FROM users WHERE phone = $1', [phone]);
    if (u.rows.length) {
      if (u.rows[0].banned) return res.status(403).json({ error: 'এই অ্যাকাউন্টটি ব্যান করা হয়েছে' });
      const token = await createSession(u.rows[0].id);
      return res.json({ ok: true, isNew: false, token, user: serializeUser(u.rows[0], u.rows[0]) });
    }
    // New number: issue a short-lived registration token
    const regToken = randomToken();
    await q('INSERT INTO reg_tokens (token, phone, expires_at) VALUES ($1, $2, $3)', [regToken, phone, addMinutes(now, REG_TOKEN_TTL_MIN)]);
    return res.json({ ok: true, isNew: true, reg_token: regToken, phone });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { reg_token, name, dob, gender, blood_group, district, upazila, last_donation, photo, photo_hidden } = req.body;
    if (!reg_token) return res.status(400).json({ error: 'রেজিস্ট্রেশন টোকেন নেই — আবার OTP যাচাই করুন' });
    const t = await q('SELECT * FROM reg_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()', [reg_token]);
    if (!t.rows.length) return res.status(400).json({ error: 'রেজিস্ট্রেশন টোকেনের মেয়াদ শেষ — আবার OTP যাচাই করুন' });
    const phone = t.rows[0].phone;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'পূর্ণ নাম দিন' });
    if (!dob || isNaN(new Date(dob))) return res.status(400).json({ error: 'সঠিক জন্ম তারিখ দিন' });
    if (!BLOOD_GROUPS.includes(blood_group)) return res.status(400).json({ error: 'সঠিক রক্তের গ্রুপ বেছে নিন' });
    if (photo && String(photo).length > 1000000) return res.status(400).json({ error: 'ছবি অনেক বড় — ছোট ছবি দিন' });
    const exists = await q('SELECT id FROM users WHERE phone = $1', [phone]);
    if (exists.rows.length) return res.status(400).json({ error: 'এই নম্বর দিয়ে অ্যাকাউন্ট আছে — লগইন করুন' });
    // FIRST registered user becomes Super Admin
    const count = await q('SELECT COUNT(*) AS c FROM users');
    const role = parseInt(count.rows[0].c, 10) === 0 ? 'admin' : 'user';
    const r = await q(
      `INSERT INTO users (phone, name, dob, gender, blood_group, district, upazila, last_donation, photo, photo_hidden, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [phone, String(name).trim(), dob, gender || null, blood_group, district || null, upazila || null,
       last_donation || null, photo || null, !!photo_hidden, role]
    );
    await q('UPDATE reg_tokens SET used = TRUE WHERE token = $1', [reg_token]);
    const token = await createSession(r.rows[0].id);
    await audit(r.rows[0].id, 'register', role === 'admin' ? 'first user -> super admin' : 'new user');
    res.json({ ok: true, token, user: serializeUser(r.rows[0], r.rows[0]), isAdmin: role === 'admin' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.post('/api/auth/logout', auth, async (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  await q('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ ok: true });
});

// ---------------- Me / profile ----------------
app.get('/api/me', auth, async (req, res) => {
  const d = await q('SELECT COUNT(*) AS c FROM donations WHERE user_id = $1', [req.user.id]);
  const u = serializeUser(req.user, req.user);
  u.donation_count = parseInt(d.rows[0].c, 10);
  u.dob = req.user.dob;
  res.json({ user: u });
});

app.put('/api/me', auth, async (req, res) => {
  try {
    const { name, dob, gender, blood_group, district, upazila, last_donation, available, photo, photo_hidden } = req.body;
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'নাম খালি রাখা যাবে না' });
    if (blood_group !== undefined && !BLOOD_GROUPS.includes(blood_group)) return res.status(400).json({ error: 'সঠিক রক্তের গ্রুপ বেছে নিন' });
    if (photo !== undefined && photo && String(photo).length > 1000000) return res.status(400).json({ error: 'ছবি অনেক বড়' });
    const u = req.user;
    const r = await q(
      `UPDATE users SET name = $1, dob = $2, gender = $3, blood_group = $4, district = $5, upazila = $6,
       last_donation = $7, available = $8, photo = $9, photo_hidden = $10 WHERE id = $11 RETURNING *`,
      [name !== undefined ? String(name).trim() : u.name, dob !== undefined ? (dob || null) : u.dob,
       gender !== undefined ? (gender || null) : u.gender,
       blood_group !== undefined ? blood_group : u.blood_group,
       district !== undefined ? (district || null) : u.district,
       upazila !== undefined ? (upazila || null) : u.upazila,
       last_donation !== undefined ? (last_donation || null) : u.last_donation,
       available !== undefined ? !!available : u.available,
       photo !== undefined ? (photo || null) : u.photo,
       photo_hidden !== undefined ? !!photo_hidden : u.photo_hidden, u.id]
    );
    res.json({ ok: true, user: serializeUser(r.rows[0], req.user) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

// ---------------- Public content ----------------
app.get('/api/settings', async (req, res) => {
  res.json({
    helpline1: (await getSetting('helpline1')) || HELPLINE1_DEFAULT,
    helpline2: (await getSetting('helpline2')) || HELPLINE2_DEFAULT,
    fb_group_url: (await getSetting('fb_group_url')) || FB_GROUP_URL_DEFAULT,
    messenger_url: (await getSetting('messenger_url')) || MESSENGER_URL_DEFAULT,
    whatsapp_url: (await getSetting('whatsapp_url')) || WHATSAPP_URL_DEFAULT,
    dev_otp: DEV_OTP,
  });
});

app.get('/api/banners', async (req, res) => {
  const r = await q('SELECT * FROM banners WHERE active = TRUE ORDER BY sort_order ASC, id DESC');
  res.json({ banners: r.rows });
});

app.get('/api/campaigns', async (req, res) => {
  const r = await q('SELECT * FROM campaigns WHERE active = TRUE ORDER BY id DESC');
  res.json({ campaigns: r.rows });
});

app.get('/api/directory', async (req, res) => {
  const { district, type } = req.query;
  let sql = 'SELECT * FROM directory_entries';
  const params = []; const where = [];
  if (district) { params.push(district); where.push(`district = $${params.length}`); }
  if (type) { params.push(type); where.push(`type = $${params.length}`); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY district ASC, type ASC, name ASC';
  const r = await q(sql, params);
  res.json({ entries: r.rows });
});

app.get('/api/stats', async (req, res) => {
  const total = await q('SELECT COUNT(*) AS c FROM users WHERE banned = FALSE');
  const perGroup = await q('SELECT blood_group, COUNT(*) AS c FROM users WHERE banned = FALSE GROUP BY blood_group ORDER BY blood_group');
  const reqs = await q("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'managed' THEN 1 ELSE 0 END) AS managed FROM requests");
  const dons = await q('SELECT COUNT(*) AS c FROM donations');
  res.json({
    total_donors: parseInt(total.rows[0].c, 10),
    per_group: Object.fromEntries(perGroup.rows.map(r => [r.blood_group, parseInt(r.c, 10)])),
    total_requests: parseInt(reqs.rows[0].total, 10),
    managed_requests: parseInt(reqs.rows[0].managed || 0, 10),
    total_donations: parseInt(dons.rows[0].c, 10),
  });
});

// ============================================================
// BLOOD REQUESTS — publish immediately (emergencies can't wait)
// ============================================================
// Exact formatted output (also rendered client-side):
// 💁‍♂️ রোগীর সমস্যা : ... / 🔴 রক্তের গ্রুপ : ... / 💉 রক্তের পরিমাণ : ...
// 🩸 হিমোগ্লোবিন : ... / 🏢 রক্তদানের স্থান : ... / 📆 রক্তদানের তারিখ : ...
// ⏰ রক্তদানের সময় : ... / ☎️ যোগাযোগ : ... / ইনবক্সে / 🚹 রেফারেন্স : ...
function formatRequest(r) {
  const lines = [
    `💁‍♂️ রোগীর সমস্যা : ${r.problem}`,
    `🔴 রক্তের গ্রুপ : ${r.blood_group}`,
    `💉 রক্তের পরিমাণ : ${r.quantity}`,
  ];
  if (r.hemoglobin) lines.push(`🩸 হিমোগ্লোবিন : ${r.hemoglobin}`);
  const place = [r.hospital, r.upazila, r.district].filter(Boolean).join(', ');
  lines.push(
    `🏢 রক্তদানের স্থান : ${place}`,
    `📆 রক্তদানের তারিখ : ${dateOnly(r.donation_date)}`,
    `⏰ রক্তদানের সময় : ${r.donation_time}`,
    `☎️ যোগাযোগ : ${r.contact_phone} / ইনবক্সে`,
    `🚹 রেফারেন্স : ${r.reference || '—'}`
  );
  return lines.join('\n');
}

async function requestWithUser(row, viewerId) {
  const u = await q('SELECT id, name, photo, photo_hidden, role, verified_donor FROM users WHERE id = $1', [row.user_id]);
  const user = u.rows[0] || {};
  const out = { ...row, formatted: formatRequest(row), requester: { id: user.id, name: user.name, photo: user.photo_hidden ? null : user.photo, role: user.role, verified_donor: user.verified_donor } };
  out.donor = null;
  if (row.donor_id) {
    const d = await q('SELECT id, name FROM users WHERE id = $1', [row.donor_id]);
    out.donor = d.rows[0] || { id: row.donor_id, name: '—' };
  }
  out.feedback_given = false;
  if (viewerId && row.status === 'managed' && row.donor_id && row.user_id === viewerId) {
    const f = await q('SELECT id FROM feedbacks WHERE request_id = $1 AND giver_id = $2 LIMIT 1', [row.id, viewerId]);
    out.feedback_given = f.rows.length > 0;
  }
  return out;
}

app.get('/api/requests', optionalAuth, async (req, res) => {
  const { blood_group, district, status } = req.query;
  const params = []; const where = [];
  if (blood_group) { params.push(blood_group); where.push(`blood_group = $${params.length}`); }
  if (district) { params.push(district); where.push(`district = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  let sql = 'SELECT * FROM requests';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 100';
  const r = await q(sql, params);
  const out = [];
  for (const row of r.rows) out.push(await requestWithUser(row, req.user ? req.user.id : null));
  res.json({ requests: out });
});

app.get('/api/requests/:id', optionalAuth, async (req, res) => {
  const r = await q('SELECT * FROM requests WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'রিকোয়েস্ট পাওয়া যায়নি' });
  res.json({ request: await requestWithUser(r.rows[0], req.user ? req.user.id : null) });
});

app.post('/api/requests', auth, async (req, res) => {
  try {
    const { problem, blood_group, quantity, hemoglobin, hospital, upazila, district, donation_date, donation_time, contact_phone, reference } = req.body;
    if (!problem || !String(problem).trim()) return res.status(400).json({ error: 'রোগীর সমস্যা লিখুন' });
    if (!BLOOD_GROUPS.includes(blood_group)) return res.status(400).json({ error: 'সঠিক রক্তের গ্রুপ বেছে নিন' });
    if (!quantity || !String(quantity).trim()) return res.status(400).json({ error: 'রক্তের পরিমাণ দিন' });
    if (!hospital || !String(hospital).trim()) return res.status(400).json({ error: 'হাসপাতালের নাম দিন' });
    if (!district) return res.status(400).json({ error: 'জেলা বেছে নিন' });
    if (!donation_date || isNaN(new Date(donation_date))) return res.status(400).json({ error: 'সঠিক তারিখ দিন' });
    if (!donation_time || !String(donation_time).trim()) return res.status(400).json({ error: 'সময় দিন (অথবা "পাওয়ার পর")' });
    if (!isValidBdPhone(contact_phone)) return res.status(400).json({ error: 'সঠিক ১১ সংখ্যার যোগাযোগ নম্বর দিন' });
    const r = await q(
      `INSERT INTO requests (user_id, problem, blood_group, quantity, hemoglobin, hospital, upazila, district, donation_date, donation_time, contact_phone, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.id, String(problem).trim(), blood_group, String(quantity).trim(), hemoglobin ? String(hemoglobin).trim() : null,
       String(hospital).trim(), upazila || null, district, donation_date, String(donation_time).trim(), contact_phone, reference ? String(reference).trim() : null]
    );
    res.json({ ok: true, request: await requestWithUser(r.rows[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.get('/api/my-requests', auth, async (req, res) => {
  const r = await q('SELECT * FROM requests WHERE user_id = $1 ORDER BY id DESC', [req.user.id]);
  const out = [];
  for (const row of r.rows) out.push(await requestWithUser(row, req.user.id));
  res.json({ requests: out });
});

app.put('/api/requests/:id', auth, async (req, res) => {
  const r = await q('SELECT * FROM requests WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'রিকোয়েস্ট পাওয়া যায়নি' });
  const row = r.rows[0];
  const isMod = req.user.role === 'moderator' || req.user.role === 'admin';
  if (row.user_id !== req.user.id && !isMod) return res.status(403).json({ error: 'এই রিকোয়েস্ট সম্পাদনার অনুমতি নেই' });
  const fields = ['problem', 'blood_group', 'quantity', 'hemoglobin', 'hospital', 'upazila', 'district', 'donation_date', 'donation_time', 'contact_phone', 'reference'];
  const sets = []; const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === 'blood_group' && !BLOOD_GROUPS.includes(req.body[f])) return res.status(400).json({ error: 'সঠিক রক্তের গ্রুপ বেছে নিন' });
      params.push(req.body[f] === '' ? null : req.body[f]); sets.push(`${f} = $${params.length}`);
    }
  }
  if (!sets.length) return res.json({ ok: true, request: await requestWithUser(row) });
  params.push(req.params.id);
  const updated = await q(`UPDATE requests SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  res.json({ ok: true, request: await requestWithUser(updated.rows[0]) });
});

app.post('/api/requests/:id/manage', auth, async (req, res) => {
  const r = await q('SELECT * FROM requests WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'রিকোয়েস্ট পাওয়া যায়নি' });
  const row = r.rows[0];
  const isMod = req.user.role === 'moderator' || req.user.role === 'admin';
  if (row.user_id !== req.user.id && !isMod) return res.status(403).json({ error: 'অনুমতি নেই' });
  // Optional: record which donor donated, so the requester can leave feedback
  let donorId = null;
  if (req.body.donor_id !== undefined && req.body.donor_id !== null && req.body.donor_id !== '') {
    donorId = parseInt(req.body.donor_id, 10);
    if (!donorId) return res.status(400).json({ error: 'সঠিক ডোনার বেছে নিন' });
    const d = await q('SELECT id FROM users WHERE id = $1 AND banned = FALSE', [donorId]);
    if (!d.rows.length) return res.status(404).json({ error: 'ডোনার পাওয়া যায়নি' });
  }
  const updated = await q("UPDATE requests SET status = 'managed', donor_id = $2 WHERE id = $1 RETURNING *", [req.params.id, donorId]);
  res.json({ ok: true, request: await requestWithUser(updated.rows[0], req.user.id) });
});

// Donor feedback — only the requester of a MANAGED request can rate
// the donor who was recorded when the request was marked managed.
// One feedback per donor per request.
app.post('/api/requests/:id/feedback', auth, async (req, res) => {
  try {
    const rating = parseInt(req.body.rating, 10);
    const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 1000) : null;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: '১ থেকে ৫ তারার মধ্যে রেটিং দিন' });
    const r = await q('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'রিকোয়েস্ট পাওয়া যায়নি' });
    const row = r.rows[0];
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'শুধু আবেদনকারীই ফিডব্যাক দিতে পারেন' });
    if (row.status !== 'managed') return res.status(400).json({ error: 'রক্ত ম্যানেজ হওয়ার পরই ফিডব্যাক দেওয়া যাবে' });
    if (!row.donor_id) return res.status(400).json({ error: 'এই আবেদনে কোনো ডোনার নির্বাচন করা হয়নি' });
    const exists = await q('SELECT id FROM feedbacks WHERE request_id = $1 AND giver_id = $2', [req.params.id, req.user.id]);
    if (exists.rows.length) return res.status(400).json({ error: 'এই আবেদনের জন্য ইতিমধ্যে ফিডব্যাক দেওয়া হয়েছে' });
    const f = await q('INSERT INTO feedbacks (request_id, donor_id, giver_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.id, row.donor_id, req.user.id, rating, comment]);
    res.json({ ok: true, feedback: f.rows[0] });
  } catch (e) {
    if (String(e.message || '').includes('duplicate') || String(e.code || '') === '23505') return res.status(400).json({ error: 'এই আবেদনের জন্য ইতিমধ্যে ফিডব্যাক দেওয়া হয়েছে' });
    console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' });
  }
});

app.delete('/api/requests/:id', auth, requireModOrAdmin, async (req, res) => {
  const r = await q('DELETE FROM requests WHERE id = $1 RETURNING id', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'রিকোয়েস্ট পাওয়া যায়নি' });
  await audit(req.user.id, 'delete-request', 'request #' + req.params.id);
  res.json({ ok: true });
});

// ---------------- Donor search ----------------
app.get('/api/donors', optionalAuth, async (req, res) => {
  const { blood_group, district, upazila, q: search } = req.query;
  const params = []; const where = ['banned = FALSE'];
  if (blood_group) { params.push(blood_group); where.push(`blood_group = $${params.length}`); }
  if (district) { params.push(district); where.push(`district = $${params.length}`); }
  if (upazila) { params.push(upazila); where.push(`upazila = $${params.length}`); }
  if (search) { params.push('%' + String(search).toLowerCase() + '%'); where.push(`(LOWER(name) LIKE $${params.length} OR phone LIKE $${params.length})`); }
  const r = await q(`SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY available DESC, verified_donor DESC, id DESC LIMIT 200`, params);
  const fbAgg = await q('SELECT donor_id, AVG(rating) AS avg_rating, COUNT(*) AS feedback_count FROM feedbacks GROUP BY donor_id');
  const fbMap = new Map(fbAgg.rows.map(x => [x.donor_id, x]));
  const donors = r.rows.map(row => {
    const agg = fbMap.get(row.id);
    if (agg) { row.avg_rating = agg.avg_rating; row.feedback_count = agg.feedback_count; }
    return serializeUser(row, req.user);
  });
  res.json({ donors });
});

app.get('/api/users/:id', optionalAuth, async (req, res) => {
  const r = await q('SELECT * FROM users WHERE id = $1 AND banned = FALSE', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'ব্যবহারকারী পাওয়া যায়নি' });
  const d = await q('SELECT COUNT(*) AS c FROM donations WHERE user_id = $1', [req.params.id]);
  const fb = await q('SELECT f.rating, f.comment, f.created_at, f.request_id, u.name AS giver_name FROM feedbacks f JOIN users u ON u.id = f.giver_id WHERE f.donor_id = $1 ORDER BY f.id DESC', [req.params.id]);
  const u = serializeUser(r.rows[0], req.user);
  u.donation_count = parseInt(d.rows[0].c, 10);
  u.feedback_count = fb.rows.length;
  u.avg_rating = fb.rows.length ? Math.round((fb.rows.reduce((s, x) => s + parseInt(x.rating, 10), 0) / fb.rows.length) * 10) / 10 : null;
  u.feedbacks = fb.rows;
  res.json({ user: u });
});

// ---------------- Reports ----------------
app.post('/api/reports', auth, async (req, res) => {
  const { target_type, target_id, reason } = req.body;
  if (!['request', 'user'].includes(target_type)) return res.status(400).json({ error: 'ভুল রিপোর্ট টাইপ' });
  if (!target_id || !reason || !String(reason).trim()) return res.status(400).json({ error: 'রিপোর্টের কারণ লিখুন' });
  await q('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4)', [req.user.id, target_type, target_id, String(reason).trim()]);
  res.json({ ok: true });
});

// ============================================================
// IN-APP MESSAGING (requester ↔ donor chat)
// ============================================================
app.post('/api/conversations', auth, async (req, res) => {
  const otherId = parseInt(req.body.user_id, 10);
  const requestId = req.body.request_id ? parseInt(req.body.request_id, 10) : null;
  if (!otherId || otherId === req.user.id) return res.status(400).json({ error: 'সঠিক ব্যবহারকারী বেছে নিন' });
  const other = await q('SELECT id FROM users WHERE id = $1 AND banned = FALSE', [otherId]);
  if (!other.rows.length) return res.status(404).json({ error: 'ব্যবহারকারী পাওয়া যায়নি' });
  const a = Math.min(req.user.id, otherId), b = Math.max(req.user.id, otherId);
  let r;
  if (requestId) r = await q('SELECT * FROM conversations WHERE user_a = $1 AND user_b = $2 AND request_id = $3', [a, b, requestId]);
  else r = await q('SELECT * FROM conversations WHERE user_a = $1 AND user_b = $2 AND request_id IS NULL', [a, b]);
  if (r.rows.length) return res.json({ ok: true, conversation: r.rows[0] });
  const created = await q('INSERT INTO conversations (user_a, user_b, request_id) VALUES ($1,$2,$3) RETURNING *', [a, b, requestId]);
  res.json({ ok: true, conversation: created.rows[0] });
});

app.get('/api/conversations', auth, async (req, res) => {
  const r = await q(
    `SELECT c.*, u.id AS other_id, u.name AS other_name, u.photo AS other_photo, u.photo_hidden AS other_photo_hidden,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.is_read = FALSE) AS unread
     FROM conversations c JOIN users u ON u.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
     WHERE c.user_a = $1 OR c.user_b = $1 ORDER BY last_at DESC NULLS LAST, c.id DESC`,
    [req.user.id]
  );
  res.json({ conversations: r.rows.map(c => ({ ...c, other_photo: c.other_photo_hidden ? null : c.other_photo, unread: parseInt(c.unread, 10) })) });
});

app.get('/api/conversations/:id/messages', auth, async (req, res) => {
  const c = await q('SELECT * FROM conversations WHERE id = $1 AND (user_a = $2 OR user_b = $2)', [req.params.id, req.user.id]);
  if (!c.rows.length) return res.status(404).json({ error: 'কথোপকথন পাওয়া যায়নি' });
  await q('UPDATE messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_id <> $2', [req.params.id, req.user.id]);
  const r = await q('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT 500', [req.params.id]);
  res.json({ conversation: c.rows[0], messages: r.rows });
});

app.post('/api/conversations/:id/messages', auth, async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'মেসেজ লিখুন' });
  if (body.length > 2000) return res.status(400).json({ error: 'মেসেজ অনেক বড়' });
  const c = await q('SELECT * FROM conversations WHERE id = $1 AND (user_a = $2 OR user_b = $2)', [req.params.id, req.user.id]);
  if (!c.rows.length) return res.status(404).json({ error: 'কথোপকথন পাওয়া যায়নি' });
  const m = await q('INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *', [req.params.id, req.user.id, body]);
  const otherId = c.rows[0].user_a === req.user.id ? c.rows[0].user_b : c.rows[0].user_a;
  await q('INSERT INTO notifications (user_id, title, body, request_id) VALUES ($1,$2,$3,$4)',
    [otherId, 'নতুন মেসেজ', `${req.user.name}: ${body.slice(0, 100)}`, c.rows[0].request_id]);
  res.json({ ok: true, message: m.rows[0] });
});

// ---------------- Notifications (in-app only) ----------------
app.get('/api/notifications', auth, async (req, res) => {
  const r = await q('SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [req.user.id]);
  const unread = await q('SELECT COUNT(*) AS c FROM notifications WHERE user_id = $1 AND is_read = FALSE', [req.user.id]);
  res.json({ notifications: r.rows, unread: parseInt(unread.rows[0].c, 10) });
});

app.post('/api/notifications/read-all', auth, async (req, res) => {
  await q('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true });
});

app.post('/api/notifications/:id/read', auth, async (req, res) => {
  await q('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ============================================================
// MODERATOR — KYC application + moderator powers
// ============================================================
app.post('/api/moderator/apply', auth, (req, res) => {
  kycUpload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'ফাইল আপলোডে সমস্যা' });
    try {
      const { doc_type, doc_number, district, upazila } = req.body;
      if (req.user.role !== 'user') return res.status(400).json({ error: 'আপনি ইতিমধ্যে মডারেটর/অ্যাডমিন' });
      if (!['nid', 'birth'].includes(doc_type)) return res.status(400).json({ error: 'NID অথবা জন্ম সনদ বেছে নিন' });
      if (doc_type === 'nid' && !/^\d{10}(\d{3})?(\d{4})?$/.test(String(doc_number || '').trim())) return res.status(400).json({ error: 'সঠিক NID নম্বর দিন (১০/১৩/১৭ সংখ্যা)' });
      if (doc_type === 'birth' && !/^\d{17}$/.test(String(doc_number || '').trim())) return res.status(400).json({ error: 'জন্ম সনদ নম্বর ১৭ সংখ্যার হতে হবে' });
      if (!district) return res.status(400).json({ error: 'জেলা বেছে নিন' });
      if (!req.files || !req.files.front) return res.status(400).json({ error: 'ডকুমেন্টের ছবি আপলোড করুন' });
      if (doc_type === 'nid' && (!req.files.back || !req.files.back[0])) return res.status(400).json({ error: 'NID-এর সামনে ও পেছনের ছবি দুটোই দিন' });
      const pending = await q("SELECT id FROM moderator_applications WHERE user_id = $1 AND status = 'pending'", [req.user.id]);
      if (pending.rows.length) return res.status(400).json({ error: 'আপনার আবেদন ইতিমধ্যে পর্যালোচনাধীন আছে' });
      const frontPath = path.relative(__dirname, req.files.front[0].path);
      const backPath = req.files.back ? path.relative(__dirname, req.files.back[0].path) : null;
      const r = await q(
        'INSERT INTO moderator_applications (user_id, doc_type, doc_number, front_path, back_path, district, upazila) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [req.user.id, doc_type, String(doc_number).trim(), frontPath, backPath, district, upazila || null]
      );
      res.json({ ok: true, application_id: r.rows[0].id });
    } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
  });
});

app.get('/api/moderator/my-application', auth, async (req, res) => {
  const r = await q('SELECT id, doc_type, doc_number, district, upazila, status, review_note, created_at FROM moderator_applications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [req.user.id]);
  res.json({ application: r.rows[0] || null });
});

// Urgent notification to eligible local donors of the required group
app.post('/api/moderator/urgent', auth, requireModOrAdmin, async (req, res) => {
  const requestId = parseInt(req.body.request_id, 10);
  if (!requestId) return res.status(400).json({ error: 'রিকোয়েস্ট বেছে নিন' });
  const rq = await q('SELECT * FROM requests WHERE id = $1', [requestId]);
  if (!rq.rows.length) return res.status(404).json({ error: 'রিকোয়েস্ট পাওয়া যায়নি' });
  const reqRow = rq.rows[0];
  // Moderators only notify within their assigned district; admins anywhere
  if (req.user.role === 'moderator' && req.user.mod_district && req.user.mod_district !== reqRow.district) {
    return res.status(403).json({ error: 'এই জেলা আপনার দায়িত্বে নয়' });
  }
  const donors = await q('SELECT * FROM users WHERE banned = FALSE AND available = TRUE AND blood_group = $1 AND district = $2', [reqRow.blood_group, reqRow.district]);
  let sent = 0;
  for (const d of donors.rows) {
    if (d.id === req.user.id) continue;
    const el = donorEligibility(d);
    if (!el.eligible) continue;
    await q('INSERT INTO notifications (user_id, title, body, request_id) VALUES ($1,$2,$3,$4)',
      [d.id, `🚨 জরুরি: ${reqRow.blood_group} রক্ত দরকার`, `${reqRow.hospital}, ${reqRow.district} — ${reqRow.problem}। তারিখ: ${dateOnly(reqRow.donation_date)}`, requestId]);
    sent++;
  }
  await audit(req.user.id, 'urgent-notify', `request #${requestId} -> ${sent} donors`);
  res.json({ ok: true, notified: sent });
});

// Verify a local donor (grant "Verified Donor" badge)
app.post('/api/moderator/verify-donor/:userId', auth, requireModOrAdmin, async (req, res) => {
  const target = await q('SELECT * FROM users WHERE id = $1', [req.params.userId]);
  if (!target.rows.length) return res.status(404).json({ error: 'ব্যবহারকারী পাওয়া যায়নি' });
  if (req.user.role === 'moderator' && req.user.mod_district && target.rows[0].district && req.user.mod_district !== target.rows[0].district) {
    return res.status(403).json({ error: 'এই ডোনার আপনার জেলার নয়' });
  }
  await q('UPDATE users SET verified_donor = $1 WHERE id = $2', [req.body.verified !== false, req.params.userId]);
  res.json({ ok: true });
});

// ============================================================
// DONATIONS — history & certificate data
// ============================================================
app.get('/api/donations', auth, async (req, res) => {
  const r = await q('SELECT * FROM donations WHERE user_id = $1 ORDER BY donation_date DESC, id DESC', [req.user.id]);
  res.json({ donations: r.rows, count: r.rows.length });
});

app.post('/api/donations', auth, async (req, res) => {
  const { donation_date, place } = req.body;
  if (!donation_date || isNaN(new Date(donation_date))) return res.status(400).json({ error: 'সঠিক তারিখ দিন' });
  if (new Date(donation_date) > new Date()) return res.status(400).json({ error: 'ভবিষ্যতের তারিখ দেওয়া যাবে না' });
  const r = await q('INSERT INTO donations (user_id, donation_date, place) VALUES ($1,$2,$3) RETURNING *', [req.user.id, donation_date, place ? String(place).trim() : null]);
  // Keep last_donation in sync (latest donation wins)
  await q('UPDATE users SET last_donation = $1 WHERE id = $2 AND (last_donation IS NULL OR last_donation < $1)', [donation_date, req.user.id]);
  res.json({ ok: true, donation: r.rows[0] });
});

app.delete('/api/donations/:id', auth, async (req, res) => {
  const r = await q('DELETE FROM donations WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'রেকর্ড পাওয়া যায়নি' });
  res.json({ ok: true });
});

// ============================================================
// FUND MANAGEMENT — admin & moderator ONLY (server-enforced:
// every endpoint returns 403 for role=user; the UI also hides
// the menu from general users). bKash numbers live in Neon
// Postgres (encrypted at rest by Neon) and are only ever returned
// to admin/moderator sessions — access-controlled, not
// end-to-end encrypted (see README.md).
// ============================================================
function isValidMonth(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(m || ''); }

app.get('/api/funds/members', auth, requireModOrAdmin, async (req, res) => {
  const r = await q('SELECT * FROM fund_members ORDER BY name ASC');
  const agg = await q(`SELECT member_id,
      SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS total_paid,
      SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS total_pending,
      COUNT(*) AS payment_count FROM fund_payments GROUP BY member_id`);
  const map = new Map(agg.rows.map(x => [x.member_id, x]));
  res.json({ members: r.rows.map(m => {
    const a = map.get(m.id);
    return { ...m,
      total_paid: a ? parseFloat(a.total_paid || 0) : 0,
      total_pending: a ? parseFloat(a.total_pending || 0) : 0,
      payment_count: a ? parseInt(a.payment_count, 10) : 0 };
  }) });
});

app.post('/api/funds/members', auth, requireModOrAdmin, async (req, res) => {
  try {
    const { name, phone, bkash, joined_date, note } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'নাম দিন' });
    if (!isValidBdPhone(phone)) return res.status(400).json({ error: 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন' });
    if (bkash && !isValidBdPhone(bkash)) return res.status(400).json({ error: 'সঠিক bKash নম্বর দিন' });
    if (joined_date && isNaN(new Date(joined_date))) return res.status(400).json({ error: 'সঠিক তারিখ দিন' });
    const r = await q('INSERT INTO fund_members (name, phone, bkash, joined_date, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [String(name).trim(), phone, bkash || null, joined_date || new Date().toISOString().slice(0, 10), note || null, req.user.id]);
    await audit(req.user.id, 'fund-add-member', `#${r.rows[0].id} ${String(name).trim()}`);
    res.json({ ok: true, member: r.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.put('/api/funds/members/:id', auth, requireModOrAdmin, async (req, res) => {
  try {
    const { name, phone, bkash, joined_date, note } = req.body;
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'নাম খালি রাখা যাবে না' });
    if (phone !== undefined && !isValidBdPhone(phone)) return res.status(400).json({ error: 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন' });
    if (bkash !== undefined && bkash && !isValidBdPhone(bkash)) return res.status(400).json({ error: 'সঠিক bKash নম্বর দিন' });
    const cur = await q('SELECT * FROM fund_members WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'সদস্য পাওয়া যায়নি' });
    const m = cur.rows[0];
    const r = await q('UPDATE fund_members SET name = $1, phone = $2, bkash = $3, joined_date = $4, note = $5 WHERE id = $6 RETURNING *',
      [name !== undefined ? String(name).trim() : m.name, phone !== undefined ? phone : m.phone,
       bkash !== undefined ? (bkash || null) : m.bkash, joined_date !== undefined ? (joined_date || null) : m.joined_date,
       note !== undefined ? (note || null) : m.note, req.params.id]);
    res.json({ ok: true, member: r.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.delete('/api/funds/members/:id', auth, requireModOrAdmin, async (req, res) => {
  await q('DELETE FROM fund_payments WHERE member_id = $1', [req.params.id]);
  const r = await q('DELETE FROM fund_members WHERE id = $1 RETURNING id', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'সদস্য পাওয়া যায়নি' });
  await audit(req.user.id, 'fund-delete-member', 'member #' + req.params.id);
  res.json({ ok: true });
});

app.get('/api/funds/payments', auth, requireModOrAdmin, async (req, res) => {
  const { month, member_id } = req.query;
  const params = []; const where = [];
  if (month) {
    if (!isValidMonth(month)) return res.status(400).json({ error: 'সঠিক মাস দিন (YYYY-MM)' });
    params.push(month); where.push(`p.month = $${params.length}`);
  }
  if (member_id) { params.push(parseInt(member_id, 10)); where.push(`p.member_id = $${params.length}`); }
  let sql = 'SELECT p.*, m.name AS member_name, m.phone AS member_phone FROM fund_payments p JOIN fund_members m ON m.id = p.member_id';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY p.month DESC, p.id DESC LIMIT 500';
  const r = await q(sql, params);
  res.json({ payments: r.rows.map(p => ({ ...p, amount: parseFloat(p.amount) })) });
});

app.post('/api/funds/payments', auth, requireModOrAdmin, async (req, res) => {
  try {
    const { member_id, month, amount, payment_date, status, trxid, method, note } = req.body;
    const mid = parseInt(member_id, 10);
    if (!mid) return res.status(400).json({ error: 'সদস্য বেছে নিন' });
    const m = await q('SELECT id FROM fund_members WHERE id = $1', [mid]);
    if (!m.rows.length) return res.status(404).json({ error: 'সদস্য পাওয়া যায়নি' });
    if (!isValidMonth(month)) return res.status(400).json({ error: 'সঠিক মাস দিন (YYYY-MM)' });
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'সঠিক টাকার পরিমাণ দিন' });
    if (status && !['paid', 'pending'].includes(status)) return res.status(400).json({ error: 'ভুল স্ট্যাটাস' });
    if (payment_date && isNaN(new Date(payment_date))) return res.status(400).json({ error: 'সঠিক তারিখ দিন' });
    const r = await q('INSERT INTO fund_payments (member_id, month, amount, payment_date, status, trxid, method, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [mid, month, amt, payment_date || null, status || 'pending', trxid || null, method || null, note || null, req.user.id]);
    res.json({ ok: true, payment: { ...r.rows[0], amount: parseFloat(r.rows[0].amount) } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.put('/api/funds/payments/:id', auth, requireModOrAdmin, async (req, res) => {
  try {
    const fields = ['month', 'amount', 'payment_date', 'status', 'trxid', 'method', 'note'];
    const sets = []; const params = [];
    for (const f of fields) {
      if (req.body[f] === undefined) continue;
      if (f === 'month' && !isValidMonth(req.body[f])) return res.status(400).json({ error: 'সঠিক মাস দিন (YYYY-MM)' });
      if (f === 'status' && !['paid', 'pending'].includes(req.body[f])) return res.status(400).json({ error: 'ভুল স্ট্যাটাস' });
      if (f === 'amount') {
        const a = parseFloat(req.body[f]);
        if (!a || a <= 0) return res.status(400).json({ error: 'সঠিক টাকার পরিমাণ দিন' });
        params.push(a);
      } else {
        params.push(req.body[f] === '' ? null : req.body[f]);
      }
      sets.push(`${f} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'পরিবর্তনের কিছু নেই' });
    params.push(req.params.id);
    const r = await q(`UPDATE fund_payments SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'পেমেন্ট পাওয়া যায়নি' });
    res.json({ ok: true, payment: { ...r.rows[0], amount: parseFloat(r.rows[0].amount) } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'সার্ভার সমস্যা' }); }
});

app.delete('/api/funds/payments/:id', auth, requireModOrAdmin, async (req, res) => {
  const r = await q('DELETE FROM fund_payments WHERE id = $1 RETURNING id', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'পেমেন্ট পাওয়া যায়নি' });
  res.json({ ok: true });
});

app.get('/api/funds/summary', auth, requireModOrAdmin, async (req, res) => {
  const month = req.query.month && isValidMonth(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const s = await q(
    `SELECT COUNT(*) AS total_count,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS total_collected,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS total_pending
     FROM fund_payments WHERE month = $1`, [month]);
  const months = await q('SELECT DISTINCT month FROM fund_payments ORDER BY month DESC');
  const members = await q('SELECT COUNT(*) AS c FROM fund_members');
  const row = s.rows[0];
  res.json({
    month,
    total_count: parseInt(row.total_count, 10),
    paid_count: parseInt(row.paid_count || 0, 10),
    pending_count: parseInt(row.pending_count || 0, 10),
    total_collected: parseFloat(row.total_collected || 0),
    total_pending: parseFloat(row.total_pending || 0),
    total_members: parseInt(members.rows[0].c, 10),
    months: months.rows.map(r => r.month),
  });
});

// ============================================================
// SUPER ADMIN PANEL
// ============================================================
app.get('/api/admin/stats', auth, requireAdmin, async (req, res) => {
  const total = await q('SELECT COUNT(*) AS c FROM users');
  const perGroup = await q('SELECT blood_group, COUNT(*) AS c FROM users GROUP BY blood_group ORDER BY blood_group');
  const reqs = await q("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'managed' THEN 1 ELSE 0 END) AS managed, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open FROM requests");
  const dons = await q('SELECT COUNT(*) AS c FROM donations');
  const mods = await q("SELECT COUNT(*) AS c FROM users WHERE role = 'moderator'");
  const pendingApps = await q("SELECT COUNT(*) AS c FROM moderator_applications WHERE status = 'pending'");
  const openReports = await q("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'");
  res.json({
    total_users: parseInt(total.rows[0].c, 10),
    per_group: Object.fromEntries(perGroup.rows.map(r => [r.blood_group, parseInt(r.c, 10)])),
    total_requests: parseInt(reqs.rows[0].total, 10),
    managed_requests: parseInt(reqs.rows[0].managed || 0, 10),
    open_requests: parseInt(reqs.rows[0].open || 0, 10),
    total_donations: parseInt(dons.rows[0].c, 10),
    total_moderators: parseInt(mods.rows[0].c, 10),
    pending_applications: parseInt(pendingApps.rows[0].c, 10),
    open_reports: parseInt(openReports.rows[0].c, 10),
  });
});

app.get('/api/admin/users', auth, requireAdmin, async (req, res) => {
  const { role, district, q: search } = req.query;
  const params = []; const where = [];
  if (role) { params.push(role); where.push(`role = $${params.length}`); }
  if (district) { params.push(district); where.push(`district = $${params.length}`); }
  if (search) { params.push('%' + String(search).toLowerCase() + '%'); where.push(`(LOWER(name) LIKE $${params.length} OR phone LIKE $${params.length})`); }
  let sql = 'SELECT id, phone, name, dob, gender, blood_group, district, upazila, last_donation, available, role, verified_donor, mod_district, mod_upazila, banned, created_at FROM users';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 200';
  const r = await q(sql, params);
  res.json({ users: r.rows.map(u => ({ ...u, ...donorEligibility(u) })) });
});

// Promote/demote + assign district
app.post('/api/admin/users/:id/role', auth, requireAdmin, async (req, res) => {
  const { role, mod_district, mod_upazila } = req.body;
  if (!['user', 'moderator', 'admin'].includes(role)) return res.status(400).json({ error: 'ভুল রোল' });
  const target = await q('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target.rows.length) return res.status(404).json({ error: 'ব্যবহারকারী পাওয়া যায়নি' });
  if (parseInt(req.params.id, 10) === req.user.id && role !== 'admin') return res.status(400).json({ error: 'নিজের অ্যাডমিন রোল সরানো যাবে না' });
  await q('UPDATE users SET role = $1, mod_district = $2, mod_upazila = $3 WHERE id = $4',
    [role, role === 'moderator' ? (mod_district || null) : null, role === 'moderator' ? (mod_upazila || null) : null, req.params.id]);
  await audit(req.user.id, 'set-role', `user #${req.params.id} -> ${role} (${mod_district || ''})`);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/ban', auth, requireAdmin, async (req, res) => {
  if (parseInt(req.params.id, 10) === req.user.id) return res.status(400).json({ error: 'নিজেকে ব্যান করা যাবে না' });
  const banned = req.body.banned !== false;
  await q('UPDATE users SET banned = $1 WHERE id = $2', [banned, req.params.id]);
  if (banned) await q('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
  await audit(req.user.id, banned ? 'ban-user' : 'unban-user', 'user #' + req.params.id);
  res.json({ ok: true });
});

// Moderator applications
app.get('/api/admin/applications', auth, requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  const r = await q(
    `SELECT a.*, u.name, u.phone, u.blood_group FROM moderator_applications a JOIN users u ON u.id = a.user_id
     WHERE ($1 = 'all' OR a.status = $1) ORDER BY a.id DESC`, [status]
  );
  res.json({ applications: r.rows });
});

app.post('/api/admin/applications/:id/review', auth, requireAdmin, async (req, res) => {
  const approve = req.body.approve === true;
  const note = req.body.note ? String(req.body.note).trim() : null;
  const r = await q('SELECT * FROM moderator_applications WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'আবেদন পাওয়া যায়নি' });
  const appRow = r.rows[0];
  if (appRow.status !== 'pending') return res.status(400).json({ error: 'এই আবেদন ইতিমধ্যে পর্যালোচনা করা হয়েছে' });
  await q('UPDATE moderator_applications SET status = $1, review_note = $2, reviewed_at = NOW() WHERE id = $3', [approve ? 'approved' : 'rejected', note, req.params.id]);
  if (approve) {
    await q("UPDATE users SET role = 'moderator', mod_district = $1, mod_upazila = $2 WHERE id = $3", [appRow.district, appRow.upazila, appRow.user_id]);
    await q('INSERT INTO notifications (user_id, title, body) VALUES ($1,$2,$3)',
      [appRow.user_id, '✅ মডারেটর অনুমোদিত', `আপনাকে ${appRow.district} জেলার মডারেটর হিসেবে অনুমোদন দেওয়া হয়েছে`]);
  } else {
    await q('INSERT INTO notifications (user_id, title, body) VALUES ($1,$2,$3)',
      [appRow.user_id, 'মডারেটর আবেদন বাতিল', note || 'আপনার মডারেটর আবেদনটি অনুমোদন করা হয়নি']);
  }
  await audit(req.user.id, approve ? 'approve-moderator' : 'reject-moderator', `application #${req.params.id} user #${appRow.user_id}`);
  res.json({ ok: true });
});

// KYC document serving — ADMIN ONLY, path confined to uploads/kyc
app.get('/api/admin/kyc/:appId/:side', auth, requireAdmin, async (req, res) => {
  const r = await q('SELECT front_path, back_path FROM moderator_applications WHERE id = $1', [req.params.appId]);
  if (!r.rows.length) return res.status(404).json({ error: 'আবেদন পাওয়া যায়নি' });
  const rel = req.params.side === 'back' ? r.rows[0].back_path : r.rows[0].front_path;
  if (!rel) return res.status(404).json({ error: 'ফাইল নেই' });
  const abs = path.resolve(__dirname, rel);
  if (!abs.startsWith(path.resolve(KYC_DIR) + path.sep)) return res.status(403).json({ error: 'অনুমতি নেই' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'ফাইল পাওয়া যায়নি (সার্ভার রিস্টার্টে মুছে গিয়ে থাকতে পারে)' });
  res.sendFile(abs);
});

// Reports
app.get('/api/admin/reports', auth, requireAdmin, async (req, res) => {
  const r = await q(
    `SELECT r.*, u.name AS reporter_name FROM reports r JOIN users u ON u.id = r.reporter_id
     ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.id DESC LIMIT 100`
  );
  res.json({ reports: r.rows });
});

app.post('/api/admin/reports/:id/resolve', auth, requireAdmin, async (req, res) => {
  await q("UPDATE reports SET status = 'resolved' WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Banners CRUD
app.post('/api/admin/banners', auth, requireAdmin, async (req, res) => {
  const { title, subtitle, link_url, sort_order } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'শিরোনাম দিন' });
  const r = await q('INSERT INTO banners (title, subtitle, link_url, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
    [String(title).trim(), subtitle || null, link_url || null, parseInt(sort_order, 10) || 0]);
  res.json({ ok: true, banner: r.rows[0] });
});
app.put('/api/admin/banners/:id', auth, requireAdmin, async (req, res) => {
  const { title, subtitle, link_url, active, sort_order } = req.body;
  await q('UPDATE banners SET title = COALESCE($1, title), subtitle = $2, link_url = $3, active = COALESCE($4, active), sort_order = COALESCE($5, sort_order) WHERE id = $6',
    [title || null, subtitle ?? null, link_url ?? null, active === undefined ? null : !!active, sort_order === undefined ? null : parseInt(sort_order, 10), req.params.id]);
  res.json({ ok: true });
});
app.delete('/api/admin/banners/:id', auth, requireAdmin, async (req, res) => {
  await q('DELETE FROM banners WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Campaigns CRUD
app.post('/api/admin/campaigns', auth, requireAdmin, async (req, res) => {
  const { title, description, bkash, nagad, bank } = req.body;
  if (!title || !String(title).trim() || !description || !String(description).trim()) return res.status(400).json({ error: 'শিরোনাম ও বিবরণ দিন' });
  const r = await q('INSERT INTO campaigns (title, description, bkash, nagad, bank) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [String(title).trim(), String(description).trim(), bkash || null, nagad || null, bank || null]);
  res.json({ ok: true, campaign: r.rows[0] });
});
app.put('/api/admin/campaigns/:id', auth, requireAdmin, async (req, res) => {
  const { title, description, bkash, nagad, bank, active } = req.body;
  await q('UPDATE campaigns SET title = COALESCE($1, title), description = COALESCE($2, description), bkash = $3, nagad = $4, bank = $5, active = COALESCE($6, active) WHERE id = $7',
    [title || null, description || null, bkash ?? null, nagad ?? null, bank ?? null, active === undefined ? null : !!active, req.params.id]);
  res.json({ ok: true });
});
app.delete('/api/admin/campaigns/:id', auth, requireAdmin, async (req, res) => {
  await q('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Directory CRUD
app.post('/api/admin/directory', auth, requireAdmin, async (req, res) => {
  const { district, type, name, phone, address } = req.body;
  if (!district || !['blood_bank', 'hospital', 'ambulance'].includes(type) || !name || !phone) return res.status(400).json({ error: 'জেলা, ধরন, নাম ও ফোন দিন' });
  const r = await q('INSERT INTO directory_entries (district, type, name, phone, address) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [district, type, String(name).trim(), String(phone).trim(), address || null]);
  res.json({ ok: true, entry: r.rows[0] });
});
app.delete('/api/admin/directory/:id', auth, requireAdmin, async (req, res) => {
  await q('DELETE FROM directory_entries WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Settings (helplines + social group links)
app.put('/api/admin/settings', auth, requireAdmin, async (req, res) => {
  const allowed = ['helpline1', 'helpline2', 'fb_group_url', 'messenger_url', 'whatsapp_url'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const v = String(req.body[key]).trim();
      if (key.startsWith('helpline') && v && !/^[0-9+\- ]{7,15}$/.test(v)) return res.status(400).json({ error: 'সঠিক হেল্পলাইন নম্বর দিন' });
      if ((key === 'fb_group_url' || key === 'messenger_url' || key === 'whatsapp_url') && v && !/^https?:\/\//.test(v)) return res.status(400).json({ error: 'সঠিক লিংক দিন (https://...)' });
      await setSetting(key, v);
    }
  }
  await audit(req.user.id, 'update-settings', Object.keys(req.body).join(','));
  res.json({ ok: true });
});

app.get('/api/admin/audit', auth, requireAdmin, async (req, res) => {
  const r = await q('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100');
  res.json({ audit: r.rows });
});

// ---------------- SPA fallback & start ----------------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'সার্ভার সমস্যা' });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`রক্তের সন্ধানে আমরা বাংলাদেশ — running on port ${PORT}`);
    if (DEV_OTP) console.log('[DEV_OTP] TEST MODE ON — OTPs are shown on screen. Turn off in production once SMS is configured.');
    if (USE_PGMEM) console.log('[pg-mem] TEST MODE — data is in-memory only and will be lost on restart.');
  });
}).catch((e) => { console.error('DB init failed:', e); process.exit(1); });
