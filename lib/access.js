const { config, normalizeJid } = require('./config');
const aliases = new Map();
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
module.exports = { rememberIdentity, isOwner };
