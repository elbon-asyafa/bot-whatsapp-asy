function text(value, label = 'Teks', max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} wajib diisi, maksimal ${max} karakter.`);
  return value.trim();
}

function serial() {
  let tail = Promise.resolve();
  return fn => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
}

module.exports = { text, serial };
