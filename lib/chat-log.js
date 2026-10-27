const { normalizeJid } = require('./config');

function phoneNumber(...identities) {
  for (const identity of identities) {
    const jid = normalizeJid(identity);
    if (jid.endsWith('@s.whatsapp.net')) return `+${jid.split('@')[0]}`;
  }
  return null;
}

// Describe content only; never serialize media buffers, keys, or download URLs.
function describeMessage(content) {
  if (typeof content.text === 'string') return { type: 'teks', text: content.text };
  if (typeof content.conversation === 'string') return { type: 'teks', text: content.conversation };
  if (content.extendedTextMessage) return { type: 'teks', text: content.extendedTextMessage.text || '' };
  for (const [key, type] of Object.entries({ image: 'gambar', video: 'video', audio: 'audio', sticker: 'stiker', document: 'dokumen' })) {
    const media = content[`${key}Message`] || content[key];
    if (!media) continue;
    const details = content[`${key}Message`] || content;
    return {
      type, text: details.caption || '',
      ...(details.fileName ? { fileName: details.fileName } : {}),
      ...(details.mimetype ? { mimetype: details.mimetype } : {}),
    };
  }
  return { type: Object.keys(content).find(key => key.endsWith('Message')) || 'pesan lain', text: '' };
}

module.exports = { phoneNumber, describeMessage };
