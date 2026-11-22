// POST /api/setup  header: x-admin-key: <ADMIN_KEY>  – เตรียมแท็บ/คอลัมน์ใน Google Sheet (รันซ้ำได้)
const crypto = require('crypto');
const svc = require('../lib/service');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const want = process.env.ADMIN_KEY || '';
  const got = String(req.headers['x-admin-key'] || '');
  const ok = want.length >= 16 && got.length === want.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (req.method !== 'POST' || !ok) return res.status(403).json({ ok: false, error: 'forbidden' });
  try {
    res.status(200).json({ ok: true, log: await svc.setup() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
