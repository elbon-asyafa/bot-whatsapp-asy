const pino = require('pino');

function createLogger(destination) {
  return pino({
    level: process.env.LOG_LEVEL || 'warn',
    // Baileys uses both `err` and `error`; Pino only serializes `err` by default.
    serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
    // Keep stanza metadata for diagnosis, without dumping encrypted message buffers.
    redact: { paths: ['node.content'], remove: true },
  }, destination);
}

module.exports = { createLogger };
