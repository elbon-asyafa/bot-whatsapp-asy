const { config, normalizeJid } = require('./config');
const aliases = new Map();
function senderIdentity(key) {
  const group = key.remoteJid?.endsWith('@g.us');
  return {
    author: group ? key.participant : key.remoteJid,
    // Baileys 6.7 exposes PN fields; retain Alt fields for compatible deliveries.
    // In groups, senderPn can refer to the chat envelope, not the participant.
    alternate: group ? key.participantPn || key.participantAlt || key.participantLid
      : key.senderPn || key.remoteJidAlt || key.senderLid,
  };
}
function rememberIdentity(primary, alternate) {
  const a = normalizeJid(primary), b = normalizeJid(alternate);
  if (a && b && a !== b) {
    aliases.set(a, b);
    aliases.set(b, a);
    while (aliases.size > 10000) aliases.delete(aliases.keys().next().value);
  }
}
function isOwner(jid) {
  const id = normalizeJid(jid);
  return config.ownerNumbers.includes(id) || config.ownerNumbers.includes(aliases.get(id));
}
module.exports = { rememberIdentity, isOwner, senderIdentity };
