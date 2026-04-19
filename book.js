// Aiphone Residence — shared booking logic
// Each page defines: FACILITY, DEMO_VALUES (optional), getPayload(), validate(), setSuccess(data)

const BOOK_URL = 'https://gyllfnsnniuqaarsulsk.supabase.co/functions/v1/aiphone-book';

function val(elementId) {
  const el = document.getElementById(elementId);
  return el ? el.value.trim() : '';
}

function id(elementId) {
  return document.getElementById(elementId);
}

// Set today as default date on all date inputs + handle demo mode
window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  document.querySelectorAll('input[type="date"]').forEach(el => {
    el.value = today;
    el.min = today;
  });

  // Demo mode: append ?demo to any booking URL to pre-fill the form
  // Note: use typeof check — const declarations don't attach to window
  if (new URLSearchParams(window.location.search).has('demo') &&
      typeof DEMO_VALUES !== 'undefined' && DEMO_VALUES) {
    _injectDemoBanner();
    _fillDemoValues();
  }
});

function _injectDemoBanner() {
  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.innerHTML = '<span class="demo-dot"></span><strong>Demo Mode</strong>&ensp;&mdash;&ensp;Fields pre-filled &middot; tap Confirm to generate a live pass';
  const formView = id('form-view');
  if (formView) formView.insertAdjacentElement('afterbegin', banner);
}

function _fillDemoValues() {
  // typeof guard — const in inline scripts is not a window property
  const values = (typeof DEMO_VALUES !== 'undefined') ? DEMO_VALUES : null;
  if (!values) return;
  Object.entries(values).forEach(([fieldId, value]) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.value = value;
    el.classList.add('demo-filled');
    setTimeout(() => el.classList.remove('demo-filled'), 1600);
  });
  // Pulse the submit button after a short delay
  setTimeout(() => {
    const btn = id('submit-btn');
    if (btn) btn.classList.add('demo-pulse');
  }, 800);
}

async function book() {
  const errEl  = id('err');
  const btnEl  = id('submit-btn');
  const origLabel = btnEl.textContent.trim();

  // Client-side validation
  const validationError = validate();
  if (validationError) {
    errEl.textContent = validationError;
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  // Lock UI
  btnEl.disabled = true;
  btnEl.classList.remove('demo-pulse');
  btnEl.innerHTML = '<span class="spin"></span>Creating pass…';
  btnEl.dataset.origLabel = origLabel;

  try {
    const res = await fetch(BOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(getPayload()),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || data.detail?.error || 'Failed to create pass. Please try again.');
    }

    showSuccess(data);
  } catch (e) {
    errEl.textContent = e.message || 'Network error — please try again.';
    errEl.style.display = 'block';
    btnEl.disabled = false;
    btnEl.textContent = btnEl.dataset.origLabel || 'Confirm & Get Pass';
  }
}

function showSuccess(data) {
  // Hide form, show success
  id('form-view').style.display = 'none';
  id('success-view').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Pass code
  id('s-code').textContent = data.code;

  // Wallet links
  id('s-apple').href  = data.apple_url;
  id('s-google').href = data.google_url;
  id('s-view').href   = data.public_url;

  // QR code — render the pass code so staff can scan right here
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

  // WhatsApp share — inject button once, update href on repeat bookings
  const facilityTitle = document.querySelector('.strip-title')?.textContent?.trim() || 'Facility Booking';
  const details       = id('s-sub')?.textContent?.trim() || '';
  const holderLine    = data.holder_name ? `For: ${data.holder_name}\n` : '';
  const waText = [
    `*${facilityTitle} — Aiphone Residence*`,
    `${holderLine}Pass: ${data.code}`,
    details,
    '',
    `🍎 Apple Wallet:\n${data.apple_url}`,
    `🤖 Google Wallet:\n${data.google_url}`,
  ].filter(Boolean).join('\n');
  const waHref = 'https://wa.me/?text=' + encodeURIComponent(waText);

  let waBtn = id('s-whatsapp');
  if (!waBtn) {
    waBtn = document.createElement('a');
    waBtn.id = 's-whatsapp';
    waBtn.className = 'share-btn';
    waBtn.target = '_blank';
    waBtn.rel = 'noopener noreferrer';
    waBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="white" style="flex-shrink:0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>Share via WhatsApp`;
    // Insert after the Google Wallet button
    id('s-google').insertAdjacentElement('afterend', waBtn);
  }
  waBtn.href = waHref;

  // Per-facility customisation
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
