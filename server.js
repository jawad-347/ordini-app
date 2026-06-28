require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ordini-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utenti (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nome TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clienti (
      id SERIAL PRIMARY KEY,
      codice TEXT DEFAULT '',
      nome TEXT NOT NULL,
      email TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      indirizzo TEXT DEFAULT '',
      partitaiva TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS prodotti (
      id SERIAL PRIMARY KEY,
      codice TEXT DEFAULT '',
      nome TEXT NOT NULL,
      descrizione TEXT DEFAULT '',
      prezzo NUMERIC DEFAULT 0,
      stock INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ordini (
      id SERIAL PRIMARY KEY,
      clienteid INTEGER,
      righe JSONB DEFAULT '[]',
      totale NUMERIC DEFAULT 0,
      stato TEXT DEFAULT 'in_attesa',
      note TEXT DEFAULT '',
      data TIMESTAMP DEFAULT NOW(),
      utente_id INTEGER,
      utente_nome TEXT DEFAULT ''
    );
  `);

  // Migrazione: aggiungi colonne utente se non esistono
  await pool.query(`
    ALTER TABLE ordini ADD COLUMN IF NOT EXISTS utente_id INTEGER;
    ALTER TABLE ordini ADD COLUMN IF NOT EXISTS utente_nome TEXT DEFAULT '';
  `);

  // Crea admin di default se non ci sono utenti
  const { rows } = await pool.query('SELECT COUNT(*) FROM utenti');
  if (parseInt(rows[0].count) === 0) {
    const u = process.env.ADMIN_USER || 'admin';
    const p = process.env.ADMIN_PASS || 'admin123';
    const n = process.env.ADMIN_NOME || 'Amministratore';
    const hash = await bcrypt.hash(p, 10);
    await pool.query(
      'INSERT INTO utenti (username, password_hash, nome, is_admin) VALUES ($1,$2,$3,true)',
      [u, hash, n]
    );
    console.log(`✅ Utente admin creato: ${u} / ${p}`);
  }
}

function requireAuth(req, res, next) {
  if (req.session && req.session.utente) return next();
  res.status(401).json({ error: 'Non autenticato' });
}

// ---- AUTH ----
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Dati mancanti' });
    const r = await pool.query('SELECT * FROM utenti WHERE username=$1', [username.trim()]);
    if (!r.rows.length) return res.status(401).json({ error: 'Credenziali errate' });
    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenziali errate' });
    req.session.utente = { id: u.id, username: u.username, nome: u.nome, isAdmin: u.is_admin };
    res.json({ ok: true, utente: req.session.utente });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.utente) return res.json(req.session.utente);
  res.status(401).json({ error: 'Non autenticato' });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password troppo corta (min 4 caratteri)' });
    const r = await pool.query('SELECT password_hash FROM utenti WHERE id=$1', [req.session.utente.id]);
    const ok = await bcrypt.compare(oldPassword, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Password attuale errata' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE utenti SET password_hash=$1 WHERE id=$2', [hash, req.session.utente.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ---- UTENTI (solo admin) ----
app.get('/api/utenti', requireAuth, async (req, res) => {
  if (!req.session.utente.isAdmin) return res.status(403).json({ error: 'Non autorizzato' });
  const r = await pool.query('SELECT id, username, nome, is_admin, created_at FROM utenti ORDER BY id');
  res.json(r.rows.map(u => ({ id: u.id, username: u.username, nome: u.nome, isAdmin: u.is_admin, createdAt: u.created_at })));
});

app.post('/api/utenti', requireAuth, async (req, res) => {
  if (!req.session.utente.isAdmin) return res.status(403).json({ error: 'Non autorizzato' });
  try {
    const { username, password, nome, isAdmin } = req.body;
    if (!username || !password || !nome) return res.status(400).json({ error: 'Dati mancanti' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO utenti (username, password_hash, nome, is_admin) VALUES ($1,$2,$3,$4) RETURNING id, username, nome, is_admin',
      [username.trim(), hash, nome.trim(), isAdmin || false]
    );
    const u = r.rows[0];
    res.json({ id: u.id, username: u.username, nome: u.nome, isAdmin: u.is_admin });
  } catch(err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username già in uso' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/utenti/:id', requireAuth, async (req, res) => {
  if (!req.session.utente.isAdmin) return res.status(403).json({ error: 'Non autorizzato' });
  if (parseInt(req.params.id) === req.session.utente.id) return res.status(400).json({ error: 'Non puoi eliminare te stesso' });
  await pool.query('DELETE FROM utenti WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---- MAPPER ----
function mapC(r) {
  return { id: r.id, codice: r.codice||'', nome: r.nome, email: r.email||'', telefono: r.telefono||'', indirizzo: r.indirizzo||'', partitaIva: r.partitaiva||'' };
}
function mapP(r) {
  return { id: r.id, codice: r.codice||'', nome: r.nome, descrizione: r.descrizione||'', prezzo: parseFloat(r.prezzo)||0, stock: parseInt(r.stock)||0 };
}
function mapO(r) {
  return { id: r.id, clienteId: r.clienteid, righe: r.righe||[], totale: parseFloat(r.totale)||0, stato: r.stato, note: r.note||'', data: r.data, utenteNome: r.utente_nome||'' };
}

// ---- CLIENTI ----
app.get('/api/clienti', requireAuth, async (req, res) => {
  const r = await pool.query('SELECT * FROM clienti ORDER BY nome');
  res.json(r.rows.map(mapC));
});

app.post('/api/clienti', requireAuth, async (req, res) => {
  const { codice, nome, email, telefono, indirizzo, partitaIva } = req.body;
  const r = await pool.query(
    'INSERT INTO clienti (codice,nome,email,telefono,indirizzo,partitaiva) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [codice||'', nome, email||'', telefono||'', indirizzo||'', partitaIva||'']
  );
  res.json(mapC(r.rows[0]));
});

app.post('/api/clienti/bulk', requireAuth, async (req, res) => {
  try {
    const { clienti } = req.body;
    if (!clienti || !clienti.length) return res.json({ ok: true, count: 0 });
    const BATCH = 500;
    for (let i = 0; i < clienti.length; i += BATCH) {
      const batch = clienti.slice(i, i + BATCH);
      const vals = batch.map((c, j) => `($${j*6+1},$${j*6+2},$${j*6+3},$${j*6+4},$${j*6+5},$${j*6+6})`).join(',');
      const params = batch.flatMap(c => [c.codice||'', c.nome, c.email||'', c.telefono||'', c.indirizzo||'', c.partitaIva||'']);
      await pool.query(`INSERT INTO clienti (codice,nome,email,telefono,indirizzo,partitaiva) VALUES ${vals}`, params);
    }
    res.json({ ok: true, count: clienti.length });
  } catch(err) {
    console.error('bulk clienti error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/clienti/:id', requireAuth, async (req, res) => {
  const { codice, nome, email, telefono, indirizzo, partitaIva } = req.body;
  const r = await pool.query(
    'UPDATE clienti SET codice=$1,nome=$2,email=$3,telefono=$4,indirizzo=$5,partitaiva=$6 WHERE id=$7 RETURNING *',
    [codice||'', nome, email||'', telefono||'', indirizzo||'', partitaIva||'', req.params.id]
  );
  res.json(mapC(r.rows[0]));
});

app.delete('/api/clienti/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM clienti WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---- PRODOTTI ----
app.get('/api/prodotti', requireAuth, async (req, res) => {
  const r = await pool.query('SELECT * FROM prodotti ORDER BY nome');
  res.json(r.rows.map(mapP));
});

app.post('/api/prodotti', requireAuth, async (req, res) => {
  const { codice, nome, descrizione, prezzo, stock } = req.body;
  const r = await pool.query(
    'INSERT INTO prodotti (codice,nome,descrizione,prezzo,stock) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [codice||'', nome, descrizione||'', prezzo||0, stock||0]
  );
  res.json(mapP(r.rows[0]));
});

app.post('/api/prodotti/bulk', requireAuth, async (req, res) => {
  try {
    const { prodotti } = req.body;
    if (!prodotti || !prodotti.length) return res.json({ ok: true, count: 0 });
    const BATCH = 500;
    for (let i = 0; i < prodotti.length; i += BATCH) {
      const batch = prodotti.slice(i, i + BATCH);
      const vals = batch.map((p, j) => `($${j*5+1},$${j*5+2},$${j*5+3},$${j*5+4},$${j*5+5})`).join(',');
      const params = batch.flatMap(p => [p.codice||'', p.nome, p.descrizione||'', p.prezzo||0, p.stock||0]);
      await pool.query(`INSERT INTO prodotti (codice,nome,descrizione,prezzo,stock) VALUES ${vals}`, params);
    }
    res.json({ ok: true, count: prodotti.length });
  } catch(err) {
    console.error('bulk prodotti error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/prodotti/:id', requireAuth, async (req, res) => {
  const { codice, nome, descrizione, prezzo, stock } = req.body;
  const r = await pool.query(
    'UPDATE prodotti SET codice=$1,nome=$2,descrizione=$3,prezzo=$4,stock=$5 WHERE id=$6 RETURNING *',
    [codice||'', nome, descrizione||'', prezzo||0, stock||0, req.params.id]
  );
  res.json(mapP(r.rows[0]));
});

app.delete('/api/prodotti/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM prodotti WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---- ORDINI ----
app.get('/api/ordini', requireAuth, async (req, res) => {
  const r = await pool.query('SELECT * FROM ordini ORDER BY id DESC');
  res.json(r.rows.map(mapO));
});

app.post('/api/ordini', requireAuth, async (req, res) => {
  const { clienteId, righe, totale, stato, note } = req.body;
  const { id: utenteId, nome: utenteNome } = req.session.utente;
  const r = await pool.query(
    'INSERT INTO ordini (clienteid,righe,totale,stato,note,utente_id,utente_nome) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [clienteId, JSON.stringify(righe), totale, stato||'in_attesa', note||'', utenteId, utenteNome]
  );
  res.json(mapO(r.rows[0]));
});

app.put('/api/ordini/:id', requireAuth, async (req, res) => {
  const { stato } = req.body;
  const r = await pool.query('UPDATE ordini SET stato=$1 WHERE id=$2 RETURNING *', [stato, req.params.id]);
  res.json(mapO(r.rows[0]));
});

app.delete('/api/ordini/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM ordini WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---- EMAIL ----
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

app.post('/api/send-email', requireAuth, async (req, res) => {
  if (req.body._ping) return res.json({ ok: true });
  const { ordineId, clienteNome, clienteCodice, articoli, totale, note, data } = req.body;

  const righeHtml = articoli.map(a =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;color:#4f8ef7;">${a.codice}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${a.nome}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">${a.quantita} crt.</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">€${parseFloat(a.prezzo).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;">€${(a.quantita * a.prezzo).toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;color:#333;">
    <div style="background:#1a1f2e;padding:24px 28px;border-radius:12px 12px 0 0;">
      <h2 style="color:#fff;margin:0;font-size:20px;">📦 Nuovo Ordine #${ordineId}</h2>
      <p style="color:rgba(255,255,255,.6);margin:6px 0 0;font-size:13px;">${data}</p>
    </div>
    <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;">
      <table style="width:100%;margin-bottom:20px;">
        <tr><td style="padding:6px 0;color:#888;font-size:13px;">Cliente</td><td style="padding:6px 0;font-weight:700;font-size:16px;">${clienteNome}</td></tr>
        ${clienteCodice ? `<tr><td style="padding:6px 0;color:#888;font-size:13px;">Codice</td><td style="padding:6px 0;font-family:monospace;color:#4f8ef7;">${clienteCodice}</td></tr>` : ''}
      </table>
      <h3 style="font-size:14px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Articoli</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888;">Codice</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888;">Prodotto</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#888;">Qtà</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#888;">Prezzo</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#888;">Subtotale</th>
        </tr></thead>
        <tbody>${righeHtml}</tbody>
      </table>
      <div style="text-align:right;font-size:22px;font-weight:700;color:#4f8ef7;padding-top:12px;border-top:2px solid #f1f5f9;">Totale: €${parseFloat(totale).toFixed(2)}</div>
      ${note ? `<div style="margin-top:20px;padding:14px;background:#f8fafc;border-radius:8px;font-size:14px;color:#555;"><b>Note:</b> ${note}</div>` : ''}
    </div>
    <div style="background:#f8fafc;padding:14px 28px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none;text-align:center;">
      <p style="font-size:12px;color:#aaa;margin:0;">Fresh Tropical — Gestione Ordini</p>
    </div>
  </div>`;

  const righeText = articoli.map(a =>
    `  ${a.codice}  ${a.nome}  x${a.quantita} crt.  €${parseFloat(a.prezzo).toFixed(2)}  = €${(a.quantita * a.prezzo).toFixed(2)}`
  ).join('\n');
  const text = `Ordine #${ordineId} - ${data}\nCliente: ${clienteNome} ${clienteCodice ? '('+clienteCodice+')' : ''}\n\nArticoli:\n${righeText}\n\nTotale: €${parseFloat(totale).toFixed(2)}\n${note ? '\nNote: '+note : ''}`;

  try {
    await transporter.sendMail({
      from: `"Fresh Tropical Ordini" <${process.env.EMAIL_FROM}>`,
      to: process.env.EMAIL_TO,
      subject: `Ordine #${ordineId} - ${clienteNome}`,
      text,
      html,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ App ordini avviata → http://localhost:${PORT}\n`);
  initDB()
    .then(() => console.log('✅ Database pronto'))
    .catch(err => console.error('⚠️ DB init error:', err.message));
});
