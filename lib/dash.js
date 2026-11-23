// คำสั่งแดชบอร์ด OM / Supervisor: login / data / rate / importRoster
const crypto = require('crypto');
const S = require('./sheets');
const L = require('./logic');
const P = require('./people');
const { UserError } = L;

const SESSION_HOURS = 12;

function checkCode(code) {
  const want = String(process.env.DASHBOARD_CODE || '');
  const got = String(code || '').trim();
  if (want.length < 8) throw new UserError('ผู้ดูแลยังไม่ได้ตั้งรหัสแดชบอร์ด (DASHBOARD_CODE)');
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new UserError('รหัสเข้าแดชบอร์ดไม่ถูกต้อง');
}
function checkToken(token) {
  let s;
  try { s = L.unseal(token); } catch (e) { s = null; }
  if (!s || s.kind !== 'dash' || Date.now() > s.exp) throw new UserError('หมดเวลาเข้าใช้งาน กรุณาใส่รหัสอีกครั้ง');
}

async function ensureTabs() {
  const tabs = await S.tabs();
  const has = t => tabs.some(x => x.title === t);
  const add = [];
  if (!has(P.PTAB.ROSTER)) add.push([P.PTAB.ROSTER, P.ROSTER_HEADERS]);
  if (!has(P.PTAB.RATING)) add.push([P.PTAB.RATING, P.RATING_HEADERS]);
  for (const [title, headers] of add) {
    await S.batchUpdate([{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }]);
    await S.write(S.q(title) + '!A1', [headers]);
  }
  return add.length ? (await S.tabs()) : tabs;
}

async function login(code) {
  checkCode(code);
  return { token: L.seal({ kind: 'dash', exp: Date.now() + SESSION_HOURS * 3600e3 }) };
}

async function data(token, branch) {
  checkToken(token);
  const tabs = await ensureTabs();
  const titles = tabs.map(t => t.title);
  const ranges = [S.q(P.PTAB.ROSTER) + '!A:K', S.q(P.PTAB.RATING) + '!A:N', S.q(L.TAB.SUMMARY) + '!A:N'];
  const ok = ranges.map(r => titles.includes(r.slice(1, r.indexOf("'!")).replace(/''/g, "'")));
  const got = await S.read(ranges.filter((_, i) => ok[i]));
  let k = 0;
  const [roster, ratings, summary] = ranges.map((_, i) => (ok[i] ? got[k++] : []));
  return P.build(roster, ratings, summary, L.bkkNow(), L.str(branch).slice(0, 60));
}

const clean = (v, max) => {
  let s = L.str(v).replace(/[\r\n\t]+/g, ' ').slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
};

async function rate(token, r) {
  checkToken(token);
  r = r || {};
  const id = clean(r.empId, 30).toUpperCase();
  const rater = clean(r.rater, 60);
  if (!id) throw new UserError('กรุณาเลือกพนักงาน');
  if (!rater) throw new UserError('กรุณาใส่ชื่อผู้ประเมิน');
  const scores = P.COMP.map(c => {
    const n = Number((r.scores || {})[c.key]);
    if (!(n >= 1 && n <= 4) || Math.round(n) !== n) throw new UserError('กรุณาให้คะแนน 1–4 ให้ครบทุกด้าน (' + c.label + ')');
    return n;
  });
  await ensureTabs();
  const [roster] = await S.read([S.q(P.PTAB.ROSTER) + '!A:B']);
  const who = (roster || []).slice(1).find(x => P.idKey(x[0]) === P.idKey(id));
  if (!who) throw new UserError('ไม่พบรหัสพนักงานนี้ในทะเบียนพนักงาน');
  const growth = ['อยากเติบโต', 'ยังไม่แน่ใจ', 'ไม่ต้องการตอนนี้'].includes(r.growth) ? r.growth : 'ยังไม่แน่ใจ';
  const risk = ['ต่ำ', 'กลาง', 'สูง'].includes(r.risk) ? r.risk : 'ต่ำ';
  await S.append(P.PTAB.RATING, [L.stamp(L.bkkNow()), L.str(who[0]), L.str(who[1]), rater]
    .concat(scores, [growth, risk, clean(r.strengths, 300), clean(r.plan, 400)]));
  return { saved: true };
}

// นำเข้ารายชื่อ: เพิ่มเฉพาะรหัสที่ยังไม่มีในทะเบียน (ไม่ทับของเดิม)
async function importRoster(token, rows) {
  checkToken(token);
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new UserError('ข้อมูลรายชื่อไม่ถูกต้อง');
  await ensureTabs();
  const [cur] = await S.read([S.q(P.PTAB.ROSTER) + '!A:A']);
  const have = new Set((cur || []).slice(1).map(x => P.idKey(x[0])));
  const add = rows.map(r => P.ROSTER_HEADERS.map((_, i) => clean((r || [])[i], 120)))
    .filter(r => r[0] && r[1] && !have.has(P.idKey(r[0])));
  if (add.length) {
    const start = (cur || []).length + 1;
    await S.write(S.q(P.PTAB.ROSTER) + '!A' + start, add);
  }
  return { added: add.length, skipped: rows.length - add.length };
}

module.exports = { login, data, rate, importRoster };
