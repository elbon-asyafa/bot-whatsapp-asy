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

function preview(value, max = 240) {
  const result = String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return result.length > max ? `${result.slice(0, max)}…` : result;
}

function formatChatRecord(record) {
  const time = new Date(record.time).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
  const action = record.event === 'message.received' ? 'MASUK' : record.event === 'message.sent' ? 'BALAS' : 'GAGAL';
  const sender = record.sender;
  const who = `${preview(sender.name, 60)} (${preview(sender.phone || 'nomor belum tersedia', 30)})`;
  const place = record.chatType === 'grup' ? `grup ${preview(record.chat, 60)}` : 'pribadi';
  const duration = record.durationMs === undefined ? '' : ` | ${record.durationMs} ms`;
  const target = record.target && (record.target !== record.chat || record.chatType === 'pribadi')
    ? ` | ke ${preview(phoneNumber(record.target) || record.target, 60)}` : '';
  const content = record.content;
  const body = content ? `${content.type === 'teks' ? '' : `[${preview(content.type)}] `}${preview(content.text)}` : preview(record.msg);
  const error = record.err || record.error;
  return `${time} ${action} | ${who} | ${place}${target}${duration}\n  ${body}${error?.message ? ` | ${preview(error.message)}` : ''}\n`;
}

function createChatHistory(capacity = 200) {
  const records = [];
  return {
    add(record) {
      // Keep only bounded display fields, never stacks or full reply payloads.
      records.push({ ...record, content: record.content ? { type: preview(record.content.type), text: preview(record.content.text) } : undefined,
        err: record.err ? { message: preview(record.err.message) } : undefined });
      if (records.length > capacity) records.shift();
    },
    read(chat, count) {
      return records.filter(record => !chat || record.chat === chat).slice(-count).map(formatChatRecord).join('\n');
    },
  };
}

module.exports = { phoneNumber, describeMessage, formatChatRecord, createChatHistory };
