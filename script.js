let invoices = JSON.parse(localStorage.getItem('invoices')||'[]');
let profile = JSON.parse(localStorage.getItem('profile')||'{}');
let items = [{desc:'',qty:1,rate:0}];
let editingId = null;
let obStep = 1;
let currentUser = null;
let authMode = 'login';
let syncTimer = null;
let otpVerified = {email: false, phone: false};

// ═══ BRANDING CONSTANTS ═══
const BRAND_COLORS = [
  {label:'Forest',value:'#1a6b4a'},
  {label:'Indigo',value:'#3730a3'},
  {label:'Rose',value:'#be123c'},
  {label:'Amber',value:'#b45309'},
  {label:'Slate',value:'#334155'},
  {label:'Violet',value:'#6d28d9'},
  {label:'Teal',value:'#0f766e'},
  {label:'Crimson',value:'#9f1239'},
];

const BRAND_FONTS = [
  {label:'Outfit',value:'Outfit',body:'Outfit,sans-serif',head:'DM Serif Display,serif',preview:'Modern & clean'},
  {label:'Playfair',value:'Playfair Display',body:'Playfair Display,serif',head:'Playfair Display,serif',preview:'Editorial serif'},
  {label:'Inter',value:'Inter',body:'Inter,sans-serif',head:'Inter,sans-serif',preview:'Minimal sans'},
  {label:'Space Grotesk',value:'Space Grotesk',body:'Space Grotesk,sans-serif',head:'Space Grotesk,sans-serif',preview:'Geometric'},
  {label:'Lato',value:'Lato',body:'Lato,sans-serif',head:'Merriweather,serif',preview:'Professional'},
  {label:'Merriweather',value:'Merriweather',body:'Merriweather,serif',head:'Merriweather,serif',preview:'Classic serif'},
];

const BRAND_STYLES = [
  {label:'Default',value:'default'},
  {label:'Classic',value:'classic'},
  {label:'Modern',value:'modern'},
  {label:'Minimal',value:'minimal'},
];

// Default branding
function defaultBranding() {
  return {
    logoData: null,
    logoName: null,
    color: '#1a6b4a',
    font: 'Outfit',
    style: 'default',
  };
}

function getBranding() {
  return profile.branding || defaultBranding();
}

// ═══ APPLY BRANDING TO PAGE ═══
function applyBrandingToPage() {
  const b = getBranding();
  const color = b.color || '#1a6b4a';
  const fontObj = BRAND_FONTS.find(f=>f.value===b.font) || BRAND_FONTS[0];
  const root = document.documentElement;

  // Generate tints from main color
  const tint1 = hexToRgba(color, 0.12);
  const tint2 = hexToRgba(color, 0.22);

  root.style.setProperty('--accent', color);
  root.style.setProperty('--success', color);
  root.style.setProperty('--brand-accent', color);
  root.style.setProperty('--brand-accent2', tint1);
  root.style.setProperty('--brand-accent3', tint2);
  root.style.setProperty('--brand-font', fontObj.body);
  root.style.setProperty('--brand-heading-font', fontObj.head);
  renderPreview();
  renderBrandingBar();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ═══ BRANDING UI — PROFILE PAGE ═══
function renderBrandingUI() {
  const b = getBranding();

  // Color palette
  const palette = document.getElementById('color-palette');
  if(palette) {
    palette.innerHTML = BRAND_COLORS.map(c=>`
      <div class="color-swatch ${b.color===c.value?'selected':''}" 
           style="background:${c.value}" title="${c.label}"
           onclick="setBrandColor('${c.value}')"></div>
    `).join('');
    // set custom picker
    const advSwatch = document.getElementById('advanced-picker-swatch');
    const advNative = document.getElementById('advanced-color-native');
    const advHexInp = document.getElementById('advanced-color-hex-input');
    if(advSwatch) advSwatch.style.background = b.color || '#1a6b4a';
    if(advNative) advNative.value = b.color || '#1a6b4a';
    if(advHexInp) advHexInp.value = b.color || '#1a6b4a';
  }

  // Font grid
  const fontGrid = document.getElementById('font-grid');
  if(fontGrid) {
    fontGrid.innerHTML = BRAND_FONTS.map(f=>`
      <div class="font-option ${b.font===f.value?'selected':''}" onclick="setBrandFont('${f.value}')">
        <div class="font-option-name">${f.label}</div>
        <div class="font-option-preview" style="font-family:'${f.value}'">${f.preview}</div>
      </div>
    `).join('');
  }

  // Style grid
  const styleGrid = document.getElementById('style-grid');
  if(styleGrid) {
    styleGrid.innerHTML = BRAND_STYLES.map(s=>`
      <div class="style-option ${b.style===s.value?'selected':''}" onclick="setBrandStyle('${s.value}')">
        <div class="style-thumb" style="background:${s.value==='modern'?'var(--brand-accent)':'#f5f4f0'}">
          <div style="width:70%;text-align:left;padding:4px 6px">
            <div style="height:6px;border-radius:2px;background:${s.value==='modern'?'rgba(255,255,255,.6)':'var(--border2)'};margin-bottom:3px"></div>
            <div style="height:4px;border-radius:2px;background:${s.value==='modern'?'rgba(255,255,255,.35)':'var(--border)'};margin-bottom:3px;width:60%"></div>
            ${s.value==='classic'?`<div style="height:2px;background:var(--brand-accent);margin-top:2px"></div>`:''}
            ${s.value==='minimal'?`<div style="height:2px;background:#0f0f0f;margin-top:2px"></div>`:''}
          </div>
        </div>
        <div class="style-label">${s.label}</div>
      </div>
    `).join('');
  }

  // Logo
  renderLogoPreview(b);
}

function renderLogoPreview(b) {
  const uploadArea = document.getElementById('logo-drop-area');
  const previewWrap = document.getElementById('logo-preview-wrap');
  const previewImg = document.getElementById('logo-preview-img');
  const filenameEl = document.getElementById('logo-filename');
  if(!uploadArea || !previewWrap) return;
  if(b && b.logoData) {
    uploadArea.style.display = 'none';
    previewWrap.style.display = 'flex';
    previewImg.src = b.logoData;
    if(filenameEl) filenameEl.textContent = b.logoName || 'logo';
  } else {
    uploadArea.style.display = 'block';
    previewWrap.style.display = 'none';
  }
}

// ═══ BRANDING BAR (inline in builder) ═══
function renderBrandingBar() {
  const b = getBranding();

  // Mini logo area
  const logoArea = document.getElementById('branding-bar-logo-area');
  if(logoArea) {
    if(b.logoData) {
      logoArea.innerHTML = `<img src="${b.logoData}" class="branding-logo-thumb" title="Logo" onclick="showTab('profile');setTimeout(()=>document.getElementById('branding-anchor').scrollIntoView({behavior:'smooth'}),100)">`;
    } else {
      logoArea.innerHTML = `<span class="branding-logo-add" onclick="showTab('profile');setTimeout(()=>document.getElementById('branding-anchor').scrollIntoView({behavior:'smooth'}),100)">+ Add logo</span>`;
    }
  }

  // Mini swatches
  const miniSwatches = document.getElementById('mini-swatches');
  if(miniSwatches) {
    miniSwatches.innerHTML = BRAND_COLORS.map(c=>`
      <div class="branding-mini-swatch ${b.color===c.value?'selected':''}" 
           style="background:${c.value}" title="${c.label}"
           onclick="setBrandColor('${c.value}')"></div>
    `).join('');
  }

  // Mini fonts
  const miniFonts = document.getElementById('mini-fonts');
  if(miniFonts) {
    miniFonts.innerHTML = `<div style="display:flex;gap:4px">` +
      BRAND_FONTS.map(f=>`<button class="branding-mini-font ${b.font===f.value?'selected':''}" onclick="setBrandFont('${f.value}')">${f.label}</button>`).join('') +
    `</div>`;
  }

  // Mini styles
  const miniStyles = document.getElementById('mini-styles');
  if(miniStyles) {
    miniStyles.innerHTML = `<div style="display:flex;gap:4px">` +
      BRAND_STYLES.map(s=>`<button class="branding-mini-style ${b.style===s.value?'selected':''}" onclick="setBrandStyle('${s.value}')">${s.label}</button>`).join('') +
    `</div>`;
  }
}

// ═══ BRANDING SETTERS ═══
function setBrandColor(color) {
  if(!profile.branding) profile.branding = defaultBranding();
  profile.branding.color = color;
  saveBrandingLocal();
  applyBrandingToPage();
  renderBrandingUI();
}

function setCustomColor(color) {
  const hexEl = document.getElementById('custom-color-hex');
  if(hexEl) hexEl.textContent = color;
  if(!profile.branding) profile.branding = defaultBranding();
  profile.branding.color = color;
  // deselect swatches
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
  saveBrandingLocal();
  applyBrandingToPage();
  renderBrandingBar();
}

// ═══ ADVANCED COLOR PICKER ═══
let advPickerHue = 160;
let advPickerSaturation = 0.75;
let advPickerValue = 0.42;
let advPickerDragging = null;

function toggleAdvancedPicker() {
  const panel = document.getElementById('advanced-picker-panel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) {
    const b = getBranding();
    const color = b.color || '#1a6b4a';
    const [h,s,v] = hexToHsv(color);
    advPickerHue = h; advPickerSaturation = s; advPickerValue = v;
    document.getElementById('advanced-color-native').value = color;
    document.getElementById('advanced-color-hex-input').value = color;
    document.getElementById('adv-preview-swatch').style.background = color;
    document.getElementById('adv-preview-label').textContent = color;
    drawAdvancedCanvas();
    drawHueStrip();
    updateAdvThumb();
    updateHueThumb();
  }
}

function drawAdvancedCanvas() {
  const canvas = document.getElementById('adv-picker-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const hueColor = `hsl(${advPickerHue},100%,50%)`;
  const whiteGrad = ctx.createLinearGradient(0,0,w,0);
  whiteGrad.addColorStop(0,'#fff');
  whiteGrad.addColorStop(1,hueColor);
  ctx.fillStyle = whiteGrad;
  ctx.fillRect(0,0,w,h);
  const blackGrad = ctx.createLinearGradient(0,0,0,h);
  blackGrad.addColorStop(0,'transparent');
  blackGrad.addColorStop(1,'#000');
  ctx.fillStyle = blackGrad;
  ctx.fillRect(0,0,w,h);
}

function drawHueStrip() {
  const canvas = document.getElementById('adv-hue-strip');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0,0,canvas.width,0);
  for(let i=0;i<=360;i+=30) g.addColorStop(i/360,`hsl(${i},100%,50%)`);
  ctx.fillStyle=g;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function updateAdvThumb() {
  const canvas = document.getElementById('adv-picker-canvas');
  const thumb = document.getElementById('adv-picker-thumb');
  if(!canvas||!thumb) return;
  const x = advPickerSaturation * canvas.width;
  const y = (1 - advPickerValue) * canvas.height;
  thumb.style.left = (x-6)+'px';
  thumb.style.top = (y-6)+'px';
  thumb.style.background = hsvToHex(advPickerHue, advPickerSaturation, advPickerValue);
}

function updateHueThumb() {
  const canvas = document.getElementById('adv-hue-strip');
  const thumb = document.getElementById('adv-hue-thumb');
  if(!canvas||!thumb) return;
  thumb.style.left = (advPickerHue/360 * canvas.width - 6)+'px';
}

function onAdvancedNativeChange(hex) {
  document.getElementById('advanced-color-hex-input').value = hex;
  document.getElementById('adv-preview-swatch').style.background = hex;
  document.getElementById('adv-preview-label').textContent = hex;
  const [h,s,v] = hexToHsv(hex);
  advPickerHue=h; advPickerSaturation=s; advPickerValue=v;
  drawAdvancedCanvas(); updateAdvThumb(); updateHueThumb();
}

function onAdvancedHexInput(val) {
  if(/^#[0-9a-fA-F]{6}$/.test(val)) {
    document.getElementById('advanced-color-native').value = val;
    document.getElementById('adv-preview-swatch').style.background = val;
    document.getElementById('adv-preview-label').textContent = val;
    const [h,s,v] = hexToHsv(val);
    advPickerHue=h; advPickerSaturation=s; advPickerValue=v;
    drawAdvancedCanvas(); updateAdvThumb(); updateHueThumb();
  }
}

function applyAdvancedColor() {
  const hex = hsvToHex(advPickerHue, advPickerSaturation, advPickerValue);
  setBrandColor(hex);
  // Update swatch appearance
  const swatch = document.getElementById('advanced-picker-swatch');
  if(swatch) swatch.style.background = hex;
  document.getElementById('advanced-picker-panel').style.display='none';
  // deselect other swatches since this is custom
  document.querySelectorAll('.color-swatch:not(#advanced-picker-swatch)').forEach(s=>s.classList.remove('selected'));
}

function hexToHsv(hex) {
  let r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d!==0){
    if(max===r) h=((g-b)/d)%6;
    else if(max===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h=Math.round(h*60); if(h<0)h+=360;
  }
  const s=max===0?0:d/max;
  return [h, s, max];
}

function hsvToHex(h, s, v) {
  const f=(n,k=(n+h/60)%6)=>v-v*s*Math.max(Math.min(k,4-k,1),0);
  const r=Math.round(f(5)*255), g=Math.round(f(3)*255), b=Math.round(f(1)*255);
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function initAdvancedPicker() {
  const canvas = document.getElementById('adv-picker-canvas');
  const hueCanvas = document.getElementById('adv-hue-strip');
  if (!canvas || !hueCanvas) return;

  function getPos(e, el) {
    const rect = el.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.max(0, Math.min(clientX - rect.left, el.width)),
      y: Math.max(0, Math.min(clientY - rect.top, el.height))
    };
  }

  function onCanvasDrag(e) {
    const {x,y} = getPos(e, canvas);
    advPickerSaturation = x / canvas.width;
    advPickerValue = 1 - y / canvas.height;
    const hex = hsvToHex(advPickerHue, advPickerSaturation, advPickerValue);
    document.getElementById('advanced-color-native').value = hex;
    document.getElementById('advanced-color-hex-input').value = hex;
    document.getElementById('adv-preview-swatch').style.background = hex;
    document.getElementById('adv-preview-label').textContent = hex;
    updateAdvThumb();
  }

  function onHueDrag(e) {
    const {x} = getPos(e, hueCanvas);
    advPickerHue = Math.round(x / hueCanvas.width * 360);
    drawAdvancedCanvas(); updateAdvThumb(); updateHueThumb();
    const hex = hsvToHex(advPickerHue, advPickerSaturation, advPickerValue);
    document.getElementById('advanced-color-native').value = hex;
    document.getElementById('advanced-color-hex-input').value = hex;
    document.getElementById('adv-preview-swatch').style.background = hex;
    document.getElementById('adv-preview-label').textContent = hex;
  }

  canvas.addEventListener('mousedown', e=>{advPickerDragging='canvas';onCanvasDrag(e);});
  canvas.addEventListener('touchstart', e=>{advPickerDragging='canvas';onCanvasDrag(e);},{passive:true});
  hueCanvas.addEventListener('mousedown', e=>{advPickerDragging='hue';onHueDrag(e);});
  hueCanvas.addEventListener('touchstart', e=>{advPickerDragging='hue';onHueDrag(e);},{passive:true});

  document.addEventListener('mousemove', e=>{
    if(advPickerDragging==='canvas') onCanvasDrag(e);
    else if(advPickerDragging==='hue') onHueDrag(e);
  });
  document.addEventListener('touchmove', e=>{
    if(advPickerDragging==='canvas') onCanvasDrag(e.touches[0]);
    else if(advPickerDragging==='hue') onHueDrag(e.touches[0]);
  },{passive:true});
  document.addEventListener('mouseup', ()=>advPickerDragging=null);
  document.addEventListener('touchend', ()=>advPickerDragging=null);

  // Close picker when clicking outside
  document.addEventListener('click', e=>{
    const wrap = document.getElementById('advanced-color-picker-wrap');
    const panel = document.getElementById('advanced-picker-panel');
    if(panel && panel.style.display!=='none' && wrap && !wrap.contains(e.target)) {
      panel.style.display='none';
    }
  });
}

function setBrandFont(font) {
  if(!profile.branding) profile.branding = defaultBranding();
  profile.branding.font = font;
  saveBrandingLocal();
  applyBrandingToPage();
  renderBrandingUI();
}

function setBrandStyle(style) {
  if(!profile.branding) profile.branding = defaultBranding();
  profile.branding.style = style;
  saveBrandingLocal();
  renderPreview();
  renderBrandingUI();
  renderBrandingBar();
}

function saveBrandingLocal() {
  localStorage.setItem('profile', JSON.stringify(profile));
}

// ═══ LOGO UPLOAD ═══
function handleLogoUpload(event) {
  const file = event.target.files[0];
  if(!file) return;
  if(file.size > 2*1024*1024) { toast('Logo must be under 2MB.'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    if(!profile.branding) profile.branding = defaultBranding();
    profile.branding.logoData = e.target.result;
    profile.branding.logoName = file.name;
    saveBrandingLocal();
    renderLogoPreview(profile.branding);
    renderBrandingBar();
    renderPreview();
    toast('Logo uploaded!');
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  if(!profile.branding) profile.branding = defaultBranding();
  profile.branding.logoData = null;
  profile.branding.logoName = null;
  saveBrandingLocal();
  renderLogoPreview(profile.branding);
  renderBrandingBar();
  renderPreview();
  toast('Logo removed.');
  // reset file input
  const inp = document.getElementById('logo-file-input');
  if(inp) inp.value='';
}

// ═══ ORIGINAL APP CODE (unchanged) ═══
const sym = ()=>document.getElementById('inv-currency')?.value||profile.currency||'₹';
const fmt = (n,s)=>(s||sym())+parseFloat(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});

async function api(path, options = {}){
  const res = await fetch(path, {
    credentials:'same-origin',
    headers:{'Content-Type':'application/json', ...(options.headers||{})},
    ...options
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Request failed');
  return data;
}

function setSyncStatus(text, state){
  const el=document.getElementById('sync-status');
  if(!el)return;
  el.textContent=text;
  el.classList.toggle('syncing',state==='syncing');
  el.classList.toggle('error',state==='error');
}

function showAuthMode(mode){
  authMode=mode;
  document.getElementById('login-tab').classList.toggle('active',mode==='login');
  document.getElementById('register-tab').classList.toggle('active',mode==='register');
  document.getElementById('auth-name-field').classList.toggle('is-hidden',mode==='login');
  document.getElementById('auth-phone-field').classList.toggle('is-hidden',mode==='login');
  document.getElementById('auth-email-otp-btn').style.display=mode==='register'?'':'none';
  document.getElementById('auth-submit').textContent=mode==='login'?'Login':'Create account';
  document.getElementById('auth-error').textContent='';
  // reset OTP state
  otpVerified={email:false,phone:false};
  ['email','phone'].forEach(t=>{
    const row=document.getElementById(`auth-${t}-otp-row`);
    const status=document.getElementById(`auth-${t}-otp-status`);
    if(row)row.style.display='none';
    if(status){status.textContent='';status.className='otp-status';}
  });
}

async function submitAuth(){
  const errorEl=document.getElementById('auth-error');
  errorEl.textContent='';
  const email=document.getElementById('auth-email').value.trim();
  const phone=document.getElementById('auth-phone')?.value.trim()||'';

  if(authMode==='register'){
    if(!otpVerified.email){
      errorEl.textContent='Please verify your email address with an OTP before continuing.';
      return;
    }
  }

  const payload={
    name:document.getElementById('auth-name').value.trim(),
    email,
    password:document.getElementById('auth-password').value,
    phone
  };
  try{
    const result=await api(authMode==='login'?'/api/auth/login':'/api/auth/register',{method:'POST',body:JSON.stringify(payload)});
    await completeAuth(result.user,result.data);
  }catch(err){errorEl.textContent=err.message;}
}

async function sendAuthOtp(type){
  const target=type==='email'
    ? document.getElementById('auth-email').value.trim()
    : document.getElementById('auth-phone').value.trim();
  if(!target){
    document.getElementById('auth-error').textContent=`Please enter your ${type} first.`;
    return;
  }
  const btn=document.getElementById(`auth-${type}-otp-btn`);
  btn.disabled=true;btn.textContent='Sending…';
  try{
    const res=await api('/api/auth/send-otp',{method:'POST',body:JSON.stringify({type,target})});
    document.getElementById(`auth-${type}-otp-row`).style.display='block';
    const status=document.getElementById(`auth-${type}-otp-status`);
    status.className='otp-status otp-info';
    // In production the OTP is sent via email/SMS; in demo it's returned
    status.textContent=`OTP sent! (Demo: ${res.otp})`;
    btn.textContent='Resend';
  }catch(err){
    document.getElementById('auth-error').textContent=err.message;
    btn.textContent='Send OTP';
  }finally{btn.disabled=false;}
}

async function verifyAuthOtp(type){
  const target=type==='email'
    ? document.getElementById('auth-email').value.trim()
    : document.getElementById('auth-phone').value.trim();
  const code=document.getElementById(`auth-${type}-otp-input`).value.trim();
  const status=document.getElementById(`auth-${type}-otp-status`);
  try{
    await api('/api/auth/verify-otp',{method:'POST',body:JSON.stringify({type,target,code})});
    otpVerified[type]=true;
    status.className='otp-status otp-success';
    status.textContent=`✓ ${type.charAt(0).toUpperCase()+type.slice(1)} verified!`;
    document.getElementById(`auth-${type}-otp-input`).disabled=true;
  }catch(err){
    status.className='otp-status otp-error';
    status.textContent=err.message;
  }
}

async function bootApp(){
  try{
    const result=await api('/api/auth/me');
    if(!result.user){document.getElementById('auth-screen').classList.add('visible');return;}
    const cloud=await api('/api/sync');
    await completeAuth(result.user,cloud);
  }catch(err){document.getElementById('auth-screen').classList.add('visible');}
}

async function completeAuth(user,cloudData){
  currentUser=user;
  document.getElementById('auth-screen').classList.remove('visible');
  document.getElementById('nav-avatar').title='Signed in as '+user.email;
  const cloudEmpty=!cloudData?.profile?.name&&!(cloudData?.invoices||[]).length;
  const localHasData=!!profile.name||invoices.length>0;
  if(cloudEmpty&&localHasData){await syncNow(true);}
  else{applyCloudData(cloudData||{profile:{},invoices:[]});}
  checkFirstLaunch();
}

function applyCloudData(data){
  profile=data.profile||{};
  invoices=Array.isArray(data.invoices)?data.invoices:[];
  localStorage.setItem('profile',JSON.stringify(profile));
  localStorage.setItem('invoices',JSON.stringify(invoices));
  setSyncStatus(data.updatedAt?'Synced':'Ready');
}

function scheduleSync(){if(!currentUser)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow(),350);}

async function syncNow(silent=false){
  if(!currentUser)return;
  try{
    if(!silent)setSyncStatus('Syncing','syncing');
    const data=await api('/api/sync',{method:'PUT',body:JSON.stringify({profile,invoices})});
    setSyncStatus(data.updatedAt?'Synced':'Ready');
  }catch(err){setSyncStatus('Sync error','error');if(!silent)toast('Cloud sync failed: '+err.message);}
}

async function logout(){
  try{await api('/api/auth/logout',{method:'POST',body:'{}'});}catch(err){}
  currentUser=null;
  localStorage.removeItem('profile');localStorage.removeItem('invoices');
  profile={};invoices=[];
  document.getElementById('main-app').classList.remove('visible');
  document.getElementById('onboarding').classList.remove('visible');
  document.getElementById('auth-screen').classList.add('visible');
}

function initials(name){
  if(!name)return'?';
  const parts=name.trim().split(' ');
  return parts.length>=2?(parts[0][0]+parts[parts.length-1][0]).toUpperCase():name.slice(0,2).toUpperCase();
}

function checkFirstLaunch(){
  if(!profile.name){prefillOnboardingFromAccount();document.getElementById('onboarding').classList.add('visible');}
  else{launchApp();}
}

function prefillOnboardingFromAccount(){
  if(!currentUser)return;
  const fields={'ob-name':currentUser.name,'ob-email':currentUser.email};
  Object.entries(fields).forEach(([id,value])=>{const el=document.getElementById(id);if(el&&!el.value.trim()&&value)el.value=value;});
}

function launchApp(){
  document.getElementById('onboarding').classList.remove('visible');
  document.getElementById('main-app').classList.add('visible');
  const bizName=profile.name||'';
  document.getElementById('nav-business-name').textContent=bizName?'— '+bizName:'';

  // Avatar: show logo thumbnail if available
  const avatar = document.getElementById('nav-avatar');
  const b = getBranding();
  if(b.logoData) {
    avatar.innerHTML = `<img src="${b.logoData}" style="width:100%;height:100%;object-fit:contain;padding:2px">`;
  } else {
    avatar.textContent = initials(bizName);
  }

  applyBrandingToPage();
  loadProfilePage();
  renderDashboard();
  resetBuilder();
  renderItemsTable();
  renderPreview();
  renderBrandingBar();
}

function clearErr(el){el.classList.remove('error');}
function requireField(id){const el=document.getElementById(id);if(!el)return true;const ok=!!String(el.value||'').trim();el.classList.toggle('error',!ok);return ok;}
function requireEmail(id){const el=document.getElementById(id);if(!el)return true;const value=el.value.trim();const ok=!!value&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);el.classList.toggle('error',!ok);return ok;}

function obNext(){
  if(obStep===1){
    const name=document.getElementById('ob-name');const email=document.getElementById('ob-email');
    let ok=true;
    if(!name.value.trim()){name.classList.add('error');ok=false;}
    if(!email.value.trim()||!email.value.includes('@')){email.classList.add('error');ok=false;}
    if(!ok)return;obGoTo(2);
  }else if(obStep===2){
    const ok=requireField('ob-tax')&requireField('ob-currency');
    if(!ok)return;obGoTo(3);renderSummary();
  }else if(obStep===3){completeOnboarding();}
}

function obBack(){if(obStep>1)obGoTo(obStep-1);}

function obGoTo(step){
  document.getElementById('ob-page-'+obStep).classList.remove('active');
  obStep=step;
  document.getElementById('ob-page-'+obStep).classList.add('active');
  document.getElementById('ob-progress-text').textContent='Step '+obStep+' of 3';
  document.getElementById('ob-back-btn').classList.toggle('is-hidden',obStep<=1);
  document.getElementById('ob-next-btn').textContent=obStep===3?'Get Started →':'Continue →';
  for(let i=1;i<=3;i++){document.getElementById('step-dot-'+i).classList.toggle('done',i<=obStep);}
}

function renderSummary(){
  const rows=[['Name',document.getElementById('ob-name').value||'—'],['Email',document.getElementById('ob-email').value||'—'],['Phone',document.getElementById('ob-phone').value||'—'],['Currency',document.getElementById('ob-currency').value],['Tax',document.getElementById('ob-taxlabel').value+' @ '+document.getElementById('ob-taxrate').value+'%']];
  document.getElementById('ob-summary').innerHTML=rows.map(([k,v])=>`<span class="summary-key">${k}</span><strong>${v}</strong><br>`).join('');
}

function completeOnboarding(){
  profile={
    name:document.getElementById('ob-name').value.trim(),
    email:document.getElementById('ob-email').value.trim(),
    phone:document.getElementById('ob-phone').value.trim(),
    address:document.getElementById('ob-address').value.trim(),
    tax:document.getElementById('ob-tax').value.trim(),
    currency:document.getElementById('ob-currency').value,
    taxRate:document.getElementById('ob-taxrate').value,
    taxLabel:document.getElementById('ob-taxlabel').value,
    terms:document.getElementById('ob-terms').value.trim(),
    web:document.getElementById('ob-web').value.trim(),
    profileComplete:true,
    branding: defaultBranding()
  };
  localStorage.setItem('profile',JSON.stringify(profile));
  scheduleSync();
  launchApp();
  toast('Welcome to InvoiceFlow, '+profile.name.split(' ')[0]+'!');
}

function showTab(t){
  document.querySelectorAll('.app').forEach(a=>a.classList.remove('visible'));
  document.querySelectorAll('.nav-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('visible');
  document.querySelectorAll('.nav-tab').forEach(b=>{
    if((t==='dashboard'&&b.textContent.includes('Dashboard'))||(t==='builder'&&b.textContent.includes('New'))||(t==='profile'&&b.textContent.includes('Profile')))b.classList.add('active');
  });
  if(t==='dashboard')renderDashboard();
  if(t==='profile'){loadProfilePage();renderBrandingUI();}
}

function extractDialCode(value){const match=String(value||'').match(/\+\d{1,4}/);return match?match[0]:'';}
function splitPhone(phone){const raw=String(phone||'').trim();if(!raw)return{code:'',number:''};const match=raw.match(/^(\+\d{1,4})\s*(.*)$/);if(!match)return{code:'',number:raw};return{code:match[1],number:match[2]||''};}
function joinPhone(){const code=extractDialCode(document.getElementById('p-phone-code').value);const number=document.getElementById('p-phone').value.trim();return [code,number].filter(Boolean).join(' ');}

function loadProfilePage(){
  const map={name:'p-name',email:'p-email',phone:'p-phone',address:'p-address',tax:'p-tax',web:'p-web',currency:'p-currency',taxRate:'p-taxrate',taxLabel:'p-taxlabel',terms:'p-terms'};
  Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id);if(el)el.value=profile[k]||'';});
  const phone=splitPhone(profile.phone||'');
  document.getElementById('p-phone-code').value=phone.code;
  document.getElementById('p-phone').value=phone.number;
  renderCatalog();
}

function saveProfile(){
  const ok=requireField('p-tax')&requireField('p-currency');
  if(!ok){toast('Please complete the required profile fields.');return;}
  const map={name:'p-name',email:'p-email',phone:'p-phone',address:'p-address',tax:'p-tax',web:'p-web',currency:'p-currency',taxRate:'p-taxrate',taxLabel:'p-taxlabel',terms:'p-terms'};
  Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id);if(el)profile[k]=el.value;});
  profile.phone=joinPhone();
  profile.profileComplete=true;
  // preserve branding
  if(!profile.branding) profile.branding = defaultBranding();
  localStorage.setItem('profile',JSON.stringify(profile));
  scheduleSync();
  document.getElementById('nav-business-name').textContent=profile.name?'— '+profile.name:'';
  const avatar = document.getElementById('nav-avatar');
  const b = getBranding();
  if(b.logoData){avatar.innerHTML=`<img src="${b.logoData}" style="width:100%;height:100%;object-fit:contain;padding:2px">`;}
  else{avatar.textContent=initials(profile.name);}
  applyBrandingToPage();
  toast('Profile saved!');
}

function addItem(){items.push({desc:'',qty:1,rate:0,discount:0,taxRate:parseFloat(document.getElementById('inv-default-tax')?.value||0)});renderItemsTable();}
function removeItem(i){if(items.length>1){items.splice(i,1);renderItemsTable();}}
function setItemValue(i,key,value){
  if(!items[i])return;
  items[i][key]=key==='desc'?value:(parseFloat(value)||0);
  updateItemAmount(i);
  renderPreview();
}
function updateItemAmount(i){
  const cell=document.getElementById('item-amount-'+i);
  if(!cell||!items[i])return;
  const it=items[i];
  const base=(it.qty||0)*(it.rate||0);
  const afterDisc=base*(1-(it.discount||0)/100);
  const withTax=afterDisc*(1+(it.taxRate||0)/100);
  cell.textContent=sym()+withTax.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function renderItemsTable(){
  const tb=document.getElementById('items-body');
  if(!tb)return;
  tb.innerHTML=items.map((it,i)=>`<tr>
    <td class="col-desc">
      <div class="item-search-wrap">
        <input value="${escHtml(it.desc)}" placeholder="Search catalog or type…"
               oninput="setItemValue(${i},'desc',this.value);showItemDropdown(${i},this.value)"
               onfocus="showItemDropdown(${i},this.value)"
               onblur="hideItemDropdown(${i})"
               onkeydown="handleItemSearchKey(event,${i})">
        <div class="item-search-dropdown" id="item-dropdown-${i}" style="display:none"></div>
      </div>
    </td>
    <td class="col-qty"><input type="number" value="${it.qty}" min="1" oninput="setItemValue(${i},'qty',this.value)"></td>
    <td class="col-rate"><input type="number" value="${it.rate}" min="0" placeholder="0" oninput="setItemValue(${i},'rate',this.value)"></td>
    <td class="col-disc"><input type="number" value="${it.discount||0}" min="0" max="100" placeholder="0" oninput="setItemValue(${i},'discount',this.value)" title="Discount %"><span class="col-pct">%</span></td>
    <td class="col-tax"><input type="number" value="${it.taxRate||0}" min="0" max="100" placeholder="0" oninput="setItemValue(${i},'taxRate',this.value)" title="Tax %"><span class="col-pct">%</span></td>
    <td class="col-amt" id="item-amount-${i}">${(()=>{const base=(it.qty||0)*(it.rate||0);const afterDisc=base*(1-(it.discount||0)/100);const withTax=afterDisc*(1+(it.taxRate||0)/100);return sym()+withTax.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});})()}</td>
    <td class="col-del"><button class="del-btn" onclick="removeItem(${i})">✕</button></td>
  </tr>`).join('');
  renderPreview();
}

function calcTotals(){
  let sub=0,totalDisc=0,totalTax=0,total=0;
  items.forEach(it=>{
    const base=(it.qty||0)*(it.rate||0);
    const discAmt=base*(it.discount||0)/100;
    const afterDisc=base-discAmt;
    const taxAmt=afterDisc*(it.taxRate||0)/100;
    sub+=base;
    totalDisc+=discAmt;
    totalTax+=taxAmt;
    total+=afterDisc+taxAmt;
  });
  return{sub,disc:totalDisc,taxAmt:totalTax,total};
}

function renderTotals(t){
  const s=sym();
  return`<div class="totals-row"><span>Subtotal</span><span class="amount">${s}${t.sub.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
${t.disc>0?`<div class="totals-row"><span>Discount</span><span class="amount">−${s}${t.disc.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
${t.taxAmt>0?`<div class="totals-row"><span>Tax</span><span class="amount">${s}${t.taxAmt.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
<div class="totals-row grand"><span>Total</span><span class="amount">${s}${t.total.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`;
}

function renderPreview(){
  const t=calcTotals();
  const tb=document.getElementById('totals-box');
  if(tb)tb.innerHTML=renderTotals(t);
  const s=sym();
  const c={name:document.getElementById('client-name')?.value||'Client Name',email:document.getElementById('client-email')?.value||'',address:document.getElementById('client-address')?.value||''};
  const invNo=document.getElementById('inv-number')?.value||'INV-001';
  const date=document.getElementById('inv-date')?.value||'';
  const due=document.getElementById('inv-due')?.value||'';
  const notes=document.getElementById('inv-notes')?.value||'';
  const area=document.getElementById('invoice-preview-area');
  if(!area)return;

  const b = getBranding();
  const styleClass = b.style && b.style !== 'default' ? `style-${b.style}` : '';
  const fontObj = BRAND_FONTS.find(f=>f.value===b.font)||BRAND_FONTS[0];
  const logoHTML = b.logoData ? `<img src="${b.logoData}" class="inv-logo-img" alt="Logo">` : '';

  area.innerHTML=`<div class="invoice-preview ${styleClass}" style="font-family:'${fontObj.body}'">
    <div class="inv-header">
      <div>
        ${logoHTML}
        <div class="inv-brand">${profile.name||'Your Business'}</div>
        <div class="inv-from">${profile.email?profile.email+'<br>':''}${profile.phone?profile.phone+'<br>':''}${profile.address?profile.address.replace(/\n/g,'<br>'):''}</div>
      </div>
      <div class="inv-meta">
        <div class="inv-number">${invNo}</div>
        <div class="inv-dates">${date?'Issued: '+formatDate(date)+'<br>':''}${due?'Due: '+formatDate(due):''}</div>
      </div>
    </div>
    <div class="inv-parties">
      <div><div class="inv-party-label">From</div><div class="inv-party-name">${profile.name||'—'}</div><div class="inv-party-detail">${profile.email||''}</div></div>
      <div><div class="inv-party-label">Bill To</div><div class="inv-party-name">${c.name||'—'}</div><div class="inv-party-detail">${c.email?c.email+'<br>':''}${c.address.replace(/\n/g,'<br>')}</div></div>
    </div>
    <table class="inv-items">
      <thead><tr><th>Description</th><th class="text-right">Qty</th><th class="text-right">Rate</th><th class="text-right">Disc%</th><th class="text-right">Tax%</th><th class="text-right">Amount</th></tr></thead>
      <tbody>${items.map(it=>{const base=(it.qty||0)*(it.rate||0);const afterDisc=base*(1-(it.discount||0)/100);const lineTotal=afterDisc*(1+(it.taxRate||0)/100);return`<tr>
        <td class="desc">${it.desc||'—'}</td>
        <td class="text-right">${it.qty}</td>
        <td class="text-right mono-cell">${s}${(it.rate||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td class="text-right mono-cell">${it.discount||0}%</td>
        <td class="text-right mono-cell">${it.taxRate||0}%</td>
        <td class="text-right mono-cell">${s}${lineTotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      </tr>`;}).join('')}</tbody>
    </table>
    <div class="inv-totals">
      <div class="inv-total-row"><span>Subtotal</span><span class="v">${s}${t.sub.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
      ${t.disc>0?`<div class="inv-total-row"><span>Discount</span><span class="v">−${s}${t.disc.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
      ${t.taxAmt>0?`<div class="inv-total-row"><span>Tax</span><span class="v">${s}${t.taxAmt.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
      <div class="inv-total-grand"><span>Total</span><span class="v">${s}${t.total.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
    </div>
    ${notes?`<div class="inv-notes"><div class="inv-notes-label">Notes</div><div class="inv-notes-text">${notes}</div></div>`:''}
  </div>`;
}

function formatDate(d){if(!d)return'';const[y,m,day]=d.split('-');const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return`${day} ${months[parseInt(m)-1]} ${y}`;}

function getStatus(inv){
  if(inv.status==='Paid')return'Paid';
  if(inv.status==='Draft')return'Draft';
  if(inv.dueDate&&new Date(inv.dueDate)<new Date()&&inv.status!=='Paid')return'Overdue';
  return inv.status||'Draft';
}

function saveInvoice(status){
  if(!validateInvoice())return;
  const t=calcTotals();
  const inv={
    id:editingId||('INV-'+String(Date.now()).slice(-6)),
    number:document.getElementById('inv-number').value,
    currency:sym(),date:document.getElementById('inv-date').value,
    dueDate:document.getElementById('inv-due').value,
    clientName:document.getElementById('client-name').value.trim(),
    clientEmail:document.getElementById('client-email').value,
    clientAddress:document.getElementById('client-address').value,
    taxLabel:document.getElementById('tax-label').value,
    notes:document.getElementById('inv-notes').value,
    items:[...items],total:t.total,status,createdAt:new Date().toISOString()
  };
  if(editingId){const idx=invoices.findIndex(i=>i.id===editingId);if(idx>=0)invoices[idx]=inv;}
  else invoices.unshift(inv);
  localStorage.setItem('invoices',JSON.stringify(invoices));
  scheduleSync();
  toast(`Invoice ${status==='Draft'?'saved as draft':'marked as '+status}!`);
  editingId=null;
}

function validateInvoice(){
  const ok=requireField('client-name')&requireEmail('client-email')&requireField('tax-label');
  if(!ok)toast('Please complete the required invoice fields.');
  return !!ok;
}

function resetBuilder(){
  editingId=null;
  const defaultTax=parseFloat(profile.taxRate||18);
  items=[{desc:'',qty:1,rate:0,discount:0,taxRate:defaultTax}];
  document.getElementById('inv-number').value='INV-'+String(invoices.length+1).padStart(3,'0');
  document.getElementById('inv-date').value=new Date().toISOString().split('T')[0];
  const due=new Date();due.setDate(due.getDate()+15);
  document.getElementById('inv-due').value=due.toISOString().split('T')[0];
  ['client-name','client-email','client-address','inv-notes'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('tax-label').value=profile.taxLabel||'GST';
  document.getElementById('inv-currency').value=profile.currency||'₹';
  document.getElementById('inv-notes').value=profile.terms||'';
  renderItemsTable();
}

function editInvoice(id){
  const inv=invoices.find(i=>i.id===id);if(!inv)return;
  editingId=id;items=inv.items.map(it=>({discount:0,taxRate:0,...it}));
  document.getElementById('inv-number').value=inv.number;
  document.getElementById('inv-currency').value=inv.currency||'₹';
  document.getElementById('inv-date').value=inv.date;
  document.getElementById('inv-due').value=inv.dueDate;
  document.getElementById('client-name').value=inv.clientName;
  document.getElementById('client-email').value=inv.clientEmail;
  document.getElementById('client-address').value=inv.clientAddress;
  document.getElementById('tax-label').value=inv.taxLabel||'GST';
  document.getElementById('inv-notes').value=inv.notes;
  renderItemsTable();showTab('builder');
}

function deleteInvoice(id){
  invoices=invoices.filter(i=>i.id!==id);
  localStorage.setItem('invoices',JSON.stringify(invoices));
  scheduleSync();renderDashboard();toast('Invoice deleted.');
}

let modalTarget=null;
function openStatusModal(id){
  modalTarget=id;
  const inv=invoices.find(i=>i.id===id);
  document.getElementById('modal-inv-id').textContent=inv?.number||id;
  document.getElementById('modal-buttons').innerHTML=['Draft','Sent','Paid','Overdue'].map(s=>`<button class="btn ${s===inv?.status?'btn-primary':'btn-ghost'}" onclick="setStatus('${s}')">${s}</button>`).join('');
  document.getElementById('status-modal').classList.add('open');
}
function closeModal(){document.getElementById('status-modal').classList.remove('open');}
function setStatus(s){
  const idx=invoices.findIndex(i=>i.id===modalTarget);
  if(idx>=0)invoices[idx].status=s;
  localStorage.setItem('invoices',JSON.stringify(invoices));
  scheduleSync();closeModal();renderDashboard();toast('Status updated to '+s);
}

function renderDashboard(){
  const total=invoices.reduce((s,i)=>s+i.total,0);
  const outstanding=invoices.filter(i=>i.status!=='Paid').reduce((s,i)=>s+i.total,0);
  const overdue=invoices.filter(i=>getStatus(i)==='Overdue').reduce((s,i)=>s+i.total,0);
  const s=profile.currency||'₹';
  document.getElementById('stat-total').textContent=s+total.toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:0});
  document.getElementById('stat-outstanding').textContent=s+outstanding.toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:0});
  document.getElementById('stat-overdue').textContent=s+overdue.toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:0});
  document.getElementById('stat-count').textContent=invoices.length;
  const dc=document.getElementById('dashboard-content');
  if(!invoices.length){
    dc.innerHTML=`<div class="empty"><div class="empty-icon">📄</div><div class="empty-title">No invoices yet</div><div class="empty-sub">Create your first invoice to get started.</div></div>`;
    return;
  }
  dc.innerHTML=`<table class="inv-table">
    <thead><tr><th>Invoice #</th><th>Client</th><th>Date</th><th>Due</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${invoices.map(inv=>{
      const st=getStatus(inv);
      const bc={Draft:'badge-draft',Sent:'badge-sent',Paid:'badge-paid',Overdue:'badge-overdue'}[st]||'badge-draft';
      return`<tr>
        <td class="mono-strong">${inv.number}</td>
        <td><div class="client-cell-name">${inv.clientName}</div><div class="client-cell-email">${inv.clientEmail||''}</div></td>
        <td>${inv.date?formatDate(inv.date):'—'}</td>
        <td>${inv.dueDate?formatDate(inv.dueDate):'—'}</td>
        <td class="mono-strong">${inv.currency||'₹'}${inv.total.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td><span class="badge ${bc}">${st}</span></td>
        <td><div class="action-btns">
          <button class="btn btn-ghost btn-sm" onclick="editInvoice('${inv.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="openStatusModal('${inv.id}')">Status</button>
          <button class="btn btn-danger btn-sm" onclick="deleteInvoice('${inv.id}')">✕</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function printInvoice(){
  if(!validateInvoice())return;
  const area=document.getElementById('invoice-preview-area');
  if(!area)return;
  const b = getBranding();
  const fontObj = BRAND_FONTS.find(f=>f.value===b.font)||BRAND_FONTS[0];
  const brandColor = b.color || '#1a6b4a';
  const tint1 = hexToRgba(brandColor, 0.12);
  const tint2 = hexToRgba(brandColor, 0.22);
  const w=window.open('','_blank','width=800,height=900');
  const baseUrl=location.href.replace(/[^/]*$/,"");
  w.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
  <base href="${baseUrl}">
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600&family=Playfair+Display:wght@400;600&family=Inter:wght@300;400;500;600&family=Space+Grotesk:wght@300;400;500;600&family=Lato:wght@300;400;700&family=Merriweather:wght@300;400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
  <style>:root{--accent:${brandColor};--brand-accent:${brandColor};--brand-accent2:${tint1};--brand-accent3:${tint2};--brand-font:'${fontObj.body}';--brand-heading-font:'${fontObj.head}'}</style>
  </head><body class="print-window">${area.innerHTML}</body></html>`);
  w.document.close();setTimeout(()=>{w.focus();w.print();},600);
}

function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}

// ═══════════════════════════════════════════════
// ITEM CATALOG
// ═══════════════════════════════════════════════
function getCatalog(){return profile.catalog||[];}

function escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCatalog(){
  const catalog=getCatalog();
  const el=document.getElementById('catalog-list');
  if(!el)return;
  if(!catalog.length){
    el.innerHTML=`<div class="catalog-empty"><strong>No items in your catalog yet</strong>Add your common services or products once — then search and auto-fill them instantly when creating invoices.</div>`;
    return;
  }
  const s=sym();
  el.innerHTML=`<table class="catalog-table">
    <thead><tr>
      <th class="col-cname">Item Name</th>
      <th class="col-cprice">Default Price</th>
      <th class="col-ctax">Tax Rate (%)</th>
      <th class="col-cact"></th>
    </tr></thead>
    <tbody>${catalog.map(item=>`<tr>
      <td class="col-cname"><input value="${escHtml(item.name||'')}" placeholder="e.g. Web Design, Consulting" oninput="updateCatalogItem('${item.id}','name',this.value)"></td>
      <td class="col-cprice"><input type="number" value="${item.price||0}" min="0" step="0.01" placeholder="0" oninput="updateCatalogItem('${item.id}','price',this.value)"></td>
      <td class="col-ctax"><input type="number" value="${item.taxRate!=null?item.taxRate:0}" min="0" max="100" step="0.5" placeholder="0" oninput="updateCatalogItem('${item.id}','taxRate',this.value)"></td>
      <td class="col-cact"><button class="del-btn" onclick="removeCatalogItem('${item.id}')" title="Remove item">✕</button></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function addCatalogItem(){
  if(!profile.catalog)profile.catalog=[];
  const id='cat'+Date.now()+Math.random().toString(36).slice(2,5);
  const defaultTax=parseFloat(profile.taxRate||0);
  profile.catalog.push({id,name:'',price:0,taxRate:defaultTax});
  saveCatalogToProfile();
  renderCatalog();
  setTimeout(()=>{
    const rows=document.querySelectorAll('.catalog-table tbody tr');
    if(rows.length){
      const lastRow=rows[rows.length-1];
      const inp=lastRow.querySelector('input');
      if(inp){
        inp.focus();
        lastRow.scrollIntoView({behavior:'smooth',block:'nearest'});
        lastRow.style.transition='background 0.4s';
        lastRow.style.background='var(--accent3)';
        setTimeout(()=>{lastRow.style.background='';},800);
      }
    }
  },50);
  toast('New item added — fill in the details.');
}

function removeCatalogItem(id){
  if(!profile.catalog)return;
  profile.catalog=profile.catalog.filter(it=>it.id!==id);
  saveCatalogToProfile();
  renderCatalog();
  toast('Item removed from catalog.');
}

function updateCatalogItem(id,key,value){
  if(!profile.catalog)return;
  const item=profile.catalog.find(it=>it.id===id);
  if(!item)return;
  item[key]=key==='name'?String(value):(parseFloat(value)||0);
  saveCatalogToProfile();
}

function saveCatalogToProfile(){
  localStorage.setItem('profile',JSON.stringify(profile));
  scheduleSync();
}

// ═══════════════════════════════════════════════
// LINE ITEM ELASTIC SEARCH AUTOCOMPLETE
// ═══════════════════════════════════════════════
let _dropdownFocusIdx=-1;

function showItemDropdown(rowIdx,query){
  const dropdown=document.getElementById('item-dropdown-'+rowIdx);
  if(!dropdown)return;
  const catalog=getCatalog().filter(it=>it.name&&it.name.trim());
  if(!catalog.length){dropdown.style.display='none';return;}

  const q=(query||'').toLowerCase().trim();
  let matches;
  if(!q){
    // Show top 6 items as a hint when field is empty / just focused
    matches=catalog.slice(0,6);
  } else {
    // Elastic: score by match position (earlier = better) + exact word start bonus
    matches=catalog
      .map(it=>{
        const name=it.name.toLowerCase();
        const idx=name.indexOf(q);
        if(idx<0)return null;
        const score=idx===0?-1:idx; // exact start wins
        return{item:it,score};
      })
      .filter(Boolean)
      .sort((a,b)=>a.score-b.score)
      .slice(0,8)
      .map(x=>x.item);
  }

  if(!matches.length){
    dropdown.innerHTML=`<div class="item-search-no-results">No catalog items match "<em>${escHtml(q)}</em>"</div>`;
    dropdown.style.display='block';
    _dropdownFocusIdx=-1;
    return;
  }

  _dropdownFocusIdx=-1;
  const s=sym();
  dropdown.innerHTML=
    matches.map((item,idx)=>`
      <div class="item-search-result" id="isr-${rowIdx}-${idx}"
           data-idx="${idx}" data-id="${item.id}"
           onmousedown="pickCatalogItem(${rowIdx},'${item.id}')">
        <span class="item-search-result-name">${highlightMatch(item.name,q)}</span>
        <span class="item-search-result-meta">${s}${(item.price||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2})} · ${item.taxRate||0}%</span>
      </div>`).join('')+
    `<div class="item-search-hint">↑↓ navigate · Enter select · Esc close</div>`;
  dropdown.style.display='block';
}

function hideItemDropdown(rowIdx){
  setTimeout(()=>{
    const d=document.getElementById('item-dropdown-'+rowIdx);
    if(d)d.style.display='none';
    _dropdownFocusIdx=-1;
  },160);
}

function handleItemSearchKey(e,rowIdx){
  const dropdown=document.getElementById('item-dropdown-'+rowIdx);
  if(!dropdown||dropdown.style.display==='none')return;
  const results=dropdown.querySelectorAll('.item-search-result');
  if(!results.length)return;

  if(e.key==='ArrowDown'){
    e.preventDefault();
    _dropdownFocusIdx=Math.min(_dropdownFocusIdx+1,results.length-1);
    results.forEach((r,i)=>r.classList.toggle('focused',i===_dropdownFocusIdx));
    results[_dropdownFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _dropdownFocusIdx=Math.max(_dropdownFocusIdx-1,0);
    results.forEach((r,i)=>r.classList.toggle('focused',i===_dropdownFocusIdx));
    results[_dropdownFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter'&&_dropdownFocusIdx>=0){
    e.preventDefault();
    const focused=results[_dropdownFocusIdx];
    if(focused){
      const id=focused.dataset.id;
      if(id)pickCatalogItem(rowIdx,id);
    }
  } else if(e.key==='Escape'){
    dropdown.style.display='none';
    _dropdownFocusIdx=-1;
  }
}

function pickCatalogItem(rowIdx,catalogId){
  const item=getCatalog().find(it=>it.id===catalogId);
  if(!item||!items[rowIdx])return;
  items[rowIdx].desc=item.name;
  items[rowIdx].rate=parseFloat(item.price)||0;
  items[rowIdx].taxRate=parseFloat(item.taxRate)||0;
  // Hide all dropdowns first
  document.querySelectorAll('.item-search-dropdown').forEach(d=>d.style.display='none');
  _dropdownFocusIdx=-1;
  renderItemsTable();
  // Move focus to qty field of that row
  setTimeout(()=>{
    const rows=document.querySelectorAll('#items-body tr');
    if(rows[rowIdx]){const qtyInp=rows[rowIdx].querySelector('.col-qty input');if(qtyInp)qtyInp.focus();}
  },40);
  toast(`Filled: ${item.name}`);
}

function highlightMatch(text,query){
  if(!query)return escHtml(text);
  const lo=text.toLowerCase();
  const idx=lo.indexOf(query.toLowerCase());
  if(idx<0)return escHtml(text);
  return escHtml(text.slice(0,idx))+
    `<strong style="color:var(--accent)">${escHtml(text.slice(idx,idx+query.length))}</strong>`+
    escHtml(text.slice(idx+query.length));
}

bootApp();
initAdvancedPicker();
