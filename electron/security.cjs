exports.allowedExternal = (url) => { try { return ['https:', 'http:'].includes(new URL(url).protocol) } catch { return false } }
exports.validContent = (content) => typeof content === 'string' && Buffer.byteLength(content, 'utf8') <= 2 * 1024 * 1024
exports.validSenderURL = (url, trusted) => { try { const a = new URL(url), b = new URL(trusted); a.hash = ''; b.hash = ''; return a.href === b.href } catch { return false } }
