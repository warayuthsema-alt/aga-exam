// GET /api/health – ตรวจว่าตั้งค่าครบและเข้าถึง Google Sheet ได้
const S = require('../lib/sheets');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const env = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'SHEET_ID', 'SESSION_SECRET', 'ADMIN_KEY'].reduce((o, k) => (o[k] = !!process.env[k], o), {});
  let sheet = 'not checked';
  try { sheet = (await S.tabs()).length + ' tabs'; } catch (e) { sheet = 'error: ' + e.message; }
  res.status(200).json({ ok: true, env, sheet });
};
