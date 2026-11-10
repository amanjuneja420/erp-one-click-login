const statusEl = document.getElementById('status');
const loginBtn = document.getElementById('login');

document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage();

chrome.storage.local.get({ roll: '', password: '', qa: [], enabled: true }).then((cfg) => {
  const answers = (cfg.qa || []).filter((x) => x && x.q && x.a).length;
  if (!cfg.roll || !cfg.password || answers === 0) {
    statusEl.textContent = 'Not set up yet — open Settings first.';
    loginBtn.textContent = 'Open Settings';
    loginBtn.disabled = false;
    loginBtn.onclick = () => chrome.runtime.openOptionsPage();
    return;
  }
  if (!cfg.enabled) {
    statusEl.textContent = 'Auto-login is switched off in Settings.';
  } else {
    statusEl.textContent = `Ready for ${cfg.roll} · ${answers}/3 answers saved · v${chrome.runtime.getManifest().version}`;
  }
  loginBtn.disabled = !cfg.enabled;
  loginBtn.onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'OPEN_ERP' });
    window.close();
  };
});
