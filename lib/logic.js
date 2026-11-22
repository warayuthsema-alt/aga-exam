// ตรรกะของระบบแบบทดสอบ (ไม่แตะ Google Sheet โดยตรง) – Advance Group Asia
const crypto = require('crypto');

const TAB = {
  SUMMARY: 'สรุปผลสอบรวม',
  TEMPLATE: 'แม่แบบ_แท็บสาขา',
  BANK: 'คลังข้อสอบ_100ข้อ',
  PLAN: 'แผนอบรมรายสัปดาห์',
  BRANCHES: 'รายชื่อสาขา',
  WEEKLY: 'สรุปรายสัปดาห์'
};

const EXAM_SIZE = 10;
const PASS_RATIO = 0.8;
const TIME_LIMIT_MIN = 15;
const STD_MIN_IMAGES = 3;
const RETEST_GRACE_DAYS = 3;
const CLOSE_HOUR = 17;
const TZ_OFFSET_H = 7; // Asia/Bangkok
const LETTERS = ['ก', 'ข', 'ค', 'ง'];
const DAY = 864e5;

const MODE = { WEEKLY: 'รายสัปดาห์', RETEST: 'สอบซ่อม', PRE: 'Pre-test', POST: 'Post-test', STANDARD: 'มาตรฐาน' };

const RESULT_HEADERS = [
  'วันเวลาที่ส่ง', 'รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'สาขา',
  'คะแนนที่ได้', 'คะแนนเต็ม', 'เปอร์เซ็นต์ (%)', 'ผลการประเมิน (ผ่าน 80%)',
  'ชุดข้อสอบที่สุ่มได้', 'ด้านที่ควรพัฒนาเพิ่มเติม (จุดอ่อน)',
  'โหมดสอบ', 'สัปดาห์ที่', 'สลับหน้าจอ (ครั้ง)'
];

const DOMAIN_ADVICE = {
  'พื้นฐานและสัตว์รบกวน': 'ทบทวนการจำแนกกลุ่มแมลงบิน แมลงคลาน และสัตว์รบกวนในมาตรฐานบริการ STD',
  'การจัดการหนู': 'ทบทวนระยะวางสถานีเหยื่อพิษ/กระดานกาว SOP กล่องหนู และการฝังกลบซากหนู',
  'การจัดการจิ้งจกและงู': 'ทบทวน SOP การติดตั้งกล่องดักจิ้งจก ความสูงมาตรฐาน และผลิตภัณฑ์ไล่งู',
  'การจัดการแมลงสาบ': 'ทบทวนชนิดแมลงสาบ SOP บ้านแมลงสาบ Hoy Hoy การหยอดเจล 3 มม. และตารางพื้นที่บริการ',
  'การจัดการมด': 'ทบทวนชนิดมด วงจรชีวิตมด เทคนิคการวางเจล และตารางพื้นที่บริการ',
  'การจัดการปลวก': 'ทบทวนจุดสำรวจปลวกภายใน/ภายนอก อุปกรณ์ลูกบีบ และตารางรูปแบบการกำจัดปลวก',
  'การจัดการแมลงวันและยุง': 'ทบทวนแหล่งเพาะพันธุ์แมลงวัน/ยุง วงจรชีวิต และข้อห้ามการพ่นฝอยละเอียด',
  'เครื่องดักแมลง': 'ทบทวนความสูงและทิศทางแสงเครื่องดักแมลง 1.5–2.0 ม. SOP เช็คลิสต์ และ Mosclean',
  'สารเคมีและอัตราส่วนผสม': 'ทบทวนสูตรผสม (EC/SC/WP/WG/GB) ชื่อสารออกฤทธิ์ และอัตราส่วนผสมของสารเคมีหลัก',
  'SOP อุปกรณ์และ Layout': 'ทบทวน SOP ถังสเปรย์ เครื่องพ่นหมอกควัน เครื่องพ่นละอองฝอย และหลักการทำ Layout',
  'สัญญาและงานบริการ AGA': 'ทบทวนประเภทสัญญา ความถี่บริการ (Service Frequency) และขั้นตอน Pipe & Soil / Post-Construction',
  'ระบบเหยื่อปลวกและผลิตภัณฑ์': 'ทบทวนระบบเหยื่อ Nemesis (IG/AG) อุปกรณ์ตรวจภายใน และสเปก/ราคาเครื่องไฟดักแมลง'
};

/* ---------- เวลา: ใช้ "เวลานาฬิกาไทย" เก็บในฟิลด์ UTC ของ Date ---------- */
const bkkNow = (ms = Date.now()) => new Date(ms + TZ_OFFSET_H * 3600e3);

/** ค่าจากชีต (serial number / ข้อความ dd/mm/yyyy) → Date (เวลานาฬิกาไทยในฟิลด์ UTC) */
function sheetDate(v) {
  if (typeof v === 'number' && isFinite(v)) return new Date(Math.round((v - 25569) * DAY));
  if (typeof v === 'string' && v.trim()) {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) { let y = +m[3]; if (y > 2400) y -= 543; return new Date(Date.UTC(y, +m[2] - 1, +m[1])); }
    const iso = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0)));
  }
  return null;
}
const dayStart = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const fmtDate = d => d.getUTCDate() + ' ' + TH_M[d.getUTCMonth()] + ' ' + (d.getUTCFullYear() + 543);
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/* ---------- แปลงข้อมูลจากชีต ---------- */
const str = v => String(v === undefined || v === null ? '' : v).trim();
const splitList = v => str(v).split(/[,،]/).map(s => s.trim()).filter(Boolean);

function ansIndex(raw, choices) {
  const s = str(raw);
  if (!s) return -1;
  const head = s.charAt(0);
  let i = LETTERS.indexOf(head);
  if (i >= 0) return i;
  i = 'ABCD'.indexOf(head.toUpperCase());
  if (i >= 0 && (s.length === 1 || /^[A-Da-d][.)\s]/.test(s))) return i;
  if (/^[1-4]$/.test(s)) return Number(s) - 1;
  return choices.indexOf(s.replace(/^[กขคงA-Da-d1-4][.)\s]+/, '').trim());
}

function parseBank(rows) {
  return (rows || []).slice(1).filter(r => str(r[3]) && str(r[0])).map(r => {
    const choices = [r[4], r[5], r[6], r[7]].map(str);
    const img = str(r[12]);
    return {
      id: str(r[0]), cat: str(r[1]), q: str(r[3]), choices,
      ans: ansIndex(r[8], choices), exp: str(r[9]), pest: str(r[10]),
      hasImage: /^(y|yes|มี|true|1)$/i.test(str(r[11])) || !!img,
      img: /^https:\/\//i.test(img) ? img : ''
    };
  });
}

function parsePlan(rows) {
  return (rows || []).slice(1).map(r => {
    const s = sheetDate(r[1]), e = sheetDate(r[2]);
    if (str(r[0]) === '' || !s || !e) return null;
    const start = dayStart(s), end = dayStart(e);
    const close = new Date(end.getTime() + CLOSE_HOUR * 3600e3);
    const pest = str(r[3]);
    const num = (v, d) => (str(v) === '' ? d : Number(v));
    return {
      week: Number(r[0]), start, end, close, graceClose: new Date(close.getTime() + RETEST_GRACE_DAYS * DAY),
      pest, isPost: /post/i.test(pest), mainCats: splitList(r[4]), extraCats: splitList(r[5]),
      nMain: num(r[6], 6), nExtra: num(r[7], 2), nReview: num(r[8], 2), minImage: num(r[9], 1),
      open: str(r[10]) !== 'ปิด', material: /^https:\/\//i.test(str(r[11])) ? str(r[11]) : ''
    };
  }).filter(Boolean).sort((a, b) => a.week - b.week);
}

function parseAttempts(rows, empId) {
  return (rows || []).slice(1).filter(r => str(r[1]).toUpperCase() === empId).map(r => {
    const d = sheetDate(r[0]);
    return {
      day: d ? fmtDate(d) : '', score: r[5], total: r[6], pass: str(r[8]) === 'ผ่าน',
      ids: str(r[9]), mode: str(r[11]), week: str(r[12]) === '' ? '' : Number(r[12])
    };
  });
}

/* ---------- ตัวเลือกการสอบ ---------- */
const opt = (mode, week, label, sub, available, status) => ({ mode, week, label, sub, available: !!available, status: status || '' });

function buildOptions(plan, attempts, now) {
  const out = [];
  plan.forEach(p => {
    if (!p.open) return;
    const inWeek = now >= p.start && now <= p.close;
    const inGrace = now > p.close && now <= p.graceClose;
    if (!inWeek && !inGrace) return;
    if (p.isPost) {
      if (!inWeek) return;
      const done = attempts.some(a => a.mode === MODE.POST);
      out.push(opt(MODE.POST, p.week, 'Post-test ประมวลผล (สัปดาห์ ' + p.week + ')', 'ข้อสอบรวมทั้ง 12 หมวด', !done, done ? 'ทำแล้ว' : ''));
      return;
    }
    const mine = attempts.filter(a => String(a.week) === String(p.week));
    const first = mine.find(a => a.mode === MODE.WEEKLY);
    const retest = mine.find(a => a.mode === MODE.RETEST);
    const label = 'สอบประจำสัปดาห์ ' + p.week + ' · ' + p.pest;
    if (!first) {
      out.push(opt(MODE.WEEKLY, p.week, label, inWeek ? 'ปิดรับ ' + fmtDate(p.end) + ' 17:00 น.' : 'เลยกำหนดส่งแล้ว', inWeek, inWeek ? '' : 'หมดเวลา'));
    } else if (first.pass) {
      out.push(opt(MODE.WEEKLY, p.week, label, 'ผ่านแล้ว ' + first.score + '/' + first.total, false, 'ผ่านแล้ว'));
    } else if (!retest) {
      out.push(opt(MODE.RETEST, p.week, 'สอบซ่อม สัปดาห์ ' + p.week + ' · ' + p.pest, 'ข้อสอบชุดใหม่ · ปิดรับ ' + fmtDate(p.graceClose) + ' 17:00 น.', true));
    } else {
      out.push(opt(MODE.RETEST, p.week, 'สอบซ่อม สัปดาห์ ' + p.week + ' · ' + p.pest, retest.pass ? 'ผ่านแล้ว' : 'ใช้สิทธิ์ครบแล้ว – พบหัวหน้าสาขาเพื่อทบทวน', false, 'ครบสิทธิ์'));
    }
    if (p.week === 1 && inWeek) {
      const pre = attempts.some(a => a.mode === MODE.PRE);
      out.push(opt(MODE.PRE, 1, 'Pre-test (วัดผลก่อนอบรม)', 'ข้อสอบรวมทั้ง 12 หมวด · ทำได้ 1 ครั้ง', !pre, pre ? 'ทำแล้ว' : ''));
    }
  });
  if (!out.some(o => o.mode !== MODE.STANDARD)) {
    const today = fmtDate(now);
    const done = attempts.some(a => a.mode === MODE.STANDARD && a.day === today);
    out.push(opt(MODE.STANDARD, '', 'แบบทดสอบมาตรฐานงานบริการ', 'สุ่ม 10 ข้อจากทุกหมวด · วันละ 1 ครั้ง', !done, done ? 'วันนี้ทำแล้ว' : ''));
  }
  return out;
}

/* ---------- สุ่มข้อสอบ ---------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function take(pool, n, used) {
  const out = [];
  for (const q of shuffle(pool.filter(q => !used[q.id]))) {
    if (out.length >= n) break;
    if (!used[q.id]) { used[q.id] = true; out.push(q); }
  }
  return out;
}
function ensureImages(set, pool, min, used) {
  let have = set.filter(q => q.hasImage).length;
  if (have >= min) return;
  const spare = shuffle(pool.filter(q => q.hasImage && !used[q.id]));
  for (let i = set.length - 1; i >= 0 && have < min && spare.length; i--) {
    if (!set[i].hasImage) { const n = spare.pop(); delete used[set[i].id]; used[n.id] = true; set[i] = n; have++; }
  }
}
function pickWeekly(bank, plan, p) {
  const used = {};
  const isPest = q => q.pest === p.pest;
  let main = bank.filter(isPest);
  if (main.length < p.nMain) main = main.concat(bank.filter(q => !isPest(q) && p.mainCats.includes(q.cat)));
  const extraPool = bank.filter(q => p.extraCats.includes(q.cat) && !isPest(q));
  const prev = plan.filter(x => x.week < p.week && !x.isPost);
  const prevPests = prev.map(x => x.pest);
  let reviewPool = bank.filter(q => prevPests.includes(q.pest));
  if (!reviewPool.length) { const cats = prev.flatMap(x => x.mainCats); reviewPool = bank.filter(q => cats.includes(q.cat)); }
  const nReview = reviewPool.length ? p.nReview : 0;
  const nExtra = p.nExtra + (p.nReview - nReview);
  let set = take(main, p.nMain, used).concat(take(extraPool, nExtra, used), take(reviewPool, nReview, used));
  if (set.length < EXAM_SIZE) set = set.concat(take(main.concat(extraPool), EXAM_SIZE - set.length, used));
  if (set.length < EXAM_SIZE) set = set.concat(take(bank, EXAM_SIZE - set.length, used));
  ensureImages(set, main, p.minImage, used);
  return shuffle(set.slice(0, EXAM_SIZE));
}
function pickStandard(bank) {
  const used = {};
  const set = take(bank, EXAM_SIZE, used);
  ensureImages(set, bank, STD_MIN_IMAGES, used);
  return shuffle(set);
}

/* ---------- ตรวจคะแนน ---------- */
function grade(qs, answers) {
  const byCat = {}, review = [];
  let score = 0;
  qs.forEach(q => {
    const a = answers ? answers[q.id] : undefined;
    const chosen = a === undefined || a === null || a === '' ? -1 : Number(a);
    const ok = q.ans >= 0 && chosen === q.ans;
    if (ok) score++;
    byCat[q.cat] = byCat[q.cat] || { correct: 0, total: 0 };
    byCat[q.cat].total++;
    if (ok) byCat[q.cat].correct++;
    else review.push({
      q: q.q,
      your: chosen >= 0 && chosen < 4 ? LETTERS[chosen] + '. ' + q.choices[chosen] : 'ไม่ได้ตอบ',
      correct: q.ans >= 0 ? LETTERS[q.ans] + '. ' + q.choices[q.ans] : '-',
      explain: q.exp
    });
  });
  const total = qs.length;
  const weak = Object.keys(byCat).filter(c => byCat[c].correct < byCat[c].total).map(c => ({
    cat: c, correct: byCat[c].correct, total: byCat[c].total,
    acc: Math.round(byCat[c].correct / byCat[c].total * 100),
    advice: DOMAIN_ADVICE[c] || 'ทบทวนเอกสารอบรมหมวดนี้'
  })).sort((a, b) => a.acc - b.acc);
  return { score, total, percent: Math.round(score / total * 100), pass: score / total >= PASS_RATIO, weak, review };
}

/* ---------- ผู้สอบ ---------- */
function safeText(v, max) {
  let s = str(v).replace(/[\r\n\t]+/g, ' ').slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function cleanEmp(emp) {
  emp = emp || {};
  const out = {
    empId: safeText(emp.empId, 30).toUpperCase(),
    firstName: safeText(emp.firstName, 60),
    lastName: safeText(emp.lastName, 60),
    branch: safeText(emp.branch, 60)
  };
  if (!out.empId || !out.firstName || !out.lastName || !out.branch) throw new UserError('กรุณากรอกรหัสพนักงาน ชื่อ นามสกุล และสาขาให้ครบ');
  return out;
}

/* ---------- token รอบสอบ (เข้ารหัส AES-256-GCM เฉลยไม่ออกไปถึงเบราว์เซอร์) ---------- */
function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('ยังไม่ได้ตั้งค่า SESSION_SECRET');
  return crypto.createHash('sha256').update(s).digest();
}
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
function unseal(token) {
  try {
    const b = Buffer.from(String(token || ''), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch (e) {
    throw new UserError('รอบสอบนี้ไม่ถูกต้องหรือหมดอายุ กรุณาเริ่มใหม่');
  }
}

class UserError extends Error {}

module.exports = {
  TAB, MODE, EXAM_SIZE, TIME_LIMIT_MIN, RESULT_HEADERS, DOMAIN_ADVICE, UserError,
  bkkNow, sheetDate, fmtDate, stamp, parseBank, parsePlan, parseAttempts, ansIndex,
  buildOptions, pickWeekly, pickStandard, grade, cleanEmp, seal, unseal, str
};
