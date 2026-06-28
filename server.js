require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
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
      data TIMESTAMP DEFAULT NOW()
    );
  `);
}

function mapC(r) {
  return { id: r.id, codice: r.codice||'', nome: r.nome, email: r.email||'', telefono: r.telefono||'', indirizzo: r.indirizzo||'', partitaIva: r.partitaiva||'' };
}
function mapP(r) {
  return { id: r.id, codice: r.codice||'', nome: r.nome, descrizione: r.descrizione||'', prezzo: parseFloat(r.prezzo)||0, stock: parseInt(r.stock)||0 };
}
function mapO(r) {
  return { id: r.id, clienteId: r.clienteid, righe: r.righe||[], totale: parseFloat(r.totale)||0, stato: r.stato, note: r.note||'', data: r.data };
}

// ---- CLIENTI ----
app.get('/api/clienti', async (req, res) => {
  const r = await pool.query('SELECT * FROM clienti ORDER BY nome');
  res.json(r.rows.map(mapC));
});

app.post('/api/clienti', async (req, res) => {
  const { codice, nome, email, telefono, indirizzo, partitaIva } = req.body;
  const r = await pool.query(
    'INSERT INTO clienti (codice,nome,email,telefono,indirizzo,partitaiva) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [codice||'', nome, email||'', telefono||'', indirizzo||'', partitaIva||'']
  );
  res.json(mapC(r.rows[0]));
});

app.post('/api/clienti/bulk', async (req, res) => {
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

app.put('/api/clienti/:id', async (req, res) => {
  const { codice, nome, email, telefono, indirizzo, partitaIva } = req.body;
  const r = await pool.query(
    'UPDATE clienti SET codice=$1,nome=$2,email=$3,telefono=$4,indirizzo=$5,partitaiva=$6 WHERE id=$7 RETURNING *',
    [codice||'', nome, email||'', telefono||'', indirizzo||'', partitaIva||'', req.params.id]
  );
  res.json(mapC(r.rows[0]));
});

app.delete('/api/clienti/:id', async (req, res) => {
  await pool.query('DELETE FROM clienti WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---- PRODOTTI ----
app.get('/api/prodotti', async (req, res) => {
  const r = await pool.query('SELECT * FROM prodotti ORDER BY nome');
  res.json(r.rows.map(mapP));
});

app.post('/api/prodotti', async (req, res) => {
  const { codice, nome, descrizione, prezzo, stock } = req.body;
  const r = await pool.query(
    'INSERT INTO prodotti (codice,nome,descrizione,prezzo,stock) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [codice||'', nome, descrizione||'', prezzo||0, stock||0]
  );
  res.json(mapP(r.rows[0]));
});

app.post('/api/prodotti/bulk', async (req, res) => {
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

app.put('/api/prodotti/:id', async (req, res) => {
  const { codice, nome, descrizione, prezzo, stock } = req.body;
  const r = await pool.query(
    'UPDATE prodotti SET codice=$1,nome=$2,descrizione=$3,prezzo=$4,stock=$5 WHERE id=$6 RETURNING *',
    [codice||'', nome, descrizione||'', prezzo||0, stock||0, req.params.id]
  );
  res.json(mapP(r.rows[0]));
});

app.delete('/api/prodotti/:id', async (req, res) => {
  await pool.query('DELETE FROM prodotti WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---- ORDINI ----
app.get('/api/ordini', async (req, res) => {
  const r = await pool.query('SELECT * FROM ordini ORDER BY id DESC');
  res.json(r.rows.map(mapO));
});

app.post('/api/ordini', async (req, res) => {
  const { clienteId, righe, totale, stato, note } = req.body;
  const r = await pool.query(
    'INSERT INTO ordini (clienteid,righe,totale,stato,note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [clienteId, JSON.stringify(righe), totale, stato||'in_attesa', note||'']
  );
  res.json(mapO(r.rows[0]));
});

app.put('/api/ordini/:id', async (req, res) => {
  const { stato } = req.body;
  const r = await pool.query('UPDATE ordini SET stato=$1 WHERE id=$2 RETURNING *', [stato, req.params.id]);
  res.json(mapO(r.rows[0]));
});

app.delete('/api/ordini/:id', async (req, res) => {
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

app.post('/api/send-email', async (req, res) => {
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
