require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
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

  const righeText = articoli.map(a =>
    `  ${a.codice}  ${a.nome}  x${a.quantita} crt.  €${parseFloat(a.prezzo).toFixed(2)}  = €${(a.quantita * a.prezzo).toFixed(2)}`
  ).join('\n');

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;color:#333;">
    <div style="background:#1a1f2e;padding:24px 28px;border-radius:12px 12px 0 0;">
      <h2 style="color:#fff;margin:0;font-size:20px;">📦 Nuovo Ordine #${ordineId}</h2>
      <p style="color:rgba(255,255,255,.6);margin:6px 0 0;font-size:13px;">${data}</p>
    </div>
    <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;">
      <table style="width:100%;margin-bottom:20px;">
        <tr>
          <td style="padding:6px 0;color:#888;font-size:13px;">Cliente</td>
          <td style="padding:6px 0;font-weight:700;font-size:16px;">${clienteNome}</td>
        </tr>
        ${clienteCodice ? `<tr><td style="padding:6px 0;color:#888;font-size:13px;">Codice</td><td style="padding:6px 0;font-family:monospace;color:#4f8ef7;">${clienteCodice}</td></tr>` : ''}
      </table>

      <h3 style="font-size:14px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Articoli</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888;">Codice</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888;">Prodotto</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#888;">Qtà</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#888;">Prezzo</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#888;">Subtotale</th>
          </tr>
        </thead>
        <tbody>${righeHtml}</tbody>
      </table>

      <div style="text-align:right;font-size:22px;font-weight:700;color:#4f8ef7;padding-top:12px;border-top:2px solid #f1f5f9;">
        Totale: €${parseFloat(totale).toFixed(2)}
      </div>

      ${note ? `<div style="margin-top:20px;padding:14px;background:#f8fafc;border-radius:8px;font-size:14px;color:#555;"><b>Note:</b> ${note}</div>` : ''}
    </div>
    <div style="background:#f8fafc;padding:14px 28px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none;text-align:center;">
      <p style="font-size:12px;color:#aaa;margin:0;">Fresh Tropical — Gestione Ordini</p>
    </div>
  </div>`;

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
});
