# ERP One-Click Login (IIT Kharagpur)

A Chrome extension that logs you in to [erp.iitkgp.ac.in](https://erp.iitkgp.ac.in) with one click or one keyboard shortcut — including the email OTP.

- Fills your roll number, password and the right security-question answer
- Requests the OTP from ERP itself (no need to press **Get OTP**)
- Reads the OTP from your Gmail's unread-mail feed — the email is never opened and stays unread
- Submits the login form
- **Alt+Shift+E** from anywhere in Chrome (change it at `chrome://extensions/shortcuts`)

Everything (roll number, password, answers) is stored only in your browser via `chrome.storage.local`. Nothing is sent anywhere except to ERP itself. There are no servers, no API keys and no Google Cloud setup.

## Install

1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the unzipped folder.
3. The Settings page opens:
   - enter your roll number and ERP password
   - click **Fetch my questions from ERP** and type all three answers
   - optionally enter the email address that receives ERP OTPs
4. Make sure the Gmail account that receives ERP OTPs is signed in to the same Chrome profile (open gmail.com once).
5. Click the extension icon → **Log in to ERP**, or press **Alt+Shift+E**.

If you have another ERP auto-login extension installed, remove it — two extensions on the login page will conflict.

## How it works

The ERP login page (`SSOAdministration/login.htm`) does four things; the extension does the same, directly:

| Step | ERP endpoint | What the extension does |
|---|---|---|
| Security question | `getSecurityQues.htm` | Fetches the question and picks your saved answer |
| Send OTP | `getEmilOTP.htm` | Sends the same form data the page sends |
| Read OTP | — | Reads `mail.google.com/mail/u/N/feed/atom` (subject line: *"OTP for Sign In in ERP Portal of IIT Kharagpur is …"*) |
| Log in | `auth.htm` | Fills the page's real form and submits it |

Before requesting a new OTP it records the newest OTP email already in your inbox, and only accepts an email that arrives after it — ERP cancels the old code when it sends a new one. It also remembers which Gmail account receives the OTPs, so later logins only check that one.

## Files

| File | Purpose |
|---|---|
| `content.js` | Runs on the ERP login page and drives the login |
| `background.js` | Reads the OTP from Gmail; handles the keyboard shortcut |
| `options.html/js` | Settings page |
| `popup.html/js` | Toolbar button |

## Credits

Login flow and endpoints learned from [iitkgp-erp-login](https://pypi.org/project/iitkgp-erp-login/) by metakgp, and from [siddsarkar/iitkgp-erp-auto-login-extension](https://github.com/siddsarkar/iitkgp-erp-auto-login-extension).

Not an official IIT Kharagpur application.
