// Fills business details on the legal pages from /business.json so they are maintained in one place.
(async () => {
  try {
    const theme = localStorage.getItem('if:theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  } catch { /* storage unavailable */ }

  let business;
  try {
    business = await (await fetch('/business.json', { cache: 'no-cache' })).json();
  } catch {
    return;
  }
  const values = {
    productName: business.productName,
    legalName: business.legalName,
    address: business.address,
    registrationNumber: business.registrationNumber,
    taxId: business.taxId,
    contactEmail: business.contactEmail,
    privacyEmail: business.privacyEmail,
    grievanceOfficer: business.grievanceOfficer,
    governingLaw: business.governingLaw,
    effectiveDate: business.legal.effectiveDate,
    minimumAge: String(business.legal.minimumAge),
    year: String(new Date().getFullYear())
  };
  document.querySelectorAll('[data-biz]').forEach(el => {
    const value = values[el.dataset.biz];
    if (value == null) return;
    if (el.tagName === 'A' && /Email$/.test(el.dataset.biz)) el.href = `mailto:${value.replace(/^\[|\]$/g, '')}`;
    el.textContent = value;
  });
  const table = document.querySelector('[data-subprocessors]');
  if (table) {
    for (const p of business.subprocessors) {
      const row = table.insertRow();
      for (const value of [p.name, p.purpose, p.location]) row.insertCell().textContent = value;
    }
  }
})();
