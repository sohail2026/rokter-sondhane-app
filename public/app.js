// রক্তের সন্ধানে আমরা বাংলাদেশ — frontend (vanilla JS)
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const DISTRICTS = ['বাগেরহাট','বান্দরবান','বরগুনা','বরিশাল','ভোলা','বগুড়া','ব্রাহ্মণবাড়িয়া','চাঁদপুর','চট্টগ্রাম','চুয়াডাঙ্গা','কক্সবাজার','কুমিল্লা','ঢাকা','দিনাজপুর','ফরিদপুর','ফেনী','গাইবান্ধা','গাজীপুর','গোপালগঞ্জ','হবিগঞ্জ','জামালপুর','যশোর','ঝালকাঠি','ঝিনাইদহ','জয়পুরহাট','খাগড়াছড়ি','খুলনা','কিশোরগঞ্জ','কুড়িগ্রাম','কুষ্টিয়া','লক্ষ্মীপুর','লালমনিরহাট','মাদারীপুর','মাগুরা','মানিকগঞ্জ','মেহেরপুর','মৌলভীবাজার','মুন্সিগঞ্জ','ময়মনসিংহ','নওগাঁ','নড়াইল','নারায়ণগঞ্জ','নরসিংদী','নাটোর','নেত্রকোণা','নীলফামারী','নোয়াখালী','পাবনা','পঞ্চগড়','পটুয়াখালী','পিরোজপুর','রাজবাড়ী','রাজশাহী','রাঙ্গামাটি','রংপুর','সাতক্ষীরা','শরীয়তপুর','শেরপুর','সিরাজগঞ্জ','সুনামগঞ্জ','সিলেট','টাঙ্গাইল','ঠাকুরগাঁও'];
const FB_GROUP_DEFAULT = 'https://www.facebook.com/share/g/1CYoKfm9sA/';

const state = { user: null, token: localStorage.getItem('rs_token') || null, settings: null, requests: [], chatId: null, chatTimer: null, adminTab: 'stats' };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3500); }
function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return String(d).slice(0, 10); } }
function fmtDateTime(d) { if (!d) return ''; try { return new Date(d).toLocaleString('bn-BD', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }
function fillSelect(sel, items, firstLabel) {
  sel.innerHTML = (firstLabel ? `<option value="">${firstLabel}</option>` : '') + items.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'সার্ভার সমস্যা');
  return data;
}

// ---------------- Navigation ----------------
const VIEWS = ['home', 'donors', 'request', 'campaigns', 'directory', 'inbox', 'chat', 'profile', 'moderator', 'admin', 'about'];
function showView(name) {
  if (['request', 'inbox', 'profile', 'moderator', 'admin'].includes(name) && !state.user) { openAuth(); toast('প্রথমে লগইন করুন'); return; }
  if (name === 'admin' && state.user?.role !== 'admin') { toast('শুধু অ্যাডমিনদের জন্য'); return; }
  if (name === 'moderator' && !['moderator', 'admin'].includes(state.user?.role)) { openModeratorApply(); return; }
  VIEWS.forEach(v => $('#view-' + v)?.classList.toggle('active', v === name));
  $$('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  window.scrollTo({ top: 0 });
  if (name === 'home') loadHome();
  if (name === 'donors') loadDonors();
  if (name === 'request') loadMyRequests();
  if (name === 'campaigns') loadCampaigns();
  if (name === 'directory') loadDirectory();
  if (name === 'inbox') loadConversations();
  if (name === 'profile') loadProfile();
  if (name === 'moderator') loadModerator();
  if (name === 'admin') loadAdmin();
}
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) showView(nav.dataset.nav);
});

// ---------------- Settings / header ----------------
async function loadSettings() {
  try {
    state.settings = await api('/api/settings');
    $('#fabCall1').href = 'tel:' + state.settings.helpline1;
    $('#fabCall1').textContent = '📞 ' + state.settings.helpline1;
    $('#fabCall2').href = 'tel:' + state.settings.helpline2;
    $('#fabCall2').textContent = '📞 ' + state.settings.helpline2;
    $('#aboutHelpline1').href = 'tel:' + state.settings.helpline1;
    $('#aboutHelpline1').textContent = state.settings.helpline1;
    $('#aboutHelpline2').href = 'tel:' + state.settings.helpline2;
    $('#aboutHelpline2').textContent = state.settings.helpline2;
    const fb = state.settings.fb_group_url || FB_GROUP_DEFAULT;
    $('#fbGroupBtnHome').href = fb;
    $('#fbGroupBtnAbout').href = fb;
  } catch { /* defaults in HTML already point at the real group link */ }
}

async function loadMe() {
  if (!state.token) return;
  try {
    const d = await api('/api/me');
    state.user = d.user;
    updateHeaderUser();
  } catch { state.token = null; state.user = null; localStorage.removeItem('rs_token'); }
}
function updateHeaderUser() {
  const av = $('#headerAvatar');
  if (state.user?.photo) { av.innerHTML = `<img src="${esc(state.user.photo)}" alt="">`; }
  else av.textContent = '👤';
}

// ---------------- Home ----------------
async function loadHome() {
  loadStats(); loadBanners(); loadRequests();
}
async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('#statsStrip').innerHTML = `
      <div class="stat"><b>${s.total_donors}</b><span>মোট ডোনার</span></div>
      <div class="stat"><b>${s.total_requests}</b><span>মোট আবেদন</span></div>
      <div class="stat"><b>${s.managed_requests}</b><span>রক্ত ম্যানেজ</span></div>
      <div class="stat"><b>${s.total_donations}</b><span>মোট রক্তদান</span></div>`;
  } catch { /* ignore */ }
}
async function loadBanners() {
  try {
    const d = await api('/api/banners');
    $('#bannerBox').innerHTML = d.banners.map(b => `
      <div class="banner"><h3>${esc(b.title)}</h3>${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ''}${b.link_url ? `<p><a href="${esc(b.link_url)}" target="_blank" rel="noopener">বিস্তারিত →</a></p>` : ''}</div>`).join('');
  } catch { /* ignore */ }
}

function requestCard(r) {
  const me = state.user;
  const canManage = me && (me.id === r.user_id || me.role === 'moderator' || me.role === 'admin');
  const canMod = me && (me.role === 'moderator' || me.role === 'admin');
  const req = r.requester || {};
  const photo = req.photo ? `<img src="${esc(req.photo)}" alt="">` : `<span class="avatar-fallback">👤</span>`;
  const badges = `${req.verified_donor ? '<span class="badge-verified">✓ Verified Donor</span>' : ''}${req.role === 'moderator' ? '<span class="badge-mod">🛡️ Verified Moderator</span>' : ''}${req.role === 'admin' ? '<span class="badge-mod">⚙️ Admin</span>' : ''}`;
  return `
  <div class="card req-card ${r.status === 'managed' ? 'managed' : ''}" data-req="${r.id}">
    <div class="req-meta">${photo}<div><b>${esc(req.name || '—')}</b> ${badges}<br><small>${fmtDateTime(r.created_at)}</small></div>
    ${r.status === 'managed' ? '<span class="badge-managed" style="margin-left:auto">✅ রক্ত ম্যানেজ হয়েছে</span>' : ''}</div>
    <div class="req-format">${esc(r.formatted)}</div>
    <div class="btn-row">
      <a class="btn green small" href="tel:${esc(r.contact_phone)}">📞 Call Now</a>
      <button class="btn small" onclick="startChat(${r.user_id}, ${r.id})">💬 ইনবক্স</button>
      <button class="btn small" onclick="copyFormat(${r.id})">📋 Copy Format</button>
      <button class="btn small" onclick="shareCard(${r.id})">🖼️ Share Card</button>
      ${r.status !== 'managed' && canManage ? `<button class="btn primary small" onclick="markManaged(${r.id})">✅ রক্ত ম্যানেজ হয়েছে</button>` : ''}
      ${canMod ? `<button class="btn small" onclick="editRequest(${r.id})">✏️ সম্পাদনা</button><button class="btn danger small" onclick="deleteRequest(${r.id})">🗑️ মুছুন</button>` : ''}
      ${canMod && r.status !== 'managed' ? `<button class="btn small" onclick="urgentNotify(${r.id})">🚨 জরুরি নোটিফিকেশন</button>` : ''}
      <button class="btn ghost small" onclick="reportItem('request', ${r.id})">🚩 রিপোর্ট</button>
    </div>
  </div>`;
}

async function loadRequests() {
  const feed = $('#requestFeed');
  try {
    const g = $('#homeGroupFilter').value, d = $('#homeDistrictFilter').value;
    const params = new URLSearchParams();
    if (g) params.set('blood_group', g);
    if (d) params.set('district', d);
    if ($('#homeOpenOnly').checked) params.set('status', 'open');
    const data = await api('/api/requests?' + params.toString());
    state.requests = data.requests;
    feed.innerHTML = data.requests.length
      ? data.requests.map(requestCard).join('')
      : '<p class="muted center">কোনো আবেদন পাওয়া যায়নি</p>';
  } catch (e) { feed.innerHTML = `<p class="error center">${esc(e.message)}</p>`; }
}

function findRequest(id) { return state.requests.find(r => r.id === id); }

async function copyFormat(id) {
  const r = findRequest(id) || (await api('/api/requests/' + id)).request;
  try { await navigator.clipboard.writeText(r.formatted); toast('ফরম্যাট কপি হয়েছে — Facebook/WhatsApp-এ শেয়ার করুন'); }
  catch { prompt('নিচের লেখাটি কপি করুন:', r.formatted); }
}

async function markManaged(id) {
  if (!state.user) { openAuth(); return; }
  if (!confirm('রক্ত ম্যানেজ হয়ে গেছে — আবেদনটি বন্ধ করবেন?')) return;
  try { await api(`/api/requests/${id}/manage`, { method: 'POST' }); toast('✅ রক্ত ম্যানেজ হয়েছে'); loadRequests(); } catch (e) { toast(e.message); }
}

async function deleteRequest(id) {
  if (!confirm('এই আবেদনটি মুছে ফেলবেন?')) return;
  try { await api(`/api/requests/${id}`, { method: 'DELETE' }); toast('আবেদন মুছে ফেলা হয়েছে'); loadRequests(); } catch (e) { toast(e.message); }
}

async function urgentNotify(id) {
  if (!confirm('এই জেলার উপযুক্ত ডোনারদের জরুরি নোটিফিকেশন পাঠাবেন?')) return;
  try { const d = await api('/api/moderator/urgent', { method: 'POST', body: JSON.stringify({ request_id: id }) }); toast(`🚨 ${d.notified} জন ডোনারকে নোটিফিকেশন পাঠানো হয়েছে`); }
  catch (e) { toast(e.message); }
}

async function editRequest(id) {
  const r = findRequest(id) || (await api('/api/requests/' + id)).request;
  openGeneric(`
    <h3>✏️ আবেদন সম্পাদনা</h3>
    <form id="editReqForm" class="form">
      <label>রোগীর সমস্যা<input name="problem" value="${esc(r.problem)}" required></label>
      <label>রক্তের পরিমাণ<input name="quantity" value="${esc(r.quantity)}" required></label>
      <label>হিমোগ্লোবিন<input name="hemoglobin" value="${esc(r.hemoglobin || '')}"></label>
      <label>হাসপাতাল<input name="hospital" value="${esc(r.hospital)}" required></label>
      <label>তারিখ<input type="date" name="donation_date" value="${String(r.donation_date).slice(0, 10)}" required></label>
      <label>সময়<input name="donation_time" value="${esc(r.donation_time)}" required></label>
      <label>যোগাযোগ নম্বর<input name="contact_phone" value="${esc(r.contact_phone)}" required></label>
      <button class="btn primary full">সংরক্ষণ করুন</button>
    </form>`);
  $('#editReqForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try { await api(`/api/requests/${id}`, { method: 'PUT', body: JSON.stringify(body) }); closeModal('genericModal'); toast('আবেদন আপডেট হয়েছে'); loadRequests(); }
    catch (err) { toast(err.message); }
  };
}

async function reportItem(type, id) {
  if (!state.user) { openAuth(); return; }
  const reason = prompt('রিপোর্টের কারণ লিখুন:');
  if (!reason) return;
  try { await api('/api/reports', { method: 'POST', body: JSON.stringify({ target_type: type, target_id: id, reason }) }); toast('রিপোর্ট পাঠানো হয়েছে — অ্যাডমিন দেখবেন'); }
  catch (e) { toast(e.message); }
}

// Share card: red-and-white emergency PNG with logo (client-side canvas)
async function shareCard(id) {
  const r = findRequest(id) || (await api('/api/requests/' + id)).request;
  toast('কার্ড তৈরি হচ্ছে…');
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#D32F2F'; ctx.fillRect(0, 0, W, 300);
  try {
    const logo = await loadImage('/logo.jpg');
    ctx.save(); ctx.beginPath(); ctx.arc(150, 150, 100, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(logo, 50, 50, 200, 200); ctx.restore();
  } catch { /* logo optional */ }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  ctx.font = '700 52px "Hind Siliguri", sans-serif';
  ctx.fillText('রক্তের সন্ধানে আমরা বাংলাদেশ', 290, 130);
  ctx.font = '500 34px "Hind Siliguri", sans-serif';
  ctx.fillText('🚨 জরুরি রক্তের প্রয়োজন', 290, 200);
  // Blood group circle
  ctx.fillStyle = '#D32F2F'; ctx.beginPath(); ctx.arc(W / 2, 470, 120, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '700 110px "Hind Siliguri", sans-serif';
  ctx.fillText(r.blood_group, W / 2, 510);
  ctx.fillStyle = '#222'; ctx.font = '600 44px "Hind Siliguri", sans-serif';
  const lines = [
    `💁‍♂️ ${r.problem}`,
    `💉 পরিমাণ: ${r.quantity}`,
    `🏢 ${r.hospital}`,
    `📍 ${[r.upazila, r.district].filter(Boolean).join(', ')}`,
    `📆 ${fmtDate(r.donation_date)}  ⏰ ${r.donation_time}`,
  ];
  lines.forEach((t, i) => ctx.fillText(t, W / 2, 680 + i * 70));
  ctx.fillStyle = '#2E7D32'; ctx.font = '700 58px "Hind Siliguri", sans-serif';
  ctx.fillText('☎️ ' + r.contact_phone, W / 2, 1080);
  ctx.fillStyle = '#666'; ctx.font = '500 32px "Hind Siliguri", sans-serif';
  ctx.fillText('রক্ত হোক অন্যের জীবন, রক্তই হোক আত্মার বাঁধন', W / 2, 1180);
  ctx.fillText('রক্তের সন্ধানে আমরা বাংলাদেশ', W / 2, 1240);
  cv.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blood-request-${r.blood_group.replace('+', 'pos').replace('-', 'neg')}-${r.id}.png`;
    a.click(); toast('কার্ড ডাউনলোড হয়েছে');
  }, 'image/png');
}
function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }

// ---------------- Modals ----------------
function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) closeModal(c.dataset.close);
  if (e.target.classList?.contains('modal')) e.target.classList.add('hidden');
});
function openGeneric(html) { $('#genericModalContent').innerHTML = html; openModal('genericModal'); }

// ---------------- Auth ----------------
let authPhone = '', authRegToken = '', regPhotoData = null;
function openAuth() {
  $('#authStepPhone').classList.remove('hidden');
  $('#authStepOtp').classList.add('hidden');
  $('#authStepRegister').classList.add('hidden');
  $('#authError').classList.add('hidden');
  $('#devOtpBox').classList.add('hidden');
  openModal('authModal');
}
function authErr(msg) { const el = $('#authError'); el.textContent = msg; el.classList.remove('hidden'); }

async function sendOtp() {
  const phone = $('#authPhone').value.trim();
  if (!/^01[3-9]\d{8}$/.test(phone)) { authErr('সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন'); return; }
  authPhone = phone;
  try {
    const d = await api('/api/auth/send-otp', { method: 'POST', body: JSON.stringify({ phone }) });
    $('#authStepPhone').classList.add('hidden');
    $('#authStepOtp').classList.remove('hidden');
    $('#otpPhoneLabel').textContent = phone;
    if (d.dev_mode && d.dev_otp) {
      const box = $('#devOtpBox');
      box.classList.remove('hidden');
      box.innerHTML = `🧪 <b>টেস্ট মোড</b> — SMS গেটওয়ে এখনো সেট করা হয়নি, তাই OTP এখানে দেখানো হচ্ছে:<br><b>${d.dev_otp}</b>`;
    }
    toast(d.sms_sent ? 'OTP পাঠানো হয়েছে' : 'OTP তৈরি হয়েছে');
  } catch (e) { authErr(e.message); }
}
$('#sendOtpBtn').onclick = sendOtp;
$('#resendOtpBtn').onclick = sendOtp;

$('#verifyOtpBtn').onclick = async () => {
  const otp = $('#authOtp').value.trim();
  if (!/^\d{6}$/.test(otp)) { authErr('৬ সংখ্যার OTP দিন'); return; }
  try {
    const d = await api('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone: authPhone, otp }) });
    if (!d.isNew) {
      state.token = d.token; state.user = d.user;
      localStorage.setItem('rs_token', d.token);
      closeModal('authModal'); updateHeaderUser(); refreshNotifications();
      toast(`স্বাগতম, ${d.user.name}!`); showView('home');
    } else {
      authRegToken = d.reg_token;
      $('#authStepOtp').classList.add('hidden');
      $('#authStepRegister').classList.remove('hidden');
    }
  } catch (e) { authErr(e.message); }
};

// Profile photo: client-side auto-crop to square 256x256 JPEG
function processPhotoFile(file, previewEl, cb) {
  const img = new Image();
  img.onload = () => {
    const s = Math.min(img.width, img.height);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
    const data = cv.toDataURL('image/jpeg', 0.82);
    if (previewEl) { previewEl.src = data; previewEl.classList.remove('hidden'); }
    cb(data);
  };
  img.src = URL.createObjectURL(file);
}
$('#regPhoto').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) processPhotoFile(f, $('#regPhotoPreview'), (d) => { regPhotoData = d; });
});
$('#regDob').addEventListener('change', (e) => {
  const age = calcAgeClient(e.target.value);
  $('#regAgeNote').textContent = age === null ? '' : age < 18 ? `বয়স ${age} বছর — ১৮ বছরের কম হলে ডোনার হিসেবে "Not Eligible yet" দেখাবে।` : `বয়স ${age} বছর`;
});
function calcAgeClient(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
}

$('#registerForm').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    reg_token: authRegToken,
    name: fd.get('name'), dob: fd.get('dob'), gender: fd.get('gender') || null,
    blood_group: fd.get('blood_group'), district: fd.get('district') || null,
    upazila: fd.get('upazila') || null, last_donation: fd.get('last_donation') || null,
    photo: regPhotoData, photo_hidden: !!fd.get('photo_hidden'),
  };
  try {
    const d = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
    state.token = d.token; state.user = d.user;
    localStorage.setItem('rs_token', d.token);
    closeModal('authModal'); updateHeaderUser();
    toast(d.isAdmin ? '🎉 আপনি প্রথম ব্যবহারকারী — সুপার অ্যাডমিন হয়েছেন!' : `স্বাগতম, ${d.user.name}!`);
    showView('home');
  } catch (err) { authErr(err.message); }
};

// ---------------- Request form ----------------
$('#requestForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!state.user) { openAuth(); return; }
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await api('/api/requests', { method: 'POST', body: JSON.stringify(body) });
    toast('✅ আবেদন প্রকাশ হয়েছে'); e.target.reset();
    loadMyRequests(); showView('home');
  } catch (err) { toast(err.message); }
};
async function loadMyRequests() {
  const box = $('#myRequests');
  if (!state.user) { box.innerHTML = '<p class="muted">লগইন করলে আপনার আবেদন দেখাবে</p>'; return; }
  try {
    const d = await api('/api/my-requests');
    state.requests = [...state.requests, ...d.requests.filter(r => !state.requests.some(x => x.id === r.id))];
    box.innerHTML = d.requests.length ? d.requests.map(requestCard).join('') : '<p class="muted">আপনার কোনো আবেদন নেই</p>';
  } catch { box.innerHTML = ''; }
}

// ---------------- Donor search ----------------
function eligibilityPill(d) {
  if (d.eligibility_reason === 'under18') return '<span class="pill no">১৮ বছরের কম — Not Eligible yet</span>';
  if (!d.eligible) return `<span class="pill wait">পরবর্তী রক্তদান: ${fmtDate(d.eligible_date)}</span>`;
  return '<span class="pill ok">✅ রক্ত দিতে পারবেন</span>';
}
function donorCard(d) {
  const photo = d.photo ? `<img src="${esc(d.photo)}" class="donor-photo" alt="">` : `<span class="avatar-fallback">👤</span>`;
  const badges = `${d.verified_donor ? '<span class="badge-verified">✓ Verified Donor</span>' : ''}${d.role === 'moderator' ? '<span class="badge-mod">🛡️ Verified Moderator</span>' : ''}`;
  const me = state.user;
  const canVerify = me && (me.role === 'moderator' || me.role === 'admin') && (!me.mod_district || me.mod_district === d.district);
  return `
  <div class="card donor-card">
    ${photo}
    <div class="donor-info">
      <h3>${esc(d.name)} ${badges}</h3>
      <span class="blood-badge">${esc(d.blood_group)}</span>
      ${d.available ? '<span class="pill ok">🟢 Available</span>' : '<span class="pill no">🔴 Unavailable</span>'}
      ${eligibilityPill(d)}
      <div class="muted small">📍 ${esc([d.upazila, d.district].filter(Boolean).join(', ') || '—')}${d.donation_count ? ` · 🩸 ${d.donation_count} বার রক্তদান` : ''}</div>
      <div class="btn-row">
        <a class="btn green small" href="tel:${esc(d.phone)}">📞 কল করুন</a>
        <button class="btn small" onclick="startChat(${d.id}, null)">💬 মেসেজ</button>
        ${canVerify ? `<button class="btn small" onclick="verifyDonor(${d.id}, ${d.verified_donor ? 'false' : 'true'})">${d.verified_donor ? '✓ যাচাই বাতিল' : '✓ Verify Donor'}</button>` : ''}
        <button class="btn ghost small" onclick="reportItem('user', ${d.id})">🚩 রিপোর্ট</button>
      </div>
    </div>
  </div>`;
}
async function loadDonors() {
  const box = $('#donorList');
  try {
    const params = new URLSearchParams();
    const g = $('#donorGroup').value, d = $('#donorDistrict').value, u = $('#donorUpazila').value.trim(), n = $('#donorName').value.trim();
    if (g) params.set('blood_group', g);
    if (d) params.set('district', d);
    if (u) params.set('upazila', u);
    if (n) params.set('q', n);
    const data = await api('/api/donors?' + params.toString());
    box.innerHTML = data.donors.length ? data.donors.map(donorCard).join('') : '<p class="muted center">কোনো ডোনার পাওয়া যায়নি</p>';
  } catch (e) { box.innerHTML = `<p class="error center">${esc(e.message)}</p>`; }
}
$('#donorSearchBtn').onclick = loadDonors;
async function verifyDonor(id, verified) {
  try { await api(`/api/moderator/verify-donor/${id}`, { method: 'POST', body: JSON.stringify({ verified }) }); toast(verified ? '✓ Verified Donor ব্যাজ দেওয়া হয়েছে' : 'ব্যাজ সরানো হয়েছে'); loadDonors(); }
  catch (e) { toast(e.message); }
}

// ---------------- Profile ----------------
async function loadProfile() {
  const box = $('#profileBox');
  if (!state.user) { box.innerHTML = '<p class="muted">লগইন করুন</p>'; openAuth(); return; }
  try {
    const [me, dons] = [await api('/api/me'), await api('/api/donations')];
    state.user = me.user;
    const u = me.user;
    const el = eligibilityPill(u);
    const photo = u.photo ? `<img src="${esc(u.photo)}" class="photo-preview" alt="">` : `<span class="avatar-fallback" style="width:90px;height:90px;font-size:2.5rem">👤</span>`;
    const roleBadge = u.role === 'admin' ? '<span class="badge-mod">⚙️ Super Admin</span>' : u.role === 'moderator' ? `<span class="badge-mod">🛡️ Verified Moderator — ${esc(u.mod_district || '')}</span>` : '';
    box.innerHTML = `
    <div class="card" style="text-align:center">
      ${photo}
      <h3>${esc(u.name)} ${u.verified_donor ? '<span class="badge-verified">✓ Verified Donor</span>' : ''}</h3>
      <p>${roleBadge}</p>
      <p><span class="blood-badge">${esc(u.blood_group)}</span> ${u.available ? '<span class="pill ok">🟢 Available</span>' : '<span class="pill no">🔴 Unavailable</span>'} ${el}</p>
      <p class="muted">📱 ${esc(u.phone)} · 🎂 ${u.age !== null ? u.age + ' বছর' : '—'}<br>📍 ${esc([u.upazila, u.district].filter(Boolean).join(', ') || '—')}</p>
      <p>🩸 মোট রক্তদান: <b>${dons.count} বার</b></p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" onclick="editProfile()">✏️ প্রোফাইল সম্পাদনা</button>
        <button class="btn" onclick="toggleAvailable()">${u.available ? '🔴 Unavailable করুন' : '🟢 Available করুন'}</button>
      </div>
      <div class="btn-row" style="justify-content:center">
        ${u.role === 'admin' ? '<button class="btn green" data-nav="admin">⚙️ অ্যাডমিন প্যানেল</button>' : ''}
        ${u.role === 'moderator' ? '<button class="btn green" data-nav="moderator">🛡️ মডারেটর প্যানেল</button>' : ''}
        ${u.role === 'user' ? '<button class="btn" onclick="openModeratorApply()">🛡️ মডারেটর হতে আবেদন করুন</button>' : ''}
        <button class="btn" onclick="showCertificate()">🏆 ধন্যবাদ সার্টিফিকেট</button>
        <button class="btn danger" onclick="logout()">🚪 লগআউট</button>
      </div>
    </div>
    <div class="card">
      <h3>🩸 রক্তদানের ইতিহাস</h3>
      <form id="donationForm" class="form">
        <div class="grid-2">
          <label>তারিখ *<input type="date" name="donation_date" required></label>
          <label>স্থান/হাসপাতাল<input type="text" name="place" placeholder="যেমন: ঢাকা মেডিকেল"></label>
        </div>
        <button class="btn green full">➕ রক্তদান যোগ করুন</button>
      </form>
      <div style="margin-top:10px">${dons.donations.length ? dons.donations.map(d => `
        <div class="notif-item">🩸 ${fmtDate(d.donation_date)} — ${esc(d.place || '—')}
        <button class="btn ghost small" style="float:right" onclick="deleteDonation(${d.id})">🗑️</button></div>`).join('') : '<p class="muted">এখনো কোনো রক্তদান রেকর্ড নেই</p>'}</div>
    </div>`;
    $('#donationForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try { await api('/api/donations', { method: 'POST', body: JSON.stringify(body) }); toast('✅ রক্তদান রেকর্ড যোগ হয়েছে'); loadProfile(); }
      catch (err) { toast(err.message); }
    };
  } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
async function deleteDonation(id) {
  if (!confirm('এই রেকর্ড মুছবেন?')) return;
  try { await api(`/api/donations/${id}`, { method: 'DELETE' }); loadProfile(); } catch (e) { toast(e.message); }
}
async function toggleAvailable() {
  try { const d = await api('/api/me', { method: 'PUT', body: JSON.stringify({ available: !state.user.available }) }); state.user = d.user; loadProfile(); }
  catch (e) { toast(e.message); }
}
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.token = null; state.user = null; localStorage.removeItem('rs_token');
  updateHeaderUser(); toast('লগআউট হয়েছে'); showView('home');
}

let editPhotoData = undefined;
function editProfile() {
  const u = state.user;
  openGeneric(`
    <h3>✏️ প্রোফাইল সম্পাদনা</h3>
    <form id="editProfileForm" class="form">
      <label>পূর্ণ নাম<input name="name" value="${esc(u.name)}" required></label>
      <label>জন্ম তারিখ<input type="date" name="dob" value="${u.dob ? String(u.dob).slice(0, 10) : ''}"></label>
      <label>লিঙ্গ<select name="gender"><option value="">বেছে নিন</option><option value="পুরুষ" ${u.gender === 'পুরুষ' ? 'selected' : ''}>পুরুষ</option><option value="মহিলা" ${u.gender === 'মহিলা' ? 'selected' : ''}>মহিলা</option></select></label>
      <label>রক্তের গ্রুপ<select name="blood_group">${BLOOD_GROUPS.map(g => `<option ${g === u.blood_group ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
      <label>জেলা<select name="district"><option value="">বেছে নিন</option>${DISTRICTS.map(d => `<option ${d === u.district ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>উপজেলা/থানা<input name="upazila" value="${esc(u.upazila || '')}"></label>
      <label>শেষ রক্তদানের তারিখ<input type="date" name="last_donation" value="${u.last_donation ? String(u.last_donation).slice(0, 10) : ''}"></label>
      <label>প্রোফাইল ছবি<input type="file" id="editPhoto" accept="image/*"><img id="editPhotoPreview" class="photo-preview ${u.photo ? '' : 'hidden'}" src="${u.photo ? esc(u.photo) : ''}" alt=""></label>
      <label class="chk"><input type="checkbox" name="photo_hidden" ${u.photo_hidden ? 'checked' : ''}> ছবি লুকান</label>
      <button class="btn primary full">সংরক্ষণ করুন</button>
    </form>`);
  editPhotoData = undefined;
  $('#editPhoto').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) processPhotoFile(f, $('#editPhotoPreview'), (d) => { editPhotoData = d; });
  });
  $('#editProfileForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'), dob: fd.get('dob') || null, gender: fd.get('gender') || null,
      blood_group: fd.get('blood_group'), district: fd.get('district') || null,
      upazila: fd.get('upazila') || null, last_donation: fd.get('last_donation') || null,
      photo_hidden: !!fd.get('photo_hidden'),
    };
    if (editPhotoData !== undefined) body.photo = editPhotoData;
    try { const d = await api('/api/me', { method: 'PUT', body: JSON.stringify(body) }); state.user = d.user; closeModal('genericModal'); updateHeaderUser(); toast('প্রোফাইল আপডেট হয়েছে'); loadProfile(); }
    catch (err) { toast(err.message); }
  };
}

// ---------------- Certificate ----------------
async function showCertificate() {
  const dons = await api('/api/donations');
  const u = state.user;
  const last = dons.donations[0];
  $('#certContent').innerHTML = `
  <div class="certificate" id="certView">
    <img src="/logo.jpg" alt="লোগো">
    <h2>ধন্যবাদ সার্টিফিকেট</h2>
    <p>রক্তের সন্ধানে আমরা বাংলাদেশ</p>
    <p>এই সার্টিফিকেটটি গর্বের সাথে প্রদান করা হচ্ছে</p>
    <p class="cert-name">${esc(u.name)}</p>
    <p class="cert-meta">রক্তের গ্রুপ: <b>${esc(u.blood_group)}</b></p>
    <p class="cert-meta">মোট রক্তদান: <b>${dons.count} বার</b>${last ? ` · সর্বশেষ: ${fmtDate(last.donation_date)}` : ''}</p>
    <p>আপনার রক্তদান অন্যের জীবন বাঁচিয়েছে। ধন্যবাদ! ❤️</p>
    <p class="muted small">“রক্ত হোক অন্যের জীবন, রক্তই হোক আত্মার বাঁধন”</p>
    <p class="muted small">${fmtDate(new Date())}</p>
  </div>`;
  openModal('certModal');
  $('#certDownloadBtn').onclick = async () => {
    const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 800);
    ctx.strokeStyle = '#D32F2F'; ctx.lineWidth = 10; ctx.strokeRect(20, 20, 1160, 760);
    ctx.strokeStyle = '#2E7D32'; ctx.lineWidth = 3; ctx.strokeRect(40, 40, 1120, 720);
    try { const logo = await loadImage('/logo.jpg'); ctx.save(); ctx.beginPath(); ctx.arc(600, 150, 70, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(logo, 530, 80, 140, 140); ctx.restore(); } catch { /* ignore */ }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#D32F2F'; ctx.font = '700 56px "Hind Siliguri", sans-serif'; ctx.fillText('ধন্যবাদ সার্টিফিকেট', 600, 300);
    ctx.fillStyle = '#2E7D32'; ctx.font = '600 36px "Hind Siliguri", sans-serif'; ctx.fillText('রক্তের সন্ধানে আমরা বাংলাদেশ', 600, 350);
    ctx.fillStyle = '#333'; ctx.font = '500 32px "Hind Siliguri", sans-serif'; ctx.fillText('এই সার্টিফিকেটটি গর্বের সাথে প্রদান করা হচ্ছে', 600, 420);
    ctx.fillStyle = '#1B5E20'; ctx.font = '700 52px "Hind Siliguri", sans-serif'; ctx.fillText(u.name, 600, 500);
    ctx.fillStyle = '#333'; ctx.font = '600 36px "Hind Siliguri", sans-serif';
    ctx.fillText(`রক্তের গ্রুপ: ${u.blood_group}  ·  মোট রক্তদান: ${dons.count} বার`, 600, 570);
    ctx.fillText('আপনার রক্তদান অন্যের জীবন বাঁচিয়েছে। ধন্যবাদ! ❤️', 600, 640);
    ctx.fillStyle = '#666'; ctx.font = '500 28px "Hind Siliguri", sans-serif';
    ctx.fillText('রক্ত হোক অন্যের জীবন, রক্তই হোক আত্মার বাঁধন', 600, 710);
    cv.toBlob((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'certificate.png'; a.click(); toast('সার্টিফিকেট ডাউনলোড হয়েছে'); }, 'image/png');
  };
}

// ---------------- Messaging ----------------
async function startChat(userId, requestId) {
  if (!state.user) { openAuth(); return; }
  if (userId === state.user.id) { toast('নিজের সাথে চ্যাট করা যাবে না'); return; }
  try {
    const d = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ user_id: userId, request_id: requestId }) });
    openChat(d.conversation.id);
  } catch (e) { toast(e.message); }
}
async function loadConversations() {
  const box = $('#convList');
  if (!state.user) { box.innerHTML = '<p class="muted">লগইন করুন</p>'; return; }
  try {
    const d = await api('/api/conversations');
    box.innerHTML = d.conversations.length ? d.conversations.map(c => `
      <div class="card conv-item" onclick="openChat(${c.id})">
        ${c.other_photo ? `<img src="${esc(c.other_photo)}" class="donor-photo" alt="">` : '<span class="avatar-fallback">👤</span>'}
        <div style="flex:1;min-width:0"><b>${esc(c.other_name)}</b><br><small class="muted">${esc(c.last_message || '—')}</small></div>
        ${c.unread ? `<span class="unread-dot">${c.unread}</span>` : ''}
        <small class="muted">${fmtDateTime(c.last_at)}</small>
      </div>`).join('') : '<p class="muted center">কোনো কথোপকথন নেই — ডোনার বা আবেদনকারীর "ইনবক্স" বাটনে চাপুন</p>';
  } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
async function openChat(id) {
  state.chatId = id;
  VIEWS.forEach(v => $('#view-' + v)?.classList.toggle('active', v === 'chat'));
  await loadChatMessages();
  clearInterval(state.chatTimer);
  state.chatTimer = setInterval(() => { if (state.chatId) loadChatMessages(true); }, 5000);
}
async function loadChatMessages(silent) {
  if (!state.chatId) return;
  try {
    const d = await api(`/api/conversations/${state.chatId}/messages`);
    const otherId = d.conversation.user_a === state.user.id ? d.conversation.user_b : d.conversation.user_a;
    const other = await api('/api/users/' + otherId).catch(() => null);
    $('#chatTitle').textContent = '💬 ' + (other?.user?.name || 'চ্যাট');
    const box = $('#chatBox');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = d.messages.length ? d.messages.map(m => `
      <div class="msg ${m.sender_id === state.user.id ? 'me' : 'them'}">${esc(m.body)}<small>${fmtDateTime(m.created_at)}</small></div>`).join('')
      : '<p class="muted center">এখনো কোনো মেসেজ নেই</p>';
    if (!silent || atBottom) box.scrollTop = box.scrollHeight;
  } catch (e) { if (!silent) toast(e.message); }
}
$('#chatForm').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const body = input.value.trim();
  if (!body || !state.chatId) return;
  input.value = '';
  try { await api(`/api/conversations/${state.chatId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }); loadChatMessages(); }
  catch (err) { toast(err.message); }
};
$('#chatBack').onclick = () => { clearInterval(state.chatTimer); state.chatId = null; showView('inbox'); };

// ---------------- Notifications ----------------
async function refreshNotifications() {
  if (!state.user) return;
  try {
    const d = await api('/api/notifications');
    const badge = $('#bellBadge');
    badge.textContent = d.unread;
    badge.classList.toggle('hidden', !d.unread);
  } catch { /* ignore */ }
}
$('#bellBtn').onclick = async () => {
  if (!state.user) { openAuth(); return; }
  openModal('notifDrawer');
  try {
    const d = await api('/api/notifications');
    $('#notifList').innerHTML = d.notifications.length ? d.notifications.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="openNotif(${n.id}, ${n.request_id || 'null'})">
        <b>${esc(n.title)}</b><br>${esc(n.body)}<br><small>${fmtDateTime(n.created_at)}</small>
      </div>`).join('') : '<p class="muted">কোনো নোটিফিকেশন নেই</p>';
  } catch (e) { $('#notifList').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
};
async function openNotif(id, requestId) {
  try { await api(`/api/notifications/${id}/read`, { method: 'POST' }); } catch { /* ignore */ }
  closeModal('notifDrawer'); refreshNotifications();
  if (requestId) { showView('home'); setTimeout(() => document.querySelector(`[data-req="${requestId}"]`)?.scrollIntoView({ behavior: 'smooth' }), 400); }
}
$('#markAllReadBtn').onclick = async () => { await api('/api/notifications/read-all', { method: 'POST' }); refreshNotifications(); $('#bellBtn').click(); };

// ---------------- Campaigns ----------------
async function loadCampaigns() {
  const box = $('#campaignList');
  try {
    const d = await api('/api/campaigns');
    box.innerHTML = d.campaigns.length ? d.campaigns.map(c => `
      <div class="card">
        <h3>🤝 ${esc(c.title)}</h3>
        <p style="white-space:pre-line">${esc(c.description)}</p>
        ${c.bkash ? `<p>📱 <b>bKash:</b> ${esc(c.bkash)}</p>` : ''}
        ${c.nagad ? `<p>📱 <b>Nagad:</b> ${esc(c.nagad)}</p>` : ''}
        ${c.bank ? `<p>🏦 <b>ব্যাংক:</b> ${esc(c.bank)}</p>` : ''}
        <small class="muted">${fmtDate(c.created_at)}</small>
      </div>`).join('') : '<p class="muted center">এখন কোনো ক্যাম্পেইন চলছে না</p>';
  } catch { box.innerHTML = '<p class="error center">লোড করা যায়নি</p>'; }
}

// ---------------- Directory (cached offline) ----------------
async function loadDirectory() {
  const box = $('#directoryList');
  const district = $('#dirDistrict').value, type = $('#dirType').value;
  let entries = [];
  try {
    const params = new URLSearchParams();
    if (district) params.set('district', district);
    if (type) params.set('type', type);
    const d = await api('/api/directory?' + params.toString());
    entries = d.entries;
    try { localStorage.setItem('rs_directory', JSON.stringify({ at: Date.now(), entries })); } catch { /* ignore */ }
  } catch {
    try { entries = JSON.parse(localStorage.getItem('rs_directory') || '{}').entries || []; } catch { entries = []; }
    if (district) entries = entries.filter(e => e.district === district);
    if (type) entries = entries.filter(e => e.type === type);
    if (entries.length) toast('অফলাইন — সংরক্ষিত তালিকা দেখানো হচ্ছে');
  }
  const icons = { blood_bank: '🩸 ব্লাড ব্যাংক', hospital: '🏥 হাসপাতাল', ambulance: '🚑 অ্যাম্বুলেন্স' };
  box.innerHTML = entries.length ? entries.map(e => `
    <div class="card"><b>${icons[e.type] || e.type} — ${esc(e.name)}</b><br>
    <span class="muted small">📍 ${esc(e.district)}${e.address ? ' · ' + esc(e.address) : ''}</span><br>
    <a class="btn green small" href="tel:${esc(e.phone)}" style="margin-top:6px">📞 ${esc(e.phone)}</a></div>`).join('')
    : '<p class="muted center">কোনো তথ্য পাওয়া যায়নি</p>';
}
$('#dirDistrict').onchange = loadDirectory;
$('#dirType').onchange = loadDirectory;

// ---------------- Moderator ----------------
async function openModeratorApply() {
  if (!state.user) { openAuth(); return; }
  if (state.user.role !== 'user') { showView('moderator'); return; }
  const existing = await api('/api/moderator/my-application').catch(() => ({ application: null }));
  if (existing.application) {
    const a = existing.application;
    const statusTxt = { pending: '⏳ পর্যালোচনাধীন', approved: '✅ অনুমোদিত', rejected: '❌ বাতিল' }[a.status] || a.status;
    openGeneric(`<h3>🛡️ মডারেটর আবেদন</h3><p>অবস্থা: <b>${statusTxt}</b></p><p>জেলা: ${esc(a.district)} · ডকুমেন্ট: ${a.doc_type === 'nid' ? 'NID' : 'জন্ম সনদ'}</p>${a.review_note ? `<p>মন্তব্য: ${esc(a.review_note)}</p>` : ''}${a.status === 'rejected' ? '<p class="muted">নতুন করে আবেদন করতে চাইলে নিচের ফর্মটি পূরণ করুন।</p>' : ''}`);
    if (a.status !== 'rejected') return;
  }
  openGeneric(`
    <h3>🛡️ মডারেটর হতে আবেদন</h3>
    <p class="muted small">মডারেটর হতে NID (সামনে+পেছনে) অথবা জন্ম সনদের ছবি দিতে হবে। ডকুমেন্ট শুধু সুপার অ্যাডমিন দেখতে পারবেন।</p>
    <form id="modApplyForm" class="form" enctype="multipart/form-data">
      <label>ডকুমেন্টের ধরন *
        <select name="doc_type" id="modDocType" required>
          <option value="nid">NID কার্ড</option>
          <option value="birth">জন্ম সনদ</option>
        </select>
      </label>
      <label id="modDocNumLabel">NID নম্বর *<input name="doc_number" required placeholder="১০/১৩/১৭ সংখ্যা"></label>
      <label id="modFrontLabel">NID সামনের ছবি *<input type="file" name="front" accept="image/*" required></label>
      <label id="modBackLabel">NID পেছনের ছবি *<input type="file" name="back" accept="image/*"></label>
      <label>দায়িত্বের জেলা *<select name="district" required>${DISTRICTS.map(d => `<option>${d}</option>`).join('')}</select></label>
      <label>উপজেলা/থানা<input name="upazila" placeholder="যেমন: সাভার"></label>
      <button class="btn primary full">আবেদন জমা দিন</button>
    </form>`);
  $('#modDocType').onchange = (e) => {
    const isBirth = e.target.value === 'birth';
    $('#modDocNumLabel').firstChild.textContent = isBirth ? 'জন্ম সনদ নম্বর (১৭ সংখ্যা) *' : 'NID নম্বর *';
    $('#modFrontLabel').firstChild.textContent = isBirth ? 'জন্ম সনদের ছবি *' : 'NID সামনের ছবি *';
    $('#modBackLabel').style.display = isBirth ? 'none' : 'block';
  };
  $('#modApplyForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await fetch('/api/moderator/apply', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token }, body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'সমস্যা হয়েছে');
      closeModal('genericModal'); toast('✅ আবেদন জমা হয়েছে — অ্যাডমিন পর্যালোচনা করবেন');
    } catch (err) { toast(err.message); }
  };
}

async function loadModerator() {
  const box = $('#moderatorBox');
  const u = state.user;
  if (!u || !['moderator', 'admin'].includes(u.role)) { box.innerHTML = '<p class="muted">মডারেটর প্যানেল শুধু মডারেটরদের জন্য</p>'; return; }
  box.innerHTML = `
    <div class="card">
      <h3>🛡️ ${esc(u.name)} ${u.role === 'moderator' ? `— ${esc(u.mod_district || '')} জেলার মডারেটর` : '— Super Admin'}</h3>
      <p class="muted">আপনি যা করতে পারবেন:</p>
      <ul>
        <li>হোম ফিড থেকে রক্তের আবেদন সম্পাদনা / মুছে ফেলা / ম্যানেজ করা</li>
        <li>আবেদনে 🚨 জরুরি নোটিফিকেশন পাঠানো (আপনার জেলার উপযুক্ত ডোনারদের)</li>
        <li>ডোনার খুঁজে ✓ Verified Donor ব্যাজ দেওয়া</li>
      </ul>
      <div class="btn-row">
        <button class="btn primary" data-nav="home">🩸 আবেদন দেখুন</button>
        <button class="btn green" data-nav="donors">🔍 ডোনার খুঁজুন</button>
      </div>
    </div>`;
}

// ---------------- Admin ----------------
$('#adminTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  state.adminTab = b.dataset.tab;
  $$('#adminTabs button').forEach(x => x.classList.toggle('active', x === b));
  loadAdmin();
});

async function loadAdmin() {
  const box = $('#adminContent');
  const tab = state.adminTab;
  box.innerHTML = '<p class="muted">লোড হচ্ছে…</p>';
  try {
    if (tab === 'stats') {
      const s = await api('/api/admin/stats');
      const perGroup = BLOOD_GROUPS.map(g => `<div class="stat"><b>${s.per_group[g] || 0}</b><span>${g}</span></div>`).join('');
      box.innerHTML = `
        <div class="admin-stats">
          <div class="stat"><b>${s.total_users}</b><span>মোট ব্যবহারকারী</span></div>
          <div class="stat"><b>${s.total_moderators}</b><span>মডারেটর</span></div>
          <div class="stat"><b>${s.total_requests}</b><span>মোট আবেদন</span></div>
          <div class="stat"><b>${s.open_requests}</b><span>খোলা আবেদন</span></div>
          <div class="stat"><b>${s.managed_requests}</b><span>ম্যানেজ হয়েছে</span></div>
          <div class="stat"><b>${s.total_donations}</b><span>মোট রক্তদান</span></div>
          <div class="stat"><b>${s.pending_applications}</b><span>অপেক্ষমাণ আবেদন</span></div>
          <div class="stat"><b>${s.open_reports}</b><span>খোলা রিপোর্ট</span></div>
        </div>
        <h3>ব্লাড গ্রুপ অনুযায়ী ডোনার</h3>
        <div class="admin-stats">${perGroup}</div>`;
    }
    if (tab === 'applications') {
      const d = await api('/api/admin/applications?status=all');
      box.innerHTML = d.applications.length ? d.applications.map(a => `
        <div class="card">
          <b>${esc(a.name)}</b> (${esc(a.phone)}, ${esc(a.blood_group)}) — ${a.doc_type === 'nid' ? 'NID' : 'জন্ম সনদ'}: ${esc(a.doc_number)}<br>
          <span class="muted small">জেলা: ${esc(a.district)}${a.upazila ? ', ' + esc(a.upazila) : ''} · ${fmtDateTime(a.created_at)} · অবস্থা: <b>${a.status}</b></span><br>
          <div class="btn-row">
            <button class="btn small" onclick="viewKyc(${a.id}, 'front')">🖼️ সামনের ছবি</button>
            ${a.back_path ? `<button class="btn small" onclick="viewKyc(${a.id}, 'back')">🖼️ পেছনের ছবি</button>` : ''}
            ${a.status === 'pending' ? `<button class="btn green small" onclick="reviewApp(${a.id}, true)">✅ অনুমোদন</button><button class="btn danger small" onclick="reviewApp(${a.id}, false)">❌ বাতিল</button>` : ''}
          </div>
          ${a.review_note ? `<p class="muted small">মন্তব্য: ${esc(a.review_note)}</p>` : ''}
        </div>`).join('') : '<p class="muted">কোনো আবেদন নেই</p>';
    }
    if (tab === 'users') {
      const d = await api('/api/admin/users');
      box.innerHTML = `<div class="card" style="overflow-x:auto"><table class="data"><tr><th>নাম</th><th>ফোন</th><th>গ্রুপ</th><th>জেলা</th><th>রোল</th><th>অ্যাকশন</th></tr>
        ${d.users.map(u => `<tr>
          <td>${esc(u.name)}${u.verified_donor ? ' ✓' : ''}${u.banned ? ' 🚫' : ''}</td>
          <td>${esc(u.phone)}</td><td>${esc(u.blood_group)}</td><td>${esc(u.district || '—')}</td>
          <td>${u.role}${u.mod_district ? ` (${esc(u.mod_district)})` : ''}</td>
          <td>
            <select onchange="setRole(${u.id}, this.value)" style="width:auto">
              <option value="">রোল বদলান</option>
              <option value="user">User</option><option value="moderator">Moderator</option><option value="admin">Admin</option>
            </select>
            <button class="btn ${u.banned ? 'green' : 'danger'} small" onclick="banUser(${u.id}, ${u.banned ? 'false' : 'true'})">${u.banned ? 'আনব্যান' : 'ব্যান'}</button>
          </td></tr>`).join('')}</table></div>`;
    }
    if (tab === 'reports') {
      const d = await api('/api/admin/reports');
      box.innerHTML = d.reports.length ? d.reports.map(r => `
        <div class="card"><b>${r.target_type === 'request' ? '🩸 আবেদন' : '👤 ব্যবহারকারী'} #${r.target_id}</b> — রিপোর্ট করেছেন ${esc(r.reporter_name)}<br>
        <p>${esc(r.reason)}</p><small class="muted">${fmtDateTime(r.created_at)} · ${r.status}</small>
        ${r.status === 'open' ? `<div class="btn-row"><button class="btn green small" onclick="resolveReport(${r.id})">✅ সমাধান হয়েছে</button></div>` : ''}</div>`).join('')
        : '<p class="muted">কোনো রিপোর্ট নেই</p>';
    }
    if (tab === 'banners') {
      const d = await api('/api/banners');
      box.innerHTML = `
        <form id="bannerForm" class="card form">
          <h3>নতুন ব্যানার</h3>
          <label>শিরোনাম *<input name="title" required></label>
          <label>উপশিরোনাম<input name="subtitle"></label>
          <label>লিংক (ঐচ্ছিক)<input name="link_url" placeholder="https://..."></label>
          <button class="btn primary">➕ ব্যানার যোগ করুন</button>
        </form>
        ${d.banners.map(b => `<div class="card"><b>${esc(b.title)}</b><br><span class="muted small">${esc(b.subtitle || '')}</span><div class="btn-row"><button class="btn danger small" onclick="deleteBanner(${b.id})">🗑️ মুছুন</button></div></div>`).join('')}`;
      $('#bannerForm').onsubmit = async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target).entries()); await api('/api/admin/banners', { method: 'POST', body: JSON.stringify(body) }); toast('ব্যানার যোগ হয়েছে'); loadAdmin(); };
    }
    if (tab === 'campaigns') {
      const d = await api('/api/campaigns');
      box.innerHTML = `
        <form id="campaignForm" class="card form">
          <h3>নতুন ক্যাম্পেইন</h3>
          <label>শিরোনাম *<input name="title" required></label>
          <label>বিবরণ *<textarea name="description" rows="3" required></textarea></label>
          <label>bKash নম্বর<input name="bkash" placeholder="01XXXXXXXXX"></label>
          <label>Nagad নম্বর<input name="nagad" placeholder="01XXXXXXXXX"></label>
          <label>ব্যাংক তথ্য<input name="bank" placeholder="অ্যাকাউন্ট নম্বর / শাখা"></label>
          <button class="btn primary">➕ ক্যাম্পেইন যোগ করুন</button>
        </form>
        ${d.campaigns.map(c => `<div class="card"><b>${esc(c.title)}</b><p>${esc(c.description)}</p><button class="btn danger small" onclick="deleteCampaign(${c.id})">🗑️ মুছুন</button></div>`).join('')}`;
      $('#campaignForm').onsubmit = async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target).entries()); await api('/api/admin/campaigns', { method: 'POST', body: JSON.stringify(body) }); toast('ক্যাম্পেইন যোগ হয়েছে'); loadAdmin(); };
    }
    if (tab === 'directory') {
      const d = await api('/api/directory');
      box.innerHTML = `
        <form id="dirForm" class="card form">
          <h3>ডিরেক্টরিতে যোগ করুন</h3>
          <label>জেলা *<select name="district" required>${DISTRICTS.map(x => `<option>${x}</option>`).join('')}</select></label>
          <label>ধরন *<select name="type" required><option value="blood_bank">🩸 ব্লাড ব্যাংক</option><option value="hospital">🏥 হাসপাতাল</option><option value="ambulance">🚑 অ্যাম্বুলেন্স</option></select></label>
          <label>নাম *<input name="name" required></label>
          <label>ফোন *<input name="phone" required></label>
          <label>ঠিকানা<input name="address"></label>
          <button class="btn primary">➕ যোগ করুন</button>
        </form>
        ${d.entries.map(e => `<div class="card"><b>${esc(e.name)}</b> — ${esc(e.district)} · ${esc(e.phone)}<button class="btn danger small" style="float:right" onclick="deleteDirectory(${e.id})">🗑️</button></div>`).join('')}`;
      $('#dirForm').onsubmit = async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target).entries()); await api('/api/admin/directory', { method: 'POST', body: JSON.stringify(body) }); toast('যোগ হয়েছে'); loadAdmin(); };
    }
    if (tab === 'settings') {
      const s = state.settings || await api('/api/settings');
      box.innerHTML = `
        <form id="settingsForm" class="card form">
          <h3>⚙️ সেটিংস</h3>
          <label>হেল্পলাইন ১<input name="helpline1" value="${esc(s.helpline1)}"></label>
          <label>হেল্পলাইন ২<input name="helpline2" value="${esc(s.helpline2)}"></label>
          <label>ফেসবুক গ্রুপ লিংক<input name="fb_group_url" value="${esc(s.fb_group_url)}"></label>
          <button class="btn primary">সংরক্ষণ করুন</button>
        </form>`;
      $('#settingsForm').onsubmit = async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target).entries()); await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }); toast('সেটিংস সংরক্ষিত'); await loadSettings(); };
    }
    if (tab === 'audit') {
      const d = await api('/api/admin/audit');
      box.innerHTML = `<div class="card">${d.audit.length ? d.audit.map(a => `<div class="notif-item"><b>${esc(a.action)}</b> — ${esc(a.detail || '')}<br><small class="muted">${esc(a.user_name || '—')} · ${fmtDateTime(a.created_at)}</small></div>`).join('') : '<p class="muted">কোনো লগ নেই</p>'}</div>`;
    }
  } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

async function viewKyc(appId, side) {
  openGeneric('<p class="muted">লোড হচ্ছে…</p>');
  try {
    const res = await fetch(`/api/admin/kyc/${appId}/${side}`, { headers: { Authorization: 'Bearer ' + state.token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'ছবি পাওয়া যায়নি');
    const blob = await res.blob();
    $('#genericModalContent').innerHTML = `<h3>KYC ডকুমেন্ট (${side === 'front' ? 'সামনে' : 'পেছনে'})</h3><img class="kyc-img" src="${URL.createObjectURL(blob)}" alt="KYC">`;
  } catch (e) { $('#genericModalContent').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
async function reviewApp(id, approve) {
  const note = approve ? '' : (prompt('বাতিলের কারণ (ঐচ্ছিক):') || '');
  try { await api(`/api/admin/applications/${id}/review`, { method: 'POST', body: JSON.stringify({ approve, note }) }); toast(approve ? '✅ মডারেটর অনুমোদিত' : 'আবেদন বাতিল করা হয়েছে'); loadAdmin(); }
  catch (e) { toast(e.message); }
}
async function setRole(id, role) {
  if (!role) return;
  let mod_district = null;
  if (role === 'moderator') { mod_district = prompt('কোন জেলার মডারেটর? (জেলার নাম লিখুন)'); if (!mod_district) return; }
  try { await api(`/api/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role, mod_district }) }); toast('রোল আপডেট হয়েছে'); loadAdmin(); }
  catch (e) { toast(e.message); }
}
async function banUser(id, banned) {
  if (!confirm(banned ? 'এই ব্যবহারকারীকে ব্যান করবেন?' : 'আনব্যান করবেন?')) return;
  try { await api(`/api/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned }) }); toast('আপডেট হয়েছে'); loadAdmin(); }
  catch (e) { toast(e.message); }
}
async function resolveReport(id) { try { await api(`/api/admin/reports/${id}/resolve`, { method: 'POST' }); loadAdmin(); } catch (e) { toast(e.message); } }
async function deleteBanner(id) { if (confirm('ব্যানার মুছবেন?')) { await api(`/api/admin/banners/${id}`, { method: 'DELETE' }); loadAdmin(); } }
async function deleteCampaign(id) { if (confirm('ক্যাম্পেইন মুছবেন?')) { await api(`/api/admin/campaigns/${id}`, { method: 'DELETE' }); loadAdmin(); } }
async function deleteDirectory(id) { if (confirm('এন্ট্রি মুছবেন?')) { await api(`/api/admin/directory/${id}`, { method: 'DELETE' }); loadAdmin(); } }

// ---------------- Init ----------------
$('#fabCall').onclick = () => $('#fabMenu').classList.toggle('hidden');
$('#profileBtn').onclick = () => showView('profile');
$('#homeGroupFilter').onchange = loadRequests;
$('#homeDistrictFilter').onchange = loadRequests;
$('#homeOpenOnly').onchange = loadRequests;

fillSelect($('#homeGroupFilter'), BLOOD_GROUPS, 'সব গ্রুপ');
fillSelect($('#homeDistrictFilter'), DISTRICTS, 'সব জেলা');
fillSelect($('#donorGroup'), BLOOD_GROUPS, 'সব গ্রুপ');
fillSelect($('#donorDistrict'), DISTRICTS, 'সব জেলা');
fillSelect($('#dirDistrict'), DISTRICTS, 'সব জেলা');
fillSelect($('#reqGroup'), BLOOD_GROUPS);
fillSelect($('#reqDistrict'), DISTRICTS);
fillSelect($('#regGroup'), BLOOD_GROUPS);
fillSelect($('#regDistrict'), DISTRICTS, 'বেছে নিন');

(async () => {
  await loadSettings();
  await loadMe();
  refreshNotifications();
  setInterval(refreshNotifications, 60000);
  loadHome();
})();
