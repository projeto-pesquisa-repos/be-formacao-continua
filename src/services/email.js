const nodemailer = require('nodemailer');
const { getDb } = require('../database');

/**
 * Get SMTP settings from the database.
 */
async function getSmtpSettings() {
  const db = getDb();
  const keys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];
  const settings = {};
  for (const key of keys) {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    settings[key] = row ? row.value : null;
  }
  return settings;
}

/**
 * Send the generated password to a new user.
 */
async function sendNewUserPassword(email, name, password) {
  const smtp = await getSmtpSettings();

  if (!smtp.smtp_host || !smtp.smtp_user || !smtp.smtp_pass) {
    console.warn('SMTP not configured. Password for', email, ':', password);
    return { sent: false, reason: 'SMTP não configurado' };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.smtp_host,
    port: parseInt(smtp.smtp_port) || 587,
    secure: parseInt(smtp.smtp_port) === 465,
    auth: {
      user: smtp.smtp_user,
      pass: smtp.smtp_pass,
    },
  });

  const fromAddress = smtp.smtp_from || smtp.smtp_user;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #1E2433;">Bem-vindo(a) à Formação Continuada</h2>
      <p>Olá <strong>${name}</strong>,</p>
      <p>Sua conta foi criada no sistema de Formação Continuada Docente.</p>
      <p>Use as credenciais abaixo para acessar o sistema:</p>
      <div style="background: #f4f4f8; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
        <p style="margin: 4px 0;"><strong>Senha:</strong> ${password}</p>
      </div>
      <p style="color: #e74c3c;"><strong>Importante:</strong> Você será solicitado a alterar esta senha no primeiro acesso.</p>
      <p>Atenciosamente,<br>Coordenação Pedagógica</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: email,
      subject: 'Formação Continuada - Sua conta foi criada',
      html: htmlBody,
    });
    return { sent: true };
  } catch (err) {
    console.error('Email send error:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendNewUserPassword };
