// Aiphone Residence — NEW booking logic (talks to api.dasecure.com)
// Parallel to book.js but uses the new Dasecure API with publishable-key auth.
// Each page defines: FACILITY, TEMPLATE_ID, DEMO_VALUES (optional), getPayload(), validate(), setSuccess(data)

const API_URL = 'https://api.dasecure.com/v1/passes';

// Pull the publishable key from the URL: ?pk=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxx
// Keeps the key out of git while we're testing the new API.
// Once we're ready for real production cutover we'll hardcode it here
// (pk_ keys are designed to be embeddable — Stripe pattern).
function getPublishableKey() {
  const params = new URLSearchParams(window.location.search);
  const pk = params.get('pk');
  if (!pk || !pk.startsWith('pk_test_') && !pk.startsWith('pk_live_')) {
    return null;
  }
  return pk;
}

function val(elementId) {
  const el = document.getElementById(elementId);
  return el ? el.value.trim() : '';
}

function id(elementId) {
  return document.getElementById(elementId);
}

window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  document.querySelectorAll('input[type="date"]').forEach(el => {
    el.value = today;
    el.min = today;
  });

  // Banner to signal this is the test page + check if key is present
  _injectTestBanner();

  const pk = getPublishableKey();
  if (!pk) {
    const btn = id('submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⚠️ Missing ?pk= query param';
      btn.style.background = '#e67e22';
    }
  }

  // Demo mode: ?demo also pre-fills form (can combine with ?pk=)
  if (new URLSearchParams(window.location.search).has('demo') &&
      typeof DEMO_VALUES !== 'undefined' && DEMO_VALUES) {
    _fillDemoValues();
  }
});

function _injectTestBanner() {
  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.style.background = '#0F1E3A';
  banner.style.color = '#C4A050';
  banner.innerHTML = '<span class="demo-dot" style="background:#C4A050"></span><strong>NEW API Test</strong>&ensp;&mdash;&ensp;Pass created via api.dasecure.com · Wallet URLs disabled (signing-service not yet deployed)';
  const formView = id('form-view');
  if (formView) formView.insertAdjacentElement('afterbegin', banner);
}

function _fillDemoValues() {
  const values = (typeof DEMO_VALUES !== 'undefined') ? DEMO_VALUES : null;
  if (!values) return;
  Object.entries(values).forEach(([fieldId, value]) => {
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

  const pk = getPublishableKey();
  if (!pk) {
    errEl.textContent = 'Missing publishable key. Append ?pk=pk_test_... to the URL.';
    errEl.style.display = 'block';
    return;
  }
  if (typeof TEMPLATE_ID === 'undefined' || !TEMPLATE_ID) {
    errEl.textContent = 'Page config error: TEMPLATE_ID not defined.';
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
  btnEl.innerHTML = '<span class="spin"></span>Creating pass…';
  btnEl.dataset.origLabel = origLabel;

  // Build the new-API payload shape.
  // Old edge function expected: { facility, holder_name, unit, ... }
  // New API expects: { templateId, passType, holderName, data: { ... } }
  const formPayload = getPayload();
  const apiPayload = {
    templateId: TEMPLATE_ID,
    passType: 'facility_booking',
    holderName: formPayload.holder_name,
    data: {
      // Everything else goes into data \u2014 the new pass-engine is schema-agnostic
      // on the data field, so vertical-specific fields flow through transparently.
      ...formPayload,
    },
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${pk}`,
      },
      body: JSON.stringify(apiPayload),
    });
    const data = await res.json();

    if (!res.ok) {
      const msg = data.error || `HTTP ${res.status}`;
      const code = data.code ? ` (${data.code})` : '';
      throw new Error(`Failed to create pass: ${msg}${code}`);
    }

    showSuccess(data);
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

  // Wallet links \u2014 new API returns walletUrls.{apple,google,landing}
  // Apple + Google are null until signing-service is live.
  const appleEl  = id('s-apple');
  const googleEl = id('s-google');
  const viewEl   = id('s-view');

  if (appleEl) {
    if (data.walletUrls && data.walletUrls.apple) {
      appleEl.href = data.walletUrls.apple;
      appleEl.style.display = '';
    } else {
      // Visually signal that wallet isn't available yet
      appleEl.style.opacity = '0.4';
      appleEl.style.pointerEvents = 'none';
      appleEl.innerHTML = appleEl.innerHTML.replace(/Add to Apple Wallet/, 'Apple Wallet (coming soon)');
    }
  }
  if (googleEl) {
    if (data.walletUrls && data.walletUrls.google) {
      googleEl.href = data.walletUrls.google;
      googleEl.style.display = '';
    } else {
      googleEl.style.opacity = '0.4';
      googleEl.style.pointerEvents = 'none';
      googleEl.innerHTML = googleEl.innerHTML.replace(/Save to Google Wallet/, 'Google Wallet (coming soon)');
    }
  }
  if (viewEl) {
    viewEl.href = (data.walletUrls && data.walletUrls.landing) || '#';
  }

  if (window.QRCode && id('qr')) {
    id('qr').innerHTML = '';
    new QRCode(id('qr'), {
      text:   data.code,
      width:  180,
      height: 180,
      colorDark:  '#1A2B4A',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  // setSuccess is defined per-page; it fills facility-specific details.
  // Note: data shape is different from old API \u2014 pass the whole response + the original form payload
  // so per-page code can read from either.
  if (typeof setSuccess === 'function') {
    setSuccess(data);
  }
}

function reset() {
  id('form-view').style.display = '';
  id('success-view').style.display = 'none';
  id('err').style.display = 'none';
  const btn = id('submit-btn');
  btn.disabled = false;
  btn.textContent = btn.dataset.origLabel || 'Confirm & Get Pass';
  id('qr').innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
