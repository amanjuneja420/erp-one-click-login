// Runs on the ERP login page.
// Flow (same as ERP's own page, but done directly so no button can block it):
//   1. ask ERP for your security question      (getSecurityQues.htm)
//   2. pick your saved answer
//   3. ask ERP to email the OTP                 (getEmilOTP.htm)
//   4. background worker reads the OTP from Gmail's unread feed (email is not opened)
//   5. fill the real login form and submit it   (auth.htm)
(() => {
  const BASE = 'https://erp.iitkgp.ac.in/SSOAdministration/';
  const HOME = 'https://erp.iitkgp.ac.in/IIT_ERP3/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // ---------- status toast (never blocks clicks) ----------
  let toastEl;
  function toast(msg, kind = 'info') {
    console.log('[ERP One-Click]', msg);
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute(
        'style',
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;' +
          'padding:10px 14px;border-radius:8px;font:14px/1.4 system-ui,sans-serif;color:#fff;' +
          'box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none;'
      );
      document.documentElement.appendChild(toastEl);
    }
    toastEl.style.background = { info: '#1f4f9c', ok: '#1d7a3a', err: '#b3261e' }[kind] || '#1f4f9c';
    toastEl.textContent = 'ERP One-Click: ' + msg;
  }

  async function post(path, data) {
    const r = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams(data)
    });
    if (!r.ok) throw new Error(`ERP returned ${r.status} for ${path}`);
    return (await r.text()).trim();
  }

  const field = (name) => document.getElementById(name) || document.querySelector(`[name="${name}"]`);

  // Stop runaway loops (e.g. wrong OTP → page reloads → tries again forever).
  function tooManyAttempts() {
    const now = Date.now();
    const recent = JSON.parse(sessionStorage.getItem('erpOneClickAttempts') || '[]').filter((t) => now - t < 180000);
    recent.push(now);
    sessionStorage.setItem('erpOneClickAttempts', JSON.stringify(recent));
    return recent.length > 2;
  }

  async function run() {
    const t0 = Date.now();
    const cfg = await chrome.storage.local.get({
      roll: '',
      password: '',
      qa: [],
      enabled: true
    });
    if (!cfg.enabled) return;
    if (!cfg.roll || !cfg.password) {
      toast('Not set up yet — click the extension icon → Settings.', 'err');
      return;
    }

    // The login page only works when reached through ERP (it carries a sessionToken).
    // The new ERP page keeps it in the URL; the hidden field may be empty.
    const sessionTokenEl = field('sessionToken');
    const sessionToken =
      (sessionTokenEl && sessionTokenEl.value) || new URLSearchParams(location.search).get('sessionToken') || '';
    if (!sessionToken) {
      if (!sessionStorage.getItem('erpOneClickRedirected')) {
        sessionStorage.setItem('erpOneClickRedirected', '1');
        location.href = HOME;
      } else {
        toast('ERP login page did not load properly. Open erp.iitkgp.ac.in and try again.', 'err');
      }
      return;
    }
    sessionStorage.removeItem('erpOneClickRedirected');

    if (tooManyAttempts()) {
      toast('Stopped after repeated attempts. Check the message on the page, then log in manually.', 'err');
      return;
    }

    const requestedUrl =
      (field('requestedUrl') && field('requestedUrl').value) ||
      new URLSearchParams(location.search).get('requestedUrl') ||
      HOME;
    if (sessionTokenEl && !sessionTokenEl.value) sessionTokenEl.value = sessionToken;

    try {
      // Meanwhile, note the newest OTP email already in Gmail (so an old OTP is never reused).
      const baselineP = chrome.runtime
        .sendMessage({ type: 'OTP_BASELINE' })
        .then((r) => (r && r.baseline) || 0, () => 0);

      // 1–2. Security question → saved answer
      toast('Getting your security question…');
      const question = await post('getSecurityQues.htm', { user_id: cfg.roll });
      if (!question || question === 'FALSE') throw new Error('ERP did not recognise your roll number.');
      const hit = (cfg.qa || []).find((x) => x && x.q && x.a && norm(x.q) === norm(question))
        || (cfg.qa || []).find((x) => x && x.q && x.a && (norm(question).includes(norm(x.q)) || norm(x.q).includes(norm(question))));
      if (!hit) throw new Error(`No saved answer for "${question}". Open Settings → Fetch my questions.`);

      // Send exactly what ERP's own page sends: the whole login form (incl. typeee=SI).
      const form = document.getElementById('loginForm') || (field('user_id') && field('user_id').form);
      const details = {};
      if (form) for (const [k, v] of new FormData(form)) if (typeof v === 'string') details[k] = v;
      Object.assign(details, {
        user_id: cfg.roll,
        password: cfg.password,
        answer: hit.a,
        sessionToken,
        requestedUrl
      });
      if (!details.typeee) details.typeee = 'SI';
      delete details.email_otp;

      // 3. Ask ERP to send the OTP
      toast('Requesting OTP…');
      const baseline = await baselineP; // must be read BEFORE ERP sends the new OTP
      const since = Date.now() - 20000; // small allowance for clock differences
      const tOtp = Date.now();
      const raw = await post('getEmilOTP.htm', details);
      let msg = raw;
      try { msg = JSON.parse(raw).msg || raw; } catch (_) {}
      if (/password mismatch/i.test(msg)) throw new Error('ERP says your saved password is wrong.');
      if (/answ\w* mismatch/i.test(msg)) throw new Error('ERP says the security answer is wrong for: ' + question);
      if (!/otp/i.test(msg) || /unable|error/i.test(msg)) throw new Error('ERP: ' + msg);

      // 4. OTP from Gmail (background worker)
      toast('OTP sent — reading it from Gmail (email stays unread)…');
      const res = await chrome.runtime.sendMessage({ type: 'GET_OTP', since, baseline });
      if (!res || res.error || !res.otp) throw new Error((res && res.error) || 'Could not read the OTP from Gmail.');

      // 5. Fill the page's real form and submit it, so the browser logs in normally.
      const secs = (ms) => (ms / 1000).toFixed(1) + 's';
      toast(`Logging in… (OTP took ${secs(Date.now() - tOtp)}, total ${secs(Date.now() - t0)})`, 'ok');
      submitLogin({ ...details, email_otp: res.otp });
    } catch (e) {
      toast(e.message || String(e), 'err');
    }
  }

  function submitLogin(values) {
    const userBox = field('user_id');
    let form = (userBox && userBox.form) || document.querySelector('form');
    if (!form) {
      form = document.createElement('form');
      document.body.appendChild(form);
    }
    form.method = 'post';
    form.action = BASE + 'auth.htm';
    for (const [name, value] of Object.entries(values)) {
      let el = form.querySelector(`[name="${name}"]`);
      if (!el) {
        el = document.createElement('input');
        el.type = 'hidden';
        el.name = name;
        form.appendChild(el);
      }
      el.value = value;
    }
    // Native submit: skips any page script that might block it.
    HTMLFormElement.prototype.submit.call(form);
  }

  run();
})();
