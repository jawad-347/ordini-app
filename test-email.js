require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('=== TEST SMTP ===');
console.log('Host:  ', process.env.SMTP_HOST);
console.log('Porta: ', process.env.SMTP_PORT);
console.log('Utente:', process.env.SMTP_USER);
console.log('A:     ', process.env.EMAIL_TO);
console.log('================\n');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

console.log('Verifica connessione SMTP...');
transporter.verify((err, ok) => {
  if (err) {
    console.log('❌ CONNESSIONE FALLITA:', err.message);
    console.log('\nCosa controllare:');
    if (err.message.includes('auth') || err.message.includes('535')) {
      console.log('  → Username o password sbagliati');
    } else if (err.message.includes('ECONNREFUSED') || err.message.includes('timeout')) {
      console.log('  → Host o porta sbagliati, o server non raggiungibile');
    } else if (err.message.includes('Relay')) {
      console.log('  → IP non autorizzato al relay su questo SMTP');
    }
    process.exit(1);
  }

  console.log('✅ Connessione OK — invio email di prova...\n');
  transporter.sendMail({
    from: `"Test Ordini" <${process.env.EMAIL_FROM}>`,
    to: process.env.EMAIL_TO,
    subject: 'Test SMTP funzionante ✅',
    text: 'Ciao!\n\nL\'invio automatico email funziona correttamente.\n\n-- App Ordini Fresh Tropical',
    html: '<p>Ciao!</p><p>L\'invio automatico email <b>funziona correttamente</b>.</p><p>-- App Ordini Fresh Tropical</p>',
  }, (err2, info) => {
    if (err2) {
      console.log('❌ INVIO FALLITO:', err2.message);
    } else {
      console.log('✅ EMAIL INVIATA CON SUCCESSO!');
      console.log('   MessageID:', info.messageId);
      console.log('\nControlla la casella', process.env.EMAIL_TO);
    }
  });
});
