// ตรรกะแดชบอร์ดพัฒนาบุคลากร (OM / Supervisor) – ไม่แตะ Google Sheet โดยตรง
const L = require('./logic');
const { str } = L;

const PTAB = { ROSTER: 'ทะเบียนพนักงาน', RATING: 'ประเมินสมรรถนะ' };

const ROSTER_HEADERS = ['รหัสพนักงาน', 'ชื่อ-สกุล', 'ตำแหน่ง', 'วันเริ่มงาน', 'ทีม', 'Lv.', 'สาขา', 'สถานะ', 'วันที่ลาออก', 'สาเหตุที่ลาออก', 'หมายเหตุ'];

const COMP = [
  { key: 'tech', label: 'ความรู้เทคนิคและสารเคมี', advice: 'จับคู่ทำงานกับหัวหน้าทีม ทบทวนการจำแนกแมลงและอัตราส่วนผสมสาร แล้วให้อธิบายย้อนกลับหน้างาน' },
  { key: 'quality', label: 'คุณภาพงานและรายงาน', advice: 'ตรวจรายงานร่วมกับ Sup ทุกสัปดาห์ ชี้จุดที่ขาด และให้แก้ด้วยตัวเองก่อนส่ง' },
  { key: 'safety', label: 'ความปลอดภัยและ SOP', advice: 'ทบทวน SOP อุปกรณ์และ PPE สุ่มตรวจหน้างาน 2 ครั้ง/เดือน' },
  { key: 'comm', label: 'การสื่อสารและดูแลลูกค้า', advice: 'ฝึกสรุปผลบริการให้ลูกค้าฟัง 3 ประโยค ให้ไปกับ Sup เมื่อมีคอมเพลน' },
  { key: 'lead', label: 'ภาวะผู้นำและการสอนงาน', advice: 'มอบหมายให้เป็นพี่เลี้ยงคนใหม่ 1 คน หรือคุมทีมแทนเมื่อหัวหน้าทีมลา' },
  { key: 'discipline', label: 'วินัยและความรับผิดชอบ', advice: 'ตั้งเป้าตรงเวลาและงานไม่ตกหล่นรายสัปดาห์ คุยติดตามทุก 2 สัปดาห์' }
];
const RATING_HEADERS = ['วันที่ประเมิน', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'ผู้ประเมิน']
  .concat(COMP.map(c => c.label), ['ความต้องการเติบโต', 'ความเสี่ยงลาออก (ความเห็น Sup)', 'จุดแข็ง', 'สิ่งที่ต้องพัฒนา / แผน']);

const STAGES = ['', 'ทีมบริการ', 'หัวหน้าทีม', 'Senior Service', 'Supervisor'];
// เกณฑ์ "ขึ้นสู่ขั้น" n (ตรงกับเอกสารแผนพัฒนาบุคลากร 2570)
const CRITERIA = {
  2: { months: 12, lv: 1, exam: 80, examN: 4, comp: 3.0, mins: { safety: 3, lead: 2.5 } },
  3: { months: 36, lv: 1, exam: 85, examN: 6, comp: 3.2, mins: { lead: 3, tech: 3 } },
  4: { months: 60, lv: 0, exam: 90, examN: 6, comp: 3.5, mins: { lead: 3.5, comm: 3.5 } }
};
const LV_TARGET = 0.9;
const EXAM_WINDOW_DAYS = 183;
const DAY = 864e5;

/* ---------- แปลงข้อมูล ---------- */
const idKey = v => { const s = str(v).toUpperCase().replace(/\s+/g, ''); const d = s.replace(/\D/g, ''); return d ? d.replace(/^0+/, '') || '0' : s; };
const stageOf = pos => (/supervisor|หัวหน้างาน/i.test(pos) ? 4 : /senior/i.test(pos) ? 3 : /leader|หัวหน้าทีม/i.test(pos) ? 2 : 1);
const lvNum = v => { const n = Number(str(v)); return isFinite(n) && str(v) !== '' ? n : 0; };
const monthsBetween = (a, b) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
const tenureText = m => (m >= 12 ? Math.floor(m / 12) + ' ปี ' + (m % 12 ? (m % 12) + ' ด.' : '') : m + ' ด.').trim();
const round1 = n => Math.round(n * 10) / 10;

function parseRoster(rows) {
  return (rows || []).slice(1).filter(r => str(r[0]) && str(r[1])).map(r => {
    const start = L.sheetDate(r[3]);
    return {
      id: str(r[0]).toUpperCase(), key: idKey(r[0]), name: str(r[1]).replace(/\s+/g, ' '), position: str(r[2]),
      start, team: str(r[4]), lvRaw: str(r[5]) || 'S', lv: lvNum(r[5]), branch: str(r[6]),
      active: !/ลาออก|พ้นสภาพ|inactive/i.test(str(r[7])), leftOn: L.sheetDate(r[8]), leftReason: str(r[9]), note: str(r[10])
    };
  });
}

function parseRatings(rows) {
  return (rows || []).slice(1).filter(r => str(r[1])).map(r => {
    const scores = {};
    COMP.forEach((c, i) => { const n = Number(r[4 + i]); if (n >= 1 && n <= 4) scores[c.key] = n; });
    const vals = Object.values(scores);
    return {
      date: L.sheetDate(r[0]), key: idKey(r[1]), rater: str(r[3]), scores,
      avg: vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
      growth: str(r[10]), risk: str(r[11]), strengths: str(r[12]), plan: str(r[13])
    };
  }).filter(x => x.date).sort((a, b) => a.date - b.date);
}

function parseExams(rows) {
  return (rows || []).slice(1).filter(r => str(r[1])).map(r => ({
    date: L.sheetDate(r[0]), key: idKey(r[1]), pct: Number(r[7]), pass: str(r[8]) === 'ผ่าน',
    weak: str(r[10]), mode: str(r[11]), week: str(r[12])
  })).filter(x => x.date && isFinite(x.pct));
}

function weakTally(list) {
  const t = {};
  list.forEach(e => e.weak.split('|').forEach(part => {
    const m = part.trim().match(/^(.+?)\s*\((\d+)\/(\d+)\)$/);
    if (!m) return;
    const c = m[1].trim();
    t[c] = t[c] || { cat: c, wrong: 0 };
    t[c].wrong += Number(m[3]) - Number(m[2]);
  }));
  return Object.values(t).filter(x => x.wrong > 0).sort((a, b) => b.wrong - a.wrong);
}

/* ---------- รายบุคคล ---------- */
function examStats(list, now) {
  const recent = list.filter(e => now - e.date <= EXAM_WINDOW_DAYS * DAY);
  const avg = recent.length ? Math.round(recent.reduce((s, e) => s + e.pct, 0) / recent.length) : null;
  const pre = list.filter(e => e.mode === L.MODE.PRE).slice(-1)[0];
  const post = list.filter(e => e.mode === L.MODE.POST).slice(-1)[0];
  const last = list.slice(-1)[0];
  return {
    count: recent.length, avg, passRate: recent.length ? Math.round(recent.filter(e => e.pass).length / recent.length * 100) : null,
    last: last ? { date: L.fmtDate(last.date), pct: last.pct, pass: last.pass, mode: last.mode } : null,
    in30: list.some(e => now - e.date <= 30 * DAY),
    pre: pre ? pre.pct : null, post: post ? post.pct : null,
    weak: weakTally(recent).slice(0, 3).map(w => ({ cat: w.cat, wrong: w.wrong, advice: L.DOMAIN_ADVICE[w.cat] || 'ทบทวนเอกสารอบรมหมวดนี้' })),
    trend: list.slice(-8).map(e => e.pct)
  };
}

function criteriaFor(target, p, ex, rt) {
  const c = CRITERIA[target];
  if (!c) return [];
  const out = [];
  out.push({ label: 'อายุงาน ' + (c.months / 12) + ' ปีขึ้นไป', ok: p.months >= c.months, now: tenureText(p.months) });
  if (c.lv) out.push({ label: 'Lv.' + c.lv + ' ขึ้นไป', ok: p.lv >= c.lv, now: 'Lv.' + p.lvRaw });
  out.push({ label: 'สอบเฉลี่ย ' + c.exam + '%+ (อย่างน้อย ' + c.examN + ' ครั้งใน 6 เดือน)',
    ok: ex.count >= c.examN ? ex.avg >= c.exam : (ex.count ? false : null),
    now: ex.count ? ex.avg + '% จาก ' + ex.count + ' ครั้ง' : 'ยังไม่มีผลสอบ' });
  out.push({ label: 'สมรรถนะเฉลี่ย ' + c.comp.toFixed(1) + '+', ok: rt ? rt.avg >= c.comp : null, now: rt ? String(rt.avg) : 'ยังไม่ได้ประเมิน' });
  Object.keys(c.mins).forEach(k => {
    const comp = COMP.find(x => x.key === k);
    const v = rt ? rt.scores[k] : undefined;
    out.push({ label: comp.label + ' ' + c.mins[k] + '+', ok: v === undefined ? null : v >= c.mins[k], now: v === undefined ? 'ยังไม่ได้ประเมิน' : String(v) });
  });
  return out;
}

function riskOf(p, ex, rt) {
  const why = [];
  let s = 0;
  if (p.months < 6) { s += 2; why.push('อายุงานยังไม่ถึง 6 เดือน'); } else if (p.months < 24) { s += 1; why.push('อายุงานไม่ถึง 2 ปี'); }
  if (ex.count && ex.avg < 70) { s += 1; why.push('ผลสอบเฉลี่ยต่ำกว่า 70%'); }
  if (rt && rt.avg !== null && rt.avg < 2.5) { s += 1; why.push('สมรรถนะเฉลี่ยต่ำกว่า 2.5'); }
  if (!p.team) { s += 1; why.push('ยังไม่มีทีมประจำ'); }
  if (p.months >= 24 && p.lv < 1) { s += 1; why.push('ทำงานเกิน 2 ปีแต่ยังเป็น Lv.S'); }
  if (p.months >= 36 && p.stage === 1) { s += 1; why.push('ทำงานเกิน 3 ปียังเป็นทีมบริการ'); }
  if (rt && /สูง/.test(rt.risk)) { s += 2; why.push('Sup ประเมินว่าเสี่ยงสูง'); } else if (rt && /กลาง/.test(rt.risk)) { s += 1; why.push('Sup ประเมินว่าเสี่ยงกลาง'); }
  return { score: s, level: s >= 3 ? 'สูง' : s === 2 ? 'กลาง' : 'ต่ำ', why };
}

function person(p, exams, ratings, now) {
  p.months = p.start ? Math.max(0, monthsBetween(p.start, now)) : 0;
  p.stage = stageOf(p.position);
  const ex = examStats(exams, now);
  const rt = ratings.slice(-1)[0] || null;
  const prev = ratings.length > 1 ? ratings[ratings.length - 2] : null;
  const target = p.stage + 1;
  const crit = criteriaFor(target, p, ex, rt);
  const met = crit.filter(c => c.ok).length;
  const readiness = crit.length ? Math.round(met / crit.length * 100) : null;
  const missingData = crit.some(c => c.ok === null);
  let status;
  if (!crit.length) status = 'ขั้นสูงสุดของเส้นทาง';
  else if (met === crit.length) status = 'พร้อมเลื่อนขั้น';
  else if (readiness >= 70) status = 'ใกล้พร้อม';
  else status = 'กำลังพัฒนา';
  const risk = riskOf(p, ex, rt);

  const needs = [];
  crit.filter(c => c.ok === false).forEach(c => needs.push({ kind: 'เกณฑ์', text: 'ยังไม่ผ่าน: ' + c.label + ' (ตอนนี้ ' + c.now + ')' }));
  if (rt) COMP.filter(c => rt.scores[c.key] !== undefined && rt.scores[c.key] < 3)
    .forEach(c => needs.push({ kind: 'สมรรถนะ', text: c.label + ' ได้ ' + rt.scores[c.key] + ' — ' + c.advice }));
  ex.weak.forEach(w => needs.push({ kind: 'ความรู้', text: w.cat + ' (ตอบผิด ' + w.wrong + ' ข้อ) — ' + w.advice }));
  if (!rt) needs.push({ kind: 'ติดตาม', text: 'ยังไม่ได้ประเมินสมรรถนะ — Sup ประเมินภายในเดือนนี้' });
  if (!ex.in30) needs.push({ kind: 'ติดตาม', text: 'ไม่ได้ทำแบบทดสอบใน 30 วันที่ผ่านมา' });
  if (p.lv < 1 && p.months >= 12) needs.push({ kind: 'เลเวล', text: 'ทำงานครบ 1 ปีแล้วยังเป็น Lv.S — นัดประเมินขึ้น Lv.1' });
  if (!p.team || /สำรอง/.test(p.team)) needs.push({ kind: 'ทีม', text: p.team ? 'อยู่ทีมสำรอง — พิจารณาลงทีมประจำหรือให้คุมงานคนใหม่' : 'ยังไม่มีทีมประจำ — จัดลงทีมและกำหนดพี่เลี้ยง' });
  if (rt && rt.plan) needs.push({ kind: 'แผนจาก Sup', text: rt.plan });

  const canGrow = !!crit.length && (status === 'พร้อมเลื่อนขั้น' || status === 'ใกล้พร้อม' ||
    (ex.avg !== null && ex.avg >= 85 && rt && rt.avg >= 3.2) || (rt && /อยาก|ใช่|สูง/.test(rt.growth) && rt.avg >= 3));

  return {
    id: p.id, name: p.name, position: p.position, team: p.team || '-', lv: p.lvRaw, branch: p.branch,
    tenure: tenureText(p.months), months: p.months, start: p.start ? L.fmtDate(p.start) : '-',
    stage: p.stage, stageName: STAGES[p.stage], nextStage: STAGES[target] || '', status, readiness, missingData,
    criteria: crit, canGrow, risk, needs, exam: ex,
    rating: rt ? { date: L.fmtDate(rt.date), rater: rt.rater, avg: rt.avg, scores: rt.scores, growth: rt.growth, risk: rt.risk, strengths: rt.strengths, plan: rt.plan, prevAvg: prev ? prev.avg : null } : null
  };
}

/* ---------- ภาพสาขา ---------- */
function branchView(people, allExams, ratingsByKey, now, leavers) {
  const n = people.length;
  const by = s => people.filter(p => p.stage === s);
  const ge6 = people.filter(p => p.months >= 6);
  const lvOk = ge6.filter(p => /^[1-9]/.test(p.lv)).length;
  const lvShare = ge6.length ? lvOk / ge6.length : 0;
  const newbies = people.filter(p => p.months < 6);
  const noTeam = people.filter(p => p.team === '-' || /สำรอง/.test(p.team));
  const teams = {};
  people.forEach(p => { if (p.team !== '-' && !/สำรอง/.test(p.team)) { teams[p.team] = teams[p.team] || { team: p.team, size: 0, lead: false }; teams[p.team].size++; if (p.stage >= 2) teams[p.team].lead = true; } });
  const leaderless = Object.values(teams).filter(t => !t.lead && t.size > 1).map(t => t.team).sort();
  const examined30 = people.filter(p => p.exam.in30).length;
  const rated45 = people.filter(p => p.rating && ratingsByKey[p.key] && now - ratingsByKey[p.key] <= 45 * DAY).length;
  const highRisk = people.filter(p => p.risk.level === 'สูง');
  const ready = s => people.filter(p => p.stage === s && (p.status === 'พร้อมเลื่อนขั้น' || p.status === 'ใกล้พร้อม'));
  const keys = new Set(people.map(p => p.key));
  const weak = weakTally(allExams.filter(e => keys.has(e.key) && now - e.date <= 90 * DAY)).slice(0, 5)
    .map(w => ({ cat: w.cat, wrong: w.wrong, advice: L.DOMAIN_ADVICE[w.cat] || '' }));

  const gaps = [];
  if (!by(3).length) gaps.push({ level: 'สูง', text: 'ยังไม่มี Senior Service — ขั้นระหว่างหัวหน้าทีมกับ Supervisor ว่าง', action: 'เปิดอัตรา Senior Service 2 คนในงบ 2570 และเลือกจากผู้สืบทอด ' + ready(2).length + ' คนที่พร้อม/ใกล้พร้อม' });
  const supSucc = ready(3).length + (by(3).length ? 0 : ready(2).filter(p => p.months >= 60).length);
  if (supSucc < 2) gaps.push({ level: 'สูง', text: 'ผู้สืบทอด Supervisor ที่พร้อม/ใกล้พร้อม ' + supSucc + ' คน (เป้า 2 คน)', action: 'เร่งพัฒนาหัวหน้าทีมอายุงาน 5 ปีขึ้นไปด้านภาวะผู้นำและการสื่อสาร' });
  if (lvShare < LV_TARGET) gaps.push({ level: 'กลาง', text: 'คนอายุงาน 6 เดือนขึ้นไปอยู่ Lv.1 ขึ้นไป ' + Math.round(lvShare * 100) + '% (เป้า 90%)', action: 'นัดประเมินเลเวล ' + (ge6.length - lvOk) + ' คนที่ยังเป็น Lv.S' });
  if (!people.some(p => /^[2-9]/.test(p.lv))) gaps.push({ level: 'กลาง', text: 'ยังไม่มีใครถึง Lv.2', action: 'กำหนดเกณฑ์ Lv.2 และเลือกผู้เข้าประเมินรอบแรก' });
  if (noTeam.length) gaps.push({ level: newbies.length ? 'สูง' : 'กลาง', text: 'ยังไม่มีทีมประจำหรืออยู่ทีมสำรอง ' + noTeam.length + ' คน', action: 'จัดลงทีมและกำหนดพี่เลี้ยงคนละ 1 คน' });
  if (leaderless.length) gaps.push({ level: 'สูง', text: 'ทีมที่ไม่มีหัวหน้าทีม: ' + leaderless.join(', '), action: 'แต่งตั้งรองหัวหน้าทีมจากผู้สืบทอดหัวหน้าทีม' });
  if (n && rated45 / n < 0.8) gaps.push({ level: 'กลาง', text: 'ประเมินสมรรถนะใน 45 วันแล้ว ' + rated45 + ' จาก ' + n + ' คน', action: 'Supervisor ประเมินให้ครบทุกคนในแท็บ "ประเมินสมรรถนะ"' });
  if (n && examined30 / n < 0.8) gaps.push({ level: 'กลาง', text: 'ทำแบบทดสอบใน 30 วันแล้ว ' + examined30 + ' จาก ' + n + ' คน', action: 'ติดตามให้ทุกคนสอบรายสัปดาห์' });
  if (weak.length) gaps.push({ level: 'กลาง', text: 'หมวดที่ทั้งสาขาตอบผิดมากที่สุด: ' + weak[0].cat, action: weak[0].advice });

  const order = { 'สูง': 0, 'กลาง': 1, 'ต่ำ': 2 };
  gaps.sort((a, b) => order[a.level] - order[b.level]);
  return {
    headcount: n,
    stages: [1, 2, 3, 4].map(s => ({ stage: s, name: STAGES[s], count: by(s).length })),
    tenure: [
      { band: 'ไม่ถึง 6 เดือน', count: newbies.length },
      { band: '6 เดือน – 2 ปี', count: people.filter(p => p.months >= 6 && p.months < 24).length },
      { band: '2 ปีขึ้นไป', count: people.filter(p => p.months >= 24).length }
    ],
    lv: { share: Math.round(lvShare * 100), target: LV_TARGET * 100, ok: lvOk, base: ge6.length },
    examined30, rated45, highRisk: highRisk.length, midRisk: people.filter(p => p.risk.level === 'กลาง').length,
    pipeline: [2, 3, 4].map(t => ({ to: STAGES[t], ready: people.filter(p => p.stage === t - 1 && p.status === 'พร้อมเลื่อนขั้น').length, near: people.filter(p => p.stage === t - 1 && p.status === 'ใกล้พร้อม').length })),
    weak, gaps,
    leavers: leavers.length,
    leaversNote: leavers.length ? leavers.slice(-5).map(p => p.name + (p.leftReason ? ' (' + p.leftReason + ')' : '')) : []
  };
}

function build(rosterRows, ratingRows, summaryRows, now, branch) {
  const roster = parseRoster(rosterRows);
  const ratings = parseRatings(ratingRows);
  const exams = parseExams(summaryRows);
  const branches = [...new Set(roster.map(p => p.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const inBranch = p => !branch || p.branch === branch;
  const active = roster.filter(p => p.active && inBranch(p));
  const leavers = roster.filter(p => !p.active && inBranch(p));
  const lastRating = {};
  ratings.forEach(r => { lastRating[r.key] = r.date; });
  const people = active.map(p => Object.assign(person(p, exams.filter(e => e.key === p.key), ratings.filter(r => r.key === p.key), now), { key: p.key }));
  const view = branchView(people, exams, lastRating, now, leavers);
  people.forEach(p => delete p.key);
  people.sort((a, b) => b.stage - a.stage || (b.readiness || 0) - (a.readiness || 0) || b.months - a.months);
  return { asOf: L.fmtDate(now), branches, branch: branch || '', branchView: view, people, comps: COMP.map(c => ({ key: c.key, label: c.label })), stages: STAGES.slice(1) };
}

module.exports = { PTAB, ROSTER_HEADERS, RATING_HEADERS, COMP, CRITERIA, STAGES, idKey, stageOf, parseRoster, parseRatings, parseExams, build };
