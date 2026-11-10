const $ = (id) => document.getElementById(id);
let qa = []; // [{q, a}]

function renderQA() {
  const box = $('qa');
  box.innerHTML = '';
  qa.forEach((item, i) => {
    const q = document.createElement('div');
    q.className = 'q';
    q.textContent = `Q${i + 1}. ${item.q}`;
    const a = document.createElement('input');
    a.type = 'password';
    a.placeholder = 'Your answer';
    a.value = item.a || '';
    a.autocomplete = 'off';
    a.oninput = () => (qa[i].a = a.value);
    a.onfocus = () => (a.type = 'text');
    a.onblur = () => (a.type = 'password');
    box.append(q, a);
  });
}

async function load() {
  const cfg = await chrome.storage.local.get({ roll: '', password: '', qa: [], gmailEmail: '', enabled: true });
  $('roll').value = cfg.roll;
  $('password').value = cfg.password;
  $('gmail').value = cfg.gmailEmail;
  $('enabled').checked = cfg.enabled;
  qa = cfg.qa || [];
  renderQA();
}

$('togglePw').onclick = () => {
  const pw = $('password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
  $('togglePw').textContent = pw.type === 'password' ? 'Show' : 'Hide';
};

$('fetchQ').onclick = async () => {
  const roll = $('roll').value.trim();
  const status = $('qStatus');
  if (!roll) {
    status.textContent = 'Enter your roll number first.';
    return;
  }
  status.textContent = 'Fetching…';
  const found = new Set(qa.map((x) => x.q));
  try {
    // ERP returns one random question per call; ask until all 3 show up.
    for (let i = 0; i < 25 && found.size < 3; i++) {
      const r = await fetch('https://erp.iitkgp.ac.in/SSOAdministration/getSecurityQues.htm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ user_id: roll })
      });
      const q = (await r.text()).trim();
      if (!q || q === 'FALSE' || q.length > 300 || /<html/i.test(q)) {
        status.textContent = 'ERP did not recognise that roll number (or ERP is down).';
        return;
      }
      found.add(q);
    }
  } catch (e) {
    status.textContent = 'Could not reach ERP: ' + e.message;
    return;
  }
  const old = Object.fromEntries(qa.map((x) => [x.q, x.a]));
  qa = [...found].slice(0, 3).map((q) => ({ q, a: old[q] || '' }));
  renderQA();
  status.textContent = `Got ${qa.length} question${qa.length === 1 ? '' : 's'} — now type your answers.`;
};

$('save').onclick = async () => {
  const msg = $('msg');
  const roll = $('roll').value.trim();
  const password = $('password').value;
  if (!roll || !password) {
    msg.className = 'err';
    msg.textContent = 'Roll number and password are required.';
    return;
  }
  const missing = qa.filter((x) => !x.a).length;
  await chrome.storage.local.set({
    roll,
    password,
    qa,
    gmailEmail: $('gmail').value.trim(),
    enabled: $('enabled').checked
  });
  msg.className = qa.length && !missing ? 'ok' : 'err';
  msg.textContent = !qa.length
    ? 'Saved — but fetch your security questions too.'
    : missing
    ? `Saved — ${missing} answer${missing > 1 ? 's' : ''} still empty.`
    : 'Saved. Click the extension icon → Log in to ERP.';
};

load();
