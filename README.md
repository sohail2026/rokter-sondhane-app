# রক্তের সন্ধানে আমরা বাংলাদেশ — Blood Donation & Social Welfare App

বাংলা ভাষার ব্লাড ডোনেশন ও সমাজকল্যাণ অ্যাপ — ডোনার খোঁজা, জরুরি রক্তের আবেদন,
মডারেটর KYC যাচাই, সুপার অ্যাডমিন প্যানেল, দুর্যোগ/দান ক্যাম্পেইন, জরুরি ডিরেক্টরি
ও রক্তদান সার্টিফিকেট — সব এক জায়গায়।

**Stack:** Node.js + Express + PostgreSQL (Neon free tier), vanilla HTML/CSS/JS —
কোনো build step নেই। Render free tier-এ চলে।

> ⚠️ **সবচেয়ে জরুরি কথা:** যে প্রথম রেজিস্টার করবে, সে-ই **সুপার অ্যাডমিন** হবে।
> তাই ডেপ্লয়ের পর সবার আগে **নিজে** রেজিস্টার করুন — অন্য কেউ আগে রেজিস্টার
> করলে সে অ্যাডমিন হয়ে যাবে!

---

## ✨ ফিচার

- **ফোন + OTP লগইন** — ১১ সংখ্যার বাংলাদেশি নম্বর, ১ নম্বরে ১ অ্যাকাউন্ট
- **ডোনার প্রোফাইল** — নাম, জন্ম তারিখ (বয়স auto-calculate; ১৮-এর কম হলে
  "Not Eligible yet"), ব্লাড গ্রুপ, জেলা (৬৪টি), উপজেলা, শেষ রক্তদানের তারিখ
  (৯০ দিন পুরুষ / ১২০ দিন মহিলা — eligibility auto-calculate), Available toggle,
  প্রোফাইল ছবি (auto-crop) + "ছবি লুকান" প্রাইভেসি অপশন
- **রক্তের আবেদন** — সাথে সাথে প্রকাশ হয় (জরুরি ক্ষেত্রে অনুমোদনের অপেক্ষা নেই);
  স্ট্যান্ডার্ড বাংলা ফরম্যাট; Call / Inbox / Copy Format / Share Card (PNG) /
  Mark as Managed বাটন
- **ডোনার সার্চ** — ব্লাড গ্রুপ, জেলা, উপজেলা, নাম দিয়ে
- **ইন-অ্যাপ মেসেজিং** — আবেদনকারী ↔ ডোনার চ্যাট + নোটিফিকেশন বেল
- **মডারেটর (KYC)** — NID (সামনে+পেছনে) বা জন্ম সনদ দিয়ে আবেদন; অ্যাডমিন
  অনুমোদন করলে Verified Moderator ব্যাজ + জেলা দায়িত্ব; মডারেটর আবেদন
  সম্পাদনা/মুছে ফেলা, জরুরি নোটিফিকেশন পাঠানো, Verified Donor ব্যাজ দেওয়া
- **সুপার অ্যাডমিন প্যানেল** — পরিসংখ্যান, মডারেটর আবেদন পর্যালোচনা (KYC ছবি
  শুধু অ্যাডমিন দেখতে পারেন), রোল পরিবর্তন, ব্যান, রিপোর্ট, ব্যানার, ক্যাম্পেইন,
  ডিরেক্টরি, হেল্পলাইন + ফেসবুক গ্রুপ লিংক সেটিংস, অডিট লগ
- **দুর্যোগ ও দান** — ক্যাম্পেইন + bKash/Nagad/ব্যাংক তথ্য
- **জরুরি ডিরেক্টরি** — জেলা অনুযায়ী ব্লাড ব্যাংক / হাসপাতাল / অ্যাম্বুলেন্স;
  ফোনে cache হয়, অফলাইনেও দেখা যায়
- **রক্তদান ইতিহাস ও সার্টিফিকেট** — রেকর্ড + প্রিন্ট/PNG "ধন্যবাদ সার্টিফিকেট"
- **হেল্পলাইন** — ভাসমান কল বাটন (09638877444 / 01966689599, অ্যাডমিন বদলাতে পারেন)
- **ফেসবুক গ্রুপ** — হোম ও About-এ "আমাদের ফেসবুক গ্রুপ" বাটন
  (https://www.facebook.com/share/g/1CYoKfm9sA/ — সেটিংস থেকে বদলানো যায়)

---

## 🚀 ডেপ্লয় — ধাপে ধাপে (Neon + Render, ফ্রি)

### ১. Neon ফ্রি ডেটাবেস তৈরি করুন
1. https://neon.tech → Sign up (Google দিয়ে) → **Create Project**
2. Project name: `rokter-sondhane` → Region: Singapore → Create
3. Dashboard থেকে **Connection string** কপি করুন — দেখতে এমন:
   `postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
4. টেবিল নিজে বানাতে হবে না — সার্ভার প্রথম চালুতে সব টেবিল নিজে তৈরি করে নেবে।

### ২. GitHub-এ কোড আপলোড করুন
1. GitHub-এ নতুন **Public** repository বানান (যেমন `rokter-sondhane-app`)
2. এই zip-এর সব ফাইল repo-তে আপলোড করুন (`server.js`, `package.json`,
   `public/`, `README.md`, `.gitignore`)
3. ⚠️ `.env` ফাইল কখনো GitHub-এ দেবেন না (`.gitignore`-এ আছে)

### ৩. Render-এ ডেপ্লয় করুন
1. https://render.com → New → **Web Service** → GitHub repo বেছে নিন
2. Build Command: `npm install` · Start Command: `npm start` · Plan: **Free**
3. **Environment Variables**-এ যোগ করুন:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon থেকে কপি করা connection string |
| `DEV_OTP` | `true` (শুধু শুরুতে/টেস্টের সময়; SMS চালু হলে `false` করুন বা মুছে দিন) |

4. **Deploy** → লিংক পাবেন, যেমন `https://rokter-sondhane-app.onrender.com`
5. ⚠️ ডেপ্লয়ের পর **সবার আগে নিজে রেজিস্টার করুন** — প্রথম ব্যবহারকারীই সুপার অ্যাডমিন!

> Render free tier-এ ১৫ মিনিট ব্যবহার না হলে সার্ভার ঘুমিয়ে যায়; প্রথম ভিজিটে
> লোড হতে ~১ মিনিট লাগতে পারে। এটা স্বাভাবিক।

---

## 📱 SMS OTP সেটআপ (আসল SMS পাঠাতে)

বাংলাদেশে SMS পাঠাতে **পেইড SMS গেটওয়ে** লাগবে। উদাহরণ: **BulkSMSBD**
(https://bulksmsbd.net) — অ্যাকাউন্ট খুলে প্যাকেজ কিনে API Key নিন।

Render-এ এই Environment Variables যোগ করুন:

| Variable | Value |
|---|---|
| `SMS_API_URL` | `https://bulksmsbd.net/api/smsapi` |
| `SMS_API_KEY` | আপনার BulkSMSBD API Key |
| `SMS_SENDER_ID` | আপনার অনুমোদিত Sender ID (যেমন `8809612444422`) |
| `DEV_OTP` | মুছে দিন বা `false` করুন |

তারপর Render-এ **Manual Deploy** → Deploy latest commit করুন।

> `DEV_OTP=true` থাকলে OTP স্ক্রিনেই দেখা যায় (স্পষ্টভাবে "টেস্ট মোড" লেখা
> থাকে)। এটা শুধু টেস্ট/ডেমোর জন্য — SMS চালু হলে অবশ্যই বন্ধ করুন, নাহলে
> যে কেউ যেকোনো নম্বর দিয়ে রেজিস্টার করতে পারবে।

---

## ⚙️ Environment Variables (সবগুলো)

| Variable | দরকার? | কাজ |
|---|---|---|
| `DATABASE_URL` | ✅ আবশ্যক | Neon PostgreSQL connection string |
| `PORT` | Render নিজে দেয় | সার্ভার পোর্ট |
| `DEV_OTP` | ঐচ্ছিক | `true` হলে OTP স্ক্রিনে দেখায় (টেস্ট মোড) |
| `SMS_API_URL` | SMS-এর জন্য | SMS গেটওয়ের API URL |
| `SMS_API_KEY` | SMS-এর জন্য | SMS গেটওয়ের API Key |
| `SMS_SENDER_ID` | SMS-এর জন্য | অনুমোদিত Sender ID |
| `USE_PGMEM` | শুধু টেস্ট | `true` হলে in-memory Postgres (ডেটা থাকে না) |

---

## 💻 লোকাল টেস্ট (Neon ছাড়া)

```bash
npm install
npm test   # USE_PGMEM=true DEV_OTP=true — in-memory ডেটাবেস, রিস্টার্টে ডেটা মুছে যায়
```

তারপর http://localhost:3000 খুলুন। টেস্ট মোডে OTP স্ক্রিনেই দেখা যাবে।

---

## 📁 ফাইল তালিকা

```
server.js            Express সার্ভার + সব API + PostgreSQL
package.json         dependencies (express, pg, multer) + pg-mem (dev only)
public/
  index.html         পুরো অ্যাপের UI (বাংলা)
  style.css          লাল/সবুজ/সাদা থিম, মোবাইল-ফ্রেন্ডলি
  app.js             ফ্রন্টএন্ড লজিক (OTP, ফিড, চ্যাট, শেয়ার কার্ড, সার্টিফিকেট)
  logo.jpg           সংগঠনের লোগো
uploads/kyc/         মডারেটর KYC ছবি (public নয়, শুধু অ্যাডমিন দেখতে পারেন)
README.md            এই ফাইল
.gitignore           node_modules, .env, uploads/
```

---

## ⚠️ সৎ সীমাবদ্ধতা (জেনে রাখুন)

1. **আসল SMS OTP-এর জন্য পেইড গেটওয়ে লাগবে** — API Key ছাড়া SMS যাবে না;
   ততদিন DEV_OTP টেস্ট মোডে OTP স্ক্রিনে দেখা যায়।
2. **নোটিফিকেশন শুধু ইন-অ্যাপ** — অ্যাপের ভেতরের বেল আইকনে দেখা যায়; FCM/push
   নোটিফিকেশন এখনো নেই (ভবিষ্যতের কাজ)।
3. **KYC ফাইল এনক্রিপ্ট করা নয়** — ফাইলগুলো অ্যাডমিন-শুধু endpoint দিয়ে সুরক্ষিত,
   কিন্তু disk-এ plain image হিসেবে থাকে। Render free tier-এ redeploy/restart-এ
   `uploads/` মুছে যেতে পারে — তাই গুরুত্বপূর্ণ KYC দ্রুত পর্যালোচনা করে নিন।
4. **DEV_OTP চালু থাকলে** যে কেউ যেকোনো নম্বর দিয়ে রেজিস্টার করতে পারে —
   প্রোডাকশনে SMS চালু করে DEV_OTP বন্ধ করুন।
5. Render free tier ঘুমিয়ে যায় (১৫ মিনিট নিষ্ক্রিয় থাকলে) — প্রথম লোডে দেরি হয়।

---

## 🔐 নিরাপত্তা নোট

- সব ডেটাবেস কোয়েরি parameterized (SQL injection সুরক্ষা)
- OTP SHA-256 hash করে সংরক্ষণ, ৫ মিনিট মেয়াদ; ঘণ্টায় সর্বোচ্চ ৫ বার OTP;
  ৫ বার ভুল দিলে ১৫ মিনিট লক
- সেশন টোকেন random + ৩০ দিন মেয়াদ
- KYC ছবি `public/`-এর বাইরে, শুধু অ্যাডমিন endpoint দিয়ে
- অ্যাডমিন অ্যাকশন `audit_log`-এ রেকর্ড হয়
