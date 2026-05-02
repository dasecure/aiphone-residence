// Aiphone Residence — shared booking logic (multi-tenant migration v2)
//
// Each facility page (book/<facility>.html) defines:
//   FACILITY        — string, must match a template_alias in business config
//   DEMO_VALUES     — optional, pre-fill values for ?demo mode
//   getPayload()    — returns { facility, holder_name, ...facility-specific fields }
//   validate()      — returns error message or null
//   setSuccess(data) — reads data.data.* and data.max_uses to render success view
//
// This file POSTs to the multi-tenant pass-create endpoint and reconstructs
// the legacy aiphone-book response shape so per-page setSuccess() functions
// keep working without modification.

const CREATE_URL      = 'https://gyllfnsnniuqaarsulsk.supabase.co/functions/v1/pass-create';
const AIPHONE_API_KEY = 'pqr_aiphone_f3adacc23c13cc1ee566cd8d29f86028';

// Per-facility defaults. Aliases match template_alias entries set in
// business.config.templates for the Aiphone Residence business.
const FACILITY_CONFIG = {
  visitor: { max_uses: 4,  expires_hours: 24 },
  bbq:     { max_uses: 10, expires_hours: 12 },
  gym:     { max_uses: 2,  expires_hours: 12 },
  tennis:  { max_uses: 2,  expires_hours: 12 },
  pool:    { max_uses: 2,  expires_hours: 12 },
  ktv:     { max_uses: 4,  expires_hours: 12 },
};

function val(elementId) {
  const el = document.getElementById(elementId);
  return el ? el.value.trim() : '';
}

function id(elementId) {
  return document.getElementById(elementId);
}

window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toLocaleDateString('en-CA');
  document.querySelectorAll('input[type="date"]').forEach(el => {
    el.value = today;
    el.min = today;
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
  banner.innerHTML = '<span class="demo-dot"></span><strong>Demo Mode</strong>&ensp;&mdash;&ensp;Fields pre-filled &middot; tap Confirm to generate a live pass';
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

// Wrap legacy payload shape into pass-create's expected shape.
// Adds common field aliases so per-page setSuccess() functions keep working.
function _buildPassCreateBody(rawPayload) {
  const { facility, holder_name, holder_email, ...rest } = rawPayload;
  const cfg = FACILITY_CONFIG[facility] || { max_uses: 10, expires_hours: 24 };

  const expires = new Date();
  expires.setHours(expires.getHours() + cfg.expires_hours);

  // Build the data object with all original keys + sensible aliases
  // so per-page setSuccess functions can use either name convention.
  const data = { facility, ...rest };
  if (rest.slot && !data.time_slot)        data.time_slot    = rest.slot;
  if (rest.date && !data.booking_date)     data.booking_date = rest.date;
  if (rest.unit && !data.unit_no)          data.unit_no      = rest.unit;
  if (rest.guests && !data.guest_count)    data.guest_count  = rest.guests;

  const body = {
    template_alias: facility,
    holder_name,
    expires_at:     expires.toISOString(),
    max_uses:       cfg.max_uses,
    data,
  };
  if (holder_email)  body.holder_email = holder_email;
  if (rest.email)    body.holder_email = body.holder_email || rest.email;

  return { body, max_uses: cfg.max_uses, dataReturned: data };
}

async function book() {
  const errEl  = id('err');
  const btnEl  = id('submit-btn');
  const origLabel = btnEl.textContent.trim();

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

  try {
    const raw = getPayload();
    const { body, max_uses, dataReturned } = _buildPassCreateBody(raw);

    const res = await fetch(CREATE_URL, {
      method: 'POST',
      headers: {
        'content-type':  'application/json',
        'Authorization': `Bearer ${AIPHONE_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const result = await res.json();

    if (!res.ok || !result.success) {
      throw new Error(result.error || result.detail?.error || 'Failed to create pass. Please try again.');
    }

    // Reconstruct the legacy aiphone-book response shape so per-page
    // setSuccess(data) functions keep working without modification:
    //   - data.code, data.holder_name, data.apple_url, data.google_url, data.public_url
    //   - data.data.{facility,unit,pit,date,slot,time_slot,...}
    //   - data.max_uses
    showSuccess({
      ...result,
      max_uses,
      data: dataReturned,
    });
  } catch (e) {
    errEl.textContent = e.message || 'Network error — please try again.';
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

  const appleEl  = id('s-apple');
  const googleEl = id('s-google');
  const viewEl   = id('s-view');
  if (appleEl)  appleEl.href  = data.apple_url;
  if (googleEl) googleEl.href = data.google_url;
  if (viewEl)   viewEl.href   = data.public_url;

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

  const facilityTitle = document.querySelector('.strip-title')?.textContent?.trim() || 'Facility Booking';
  const details       = id('s-sub')?.textContent?.trim() || '';
  const holderLine    = data.holder_name ? `For: ${data.holder_name}\n` : '';
  const waText = [
    `*${facilityTitle} \u2014 Aiphone Residence*`,
    `${holderLine}Pass: ${data.code}`,
    details,
    '',
    `\uD83C\uDF4E Apple Wallet:\n${data.apple_url}`,
    `\uD83E\uDD16 Google Wallet:\n${data.google_url}`,
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
    const googleBtnEl = id('s-google');
    if (googleBtnEl) googleBtnEl.insertAdjacentElement('afterend', waBtn);
  }
  waBtn.href = waHref;

  setSuccess(data);
}

function reset() {
  id('form-view').style.display = '';
  id('success-view').style.display = 'none';
  id('err').style.display = 'none';
  const btn = id('submit-btn');
  btn.disabled = false;
  btn.textContent = btn.dataset.origLabel || 'Confirm & Get Pass';
  if (id('qr')) id('qr').innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
