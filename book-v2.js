// Aiphone Residence — v2 booking adapter (new dasecure Platform API)
//
// This is the NEW path that talks to https://api.dasecure.com (the
// dasecure Platform API), not the original Supabase edge function.
//
// Each page sets:
//   PUBLISHABLE_KEY     pk_test_*  -  publishable API key (safe to embed)
//   TEMPLATE_ID         uuid       -  pass template for this facility
//   PASS_TYPE           string     -  'facility_booking' for all of these
//   FACILITY            short id   -  'bbq' | 'gym' | etc — used in data payload
//   DEMO_VALUES         object     -  optional pre-fill values
//   getPayload()        fn         -  collects form fields into an object for the `data` field
//   validate()          fn         -  returns an error message or null
//   setSuccess(data)    fn         -  populates the success view
//
// Differences from book.js (v1):
//   - Calls https://api.dasecure.com/v1/passes with Bearer pk_test_ auth
//   - Request shape: { templateId, passType, holderName, holderEmail?, data }
//   - Response shape: { code, state, walletUrls: { apple, google, landing } }
//   - Wallet buttons are currently disabled (signing-service not deployed).
//     The success UI will hide the wallet buttons until walletUrls.apple/google
//     are non-null; landing URL (passqr.com/p/CODE) is always shown.

const API_BASE = 'https://api.dasecure.com';

function val(elementId) {
  const el = document.getElementById(elementId);
  return el ? el.value.trim() : '';
}
function id(elementId) { return document.getElementById(elementId); }

window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toLocaleDateString('en-CA');
  document.querySelectorAll('input[type="date"]').forEach(el => {
    el.value = today; el.min = today;
  });
  if (new URLSearchParams(window.location.search).has('demo') &&
      typeof DEMO_VALUES !== 'undefined' && DEMO_VALUES) {
    _injectDemoBanner();
    _fillDemoValues();
  }
});

function _injectDemoBanner() {
  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.innerHTML = '<span class="demo-dot"></span><strong>Demo Mode</strong>&ensp;&mdash;&ensp;v2 via api.dasecure.com &middot; tap Confirm';
  const formView = id('form-view');
  if (formView) formView.insertAdjacentElement('afterbegin', banner);
}
function _fillDemoValues() {
  Object.entries(DEMO_VALUES).forEach(([fieldId, value]) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.value = value;
    el.classList.add('demo-filled');
    setTimeout(() => el.classList.remove('demo-filled'), 1600);
  });
  setTimeout(() => {
    const btn = id('submit-btn');
    if (btn) btn.classList.add('demo-pulse');
  }, 800);
}

async function book() {
  const errEl  = id('err');
  const btnEl  = id('submit-btn');
  const origLabel = btnEl.textContent.trim();

  if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY.startsWith('REPLACE_')) {
    errEl.textContent = 'Configuration error: publishable key not set in this HTML file.';
    errEl.style.display = 'block';
    return;
  }

  const validationError = validate();
  if (validationError) {
    errEl.textContent = validationError;
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  btnEl.disabled = true;
  btnEl.classList.remove('demo-pulse');
  btnEl.innerHTML = '<span class="spin"></span>Creating pass\u2026';
  btnEl.dataset.origLabel = origLabel;

  try {
    const formData = getPayload();
    const body = {
      templateId: TEMPLATE_ID,
      passType: PASS_TYPE,
      holderName: formData.holder_name,
      data: formData,
      issueImmediately: true,
    };
    if (formData.holder_email) body.holderEmail = formData.holder_email;

    const res = await fetch(API_BASE + '/v1/passes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || ('API error ' + res.status));
    }

    // Adapt new API response shape for the existing success UI conventions.
    showSuccess({
      code: data.code,
      holder_name: data.holderName,
      apple_url: data.walletUrls && data.walletUrls.apple,
      google_url: data.walletUrls && data.walletUrls.google,
      public_url: (data.walletUrls && data.walletUrls.landing) || ('https://passqr.com/p/' + data.code),
      data: body.data,   // echo the submitted data back for setSuccess to render
    });
  } catch (e) {
    errEl.textContent = e.message || 'Network error \u2014 please try again.';
    errEl.style.display = 'block';
    btnEl.disabled = false;
    btnEl.textContent = btnEl.dataset.origLabel || 'Confirm & Get Pass';
  }
}

function showSuccess(data) {
  id('form-view').style.display = 'none';
  id('success-view').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  id('s-code').textContent = data.code;

  // Wallet buttons: hide if URLs are null (signing-service not deployed yet).
  // Landing URL is always shown so the resident can at least see a page.
  const appleEl  = id('s-apple');
  const googleEl = id('s-google');
  const viewEl   = id('s-view');
  const walletNoticeEl = id('s-wallet-notice');

  if (appleEl) {
    if (data.apple_url) {
      appleEl.href = data.apple_url;
      appleEl.style.display = '';
    } else {
      appleEl.style.display = 'none';
    }
  }
  if (googleEl) {
    if (data.google_url) {
      googleEl.href = data.google_url;
      googleEl.style.display = '';
    } else {
      googleEl.style.display = 'none';
    }
  }
  if (viewEl) viewEl.href = data.public_url;

  // If wallet URLs are missing, show a friendly notice so the user understands why.
  if (!data.apple_url && !data.google_url && walletNoticeEl) {
    walletNoticeEl.style.display = 'block';
  }

  if (window.QRCode && id('qr')) {
    id('qr').innerHTML = '';
    new QRCode(id('qr'), {
      text: data.code, width: 180, height: 180,
      colorDark: '#1A2B4A', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  setSuccess(data);
}

function reset() {
  id('form-view').style.display = '';
  id('success-view').style.display = 'none';
  id('err').style.display = 'none';
  const btn = id('submit-btn');
  btn.disabled = false;
  btn.textContent = btn.dataset.origLabel || 'Confirm & Get Pass';
  id('qr').innerHTML = '';
  const walletNoticeEl = id('s-wallet-notice');
  if (walletNoticeEl) walletNoticeEl.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
