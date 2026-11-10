// Background worker: reads the ERP OTP from Gmail's unread-mail Atom feed.
// Uses your existing Gmail sign-in in Chrome — no API keys, no Google Cloud setup.
// The feed only gives subject + preview text, so the email is never opened and stays unread.

const OTP_SUBJECT = 'otp for sign in in erp portal';
const POLL_FAST_MS = 1000; // when we know which Gmail account gets the OTP
const POLL_SCAN_MS = 1500; // first run: checking all accounts
const TIMEOUT_MS = 3 * 60 * 1000;
const MAX_ACCOUNTS = 6; // checks mail.google.com/mail/u/0 … u/5

const decode = (s) =>
  (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]).trim() : '';
};

async function readFeed(index) {
  const r = await fetch(`https://mail.google.com/mail/u/${index}/feed/atom?_=${Date.now()}`, {
    credentials: 'include',
    cache: 'no-store'
  });
  if (!r.ok || !/mail\.google\.com/.test(r.url)) return null; // not signed in / no such account
  const xml = await r.text();
  if (!/<feed/i.test(xml)) return null;
  const account = (tag(xml, 'title').match(/[\w.+-]+@[\w.-]+/) || [''])[0].toLowerCase();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => ({
    title: tag(m[1], 'title'),
    summary: tag(m[1], 'summary'),
    issued: Date.parse(tag(m[1], 'issued') || tag(m[1], 'modified'))
  }));
  return { account, entries };
}

function otpFrom(entry) {
  // ERP puts the OTP in the subject ("… IIT Kharagpur is 123456"); fall back to the preview text.
  for (const text of [entry.title, entry.summary]) {
    const nums = (text || '').match(/\b\d{4,8}\b/g) || [];
    if (nums.length) return nums[nums.length - 1];
  }
  return null;
}

const isOtpMail = (e) => e.title.toLowerCase().includes(OTP_SUBJECT) && !isNaN(e.issued);

// Newest ERP OTP email already in the inbox BEFORE we ask ERP for a new one.
// Anything at or before this time is an old (already cancelled) OTP.
async function otpBaseline() {
  const feeds = await Promise.all([...Array(MAX_ACCOUNTS).keys()].map(safeRead));
  let newest = 0;
  for (const f of feeds) if (f) for (const e of f.entries) if (isOtpMail(e)) newest = Math.max(newest, e.issued);
  return newest;
}

// Look in one feed for a fresh OTP email: newer than the baseline, not the OTP used last time.
function otpInFeed(feed, since, lastOtp) {
  const hits = feed.entries
    .filter((e) => isOtpMail(e) && e.issued > since)
    .sort((a, b) => b.issued - a.issued);
  for (const h of hits) {
    const otp = otpFrom(h);
    if (otp && otp !== lastOtp) return otp;
  }
  return null;
}

const safeRead = (i) => readFeed(i).catch(() => null);

async function waitForOtp(since) {
  const store = await chrome.storage.local.get({ gmailEmail: '', gmailIndex: null, lastOtp: '' });
  const wanted = store.gmailEmail.trim().toLowerCase();
  let known = Number.isInteger(store.gmailIndex) ? store.gmailIndex : null;
  const end = Date.now() + TIMEOUT_MS;

  while (Date.now() < end) {
    if (known !== null) {
      // Fast path: we already know which account gets the OTP — check only that one.
      const feed = await safeRead(known);
      if (feed && (!wanted || !feed.account || feed.account === wanted)) {
        const otp = otpInFeed(feed, since, store.lastOtp);
        if (otp) return done(otp, known);
      } else {
        known = null; // account order changed; rescan
      }
      await sleep(POLL_FAST_MS);
      continue;
    }

    // Slow path (first time): check every signed-in account at once.
    const feeds = await Promise.all([...Array(MAX_ACCOUNTS).keys()].map(safeRead));
    if (!feeds.some(Boolean)) {
      return { error: 'Not signed in to Gmail in this Chrome. Open gmail.com once and sign in to the inbox that gets ERP OTPs.' };
    }
    for (let i = 0; i < feeds.length; i++) {
      const feed = feeds[i];
      if (!feed || (wanted && feed.account && feed.account !== wanted)) continue;
      if (wanted && feed.account === wanted) known = i; // found the configured inbox
      const otp = otpInFeed(feed, since, store.lastOtp);
      if (otp) return done(otp, i);
    }
    await sleep(POLL_SCAN_MS);
  }
  return { error: 'No OTP email arrived within 3 minutes. Check the inbox the OTP goes to (Settings → Gmail address).' };
}

async function done(otp, index) {
  await chrome.storage.local.set({ gmailIndex: index, lastOtp: otp });
  return { otp };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'OTP_BASELINE') {
    otpBaseline().then((baseline) => sendResponse({ baseline }), () => sendResponse({ baseline: 0 }));
    return true;
  }
  if (msg && msg.type === 'GET_OTP') {
    // Only accept emails newer than both the pre-request baseline and a short time window.
    const since = Math.max(msg.baseline || 0, (msg.since || Date.now()) - 1);
    waitForOtp(since).then(sendResponse, (e) => sendResponse({ error: String(e && e.message) }));
    return true; // keep the channel open for the async reply
  }
  if (msg && msg.type === 'OPEN_ERP') {
    chrome.tabs.create({ url: 'https://erp.iitkgp.ac.in/IIT_ERP3/' });
    sendResponse({ ok: true });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'login-erp') chrome.tabs.create({ url: 'https://erp.iitkgp.ac.in/IIT_ERP3/' });
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
