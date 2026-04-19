// Aiphone Residence — shared booking logic
// Each page defines: FACILITY, getPayload(), validate(), setSuccess(data)

const BOOK_URL = 'https://gyllfnsnniuqaarsulsk.supabase.co/functions/v1/aiphone-book';

function val(elementId) {
  const el = document.getElementById(elementId);
  return el ? el.value.trim() : '';
}

function id(elementId) {
  return document.getElementById(elementId);
}

// Set today as default date on all date inputs
window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  document.querySelectorAll('input[type="date"]').forEach(el => {
    el.value = today;
    el.min = today;
  });
});

async function book() {
  const errEl  = id('err');
  const btnEl  = id('submit-btn');

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
  btnEl.innerHTML = '<span class="spin"></span>Creating pass…';

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
    btnEl.textContent = 'Confirm & Get Pass';
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

  // QR code — render the pass code as QR so staff can scan right here
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

  // Per-facility customisation
  setSuccess(data);
}

function reset() {
  id('form-view').style.display = '';
  id('success-view').style.display = 'none';
  id('err').style.display = 'none';
  const btn = id('submit-btn');
  btn.disabled = false;
  btn.innerHTML = btn.textContent; // restore original label
  id('qr').innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
