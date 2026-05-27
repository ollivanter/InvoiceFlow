let invoices = JSON.parse(localStorage.getItem('invoices')||'[]');
let profile = JSON.parse(localStorage.getItem('profile')||'{}');
let items = [{desc:'',qty:1,rate:0}];
let editingId = null;
let obStep = 1;
let currentUser = null;
let authMode = 'login';
let syncTimer = null;

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
  document.getElementById('auth-submit').textContent=mode==='login'?'Login':'Create account';
  document.getElementById('auth-error').textContent='';
}

async function submitAuth(){
  const errorEl=document.getElementById('auth-error');
  errorEl.textContent='';
  const payload={
    name:document.getElementById('auth-name').value.trim(),
    email:document.getElementById('auth-email').value.trim(),
    password:document.getElementById('auth-password').value
  };
  try{
    const result=await api(authMode==='login'?'/api/auth/login':'/api/auth/register',{
      method:'POST',
      body:JSON.stringify(payload)
    });
    await completeAuth(result.user,result.data);
  }catch(err){
    errorEl.textContent=err.message;
  }
}

async function bootApp(){
  try{
    const result=await api('/api/auth/me');
    if(!result.user){
      document.getElementById('auth-screen').classList.add('visible');
      return;
    }
    const cloud=await api('/api/sync');
    await completeAuth(result.user,cloud);
  }catch(err){
    document.getElementById('auth-screen').classList.add('visible');
  }
}

async function completeAuth(user,cloudData){
  currentUser=user;
  document.getElementById('auth-screen').classList.remove('visible');
  document.getElementById('nav-avatar').title='Signed in as '+user.email;
  const cloudEmpty=!cloudData?.profile?.name&&!(cloudData?.invoices||[]).length;
  const localHasData=!!profile.name||invoices.length>0;
  if(cloudEmpty&&localHasData){
    await syncNow(true);
  }else{
    applyCloudData(cloudData||{profile:{},invoices:[]});
  }
  checkFirstLaunch();
}

function applyCloudData(data){
  profile=data.profile||{};
  invoices=Array.isArray(data.invoices)?data.invoices:[];
  localStorage.setItem('profile',JSON.stringify(profile));
  localStorage.setItem('invoices',JSON.stringify(invoices));
  setSyncStatus(data.updatedAt?'Synced':'Ready');
}

function scheduleSync(){
  if(!currentUser)return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>syncNow(),350);
}

async function syncNow(silent=false){
  if(!currentUser)return;
  try{
    if(!silent)setSyncStatus('Syncing','syncing');
    const data=await api('/api/sync',{
      method:'PUT',
      body:JSON.stringify({profile,invoices})
    });
    setSyncStatus(data.updatedAt?'Synced':'Ready');
  }catch(err){
    setSyncStatus('Sync error','error');
    if(!silent)toast('Cloud sync failed: '+err.message);
  }
}

async function logout(){
  try{await api('/api/auth/logout',{method:'POST',body:'{}'});}catch(err){}
  currentUser=null;
  localStorage.removeItem('profile');
  localStorage.removeItem('invoices');
  profile={};
  invoices=[];
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
  if(!profile.name){
    document.getElementById('onboarding').classList.add('visible');
  } else {
    launchApp();
  }
}

function launchApp(){
  document.getElementById('onboarding').classList.remove('visible');
  document.getElementById('main-app').classList.add('visible');
  const bizName = profile.name||'';
  document.getElementById('nav-business-name').textContent = bizName ? '— '+bizName : '';
  document.getElementById('nav-avatar').textContent = initials(bizName);
  loadProfilePage();
  renderDashboard();
  resetBuilder();
  renderItemsTable();
  renderPreview();
}

function clearErr(el){el.classList.remove('error');}
function requireField(id){
  const el=document.getElementById(id);
  if(!el)return true;
  const ok=!!String(el.value||'').trim();
  el.classList.toggle('error',!ok);
  return ok;
}
function requireEmail(id){
  const el=document.getElementById(id);
  if(!el)return true;
  const value=el.value.trim();
  const ok=!!value&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  el.classList.toggle('error',!ok);
  return ok;
}

function obNext(){
  if(obStep===1){
    const name=document.getElementById('ob-name');
    const email=document.getElementById('ob-email');
    let ok=true;
    if(!name.value.trim()){name.classList.add('error');ok=false;}
    if(!email.value.trim()||!email.value.includes('@')){email.classList.add('error');ok=false;}
    if(!ok)return;
    obGoTo(2);
  } else if(obStep===2){
    const ok=requireField('ob-tax')&requireField('ob-currency');
    if(!ok)return;
    obGoTo(3);
    renderSummary();
  } else if(obStep===3){
    completeOnboarding();
  }
}

function obBack(){
  if(obStep>1)obGoTo(obStep-1);
}

function obGoTo(step){
  document.getElementById('ob-page-'+obStep).classList.remove('active');
  obStep=step;
  document.getElementById('ob-page-'+obStep).classList.add('active');
  document.getElementById('ob-progress-text').textContent='Step '+obStep+' of 3';
  document.getElementById('ob-back-btn').classList.toggle('is-hidden',obStep<=1);
  document.getElementById('ob-next-btn').textContent=obStep===3?'Get Started →':'Continue →';
  for(let i=1;i<=3;i++){
    document.getElementById('step-dot-'+i).classList.toggle('done',i<=obStep);
  }
}

function renderSummary(){
  const rows=[
    ['Name',document.getElementById('ob-name').value||'—'],
    ['Email',document.getElementById('ob-email').value||'—'],
    ['Phone',document.getElementById('ob-phone').value||'—'],
    ['Currency',document.getElementById('ob-currency').value],
    ['Tax',document.getElementById('ob-taxlabel').value+' @ '+document.getElementById('ob-taxrate').value+'%'],
  ];
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
    profileComplete:true
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
    if((t==='dashboard'&&b.textContent.includes('Dashboard'))||
       (t==='builder'&&b.textContent.includes('New'))||
       (t==='profile'&&b.textContent.includes('Profile')))b.classList.add('active');
  });
  if(t==='dashboard')renderDashboard();
  if(t==='profile')loadProfilePage();
}

function countryCodeOptions(){
  return Array.from(document.querySelectorAll('#country-codes option')).map(o=>o.value);
}
function extractDialCode(value){
  const match=String(value||'').match(/\+\d{1,4}/);
  return match?match[0]:'';
}
function splitPhone(phone){
  const raw=String(phone||'').trim();
  if(!raw)return{code:'',number:''};
  const match=raw.match(/^(\+\d{1,4})\s*(.*)$/);
  if(!match)return{code:'',number:raw};
  const option=countryCodeOptions().find(v=>v===match[1])||match[1];
  return{code:option,number:match[2]||''};
}
function joinPhone(){
  const code=extractDialCode(document.getElementById('p-phone-code').value);
  const number=document.getElementById('p-phone').value.trim();
  return [code,number].filter(Boolean).join(' ');
}

function loadProfilePage(){
  const map={name:'p-name',email:'p-email',phone:'p-phone',address:'p-address',tax:'p-tax',web:'p-web',currency:'p-currency',taxRate:'p-taxrate',taxLabel:'p-taxlabel',terms:'p-terms'};
  Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id);if(el)el.value=profile[k]||'';});
  const phone=splitPhone(profile.phone||'');
  document.getElementById('p-phone-code').value=phone.code;
  document.getElementById('p-phone').value=phone.number;
}

function saveProfile(){
  const ok=requireField('p-tax')&requireField('p-currency');
  if(!ok){toast('Please complete the required profile fields.');return;}
  const map={name:'p-name',email:'p-email',phone:'p-phone',address:'p-address',tax:'p-tax',web:'p-web',currency:'p-currency',taxRate:'p-taxrate',taxLabel:'p-taxlabel',terms:'p-terms'};
  Object.entries(map).forEach(([k,id])=>{const el=document.getElementById(id);if(el)profile[k]=el.value;});
  profile.phone=joinPhone();
  profile.profileComplete=true;
  localStorage.setItem('profile',JSON.stringify(profile));
  scheduleSync();
  document.getElementById('nav-business-name').textContent=profile.name?'— '+profile.name:'';
  document.getElementById('nav-avatar').textContent=initials(profile.name);
  toast('Profile saved!');
}

function addItem(){items.push({desc:'',qty:1,rate:0});renderItemsTable();}
function removeItem(i){if(items.length>1){items.splice(i,1);renderItemsTable();}}
function setItemValue(i,key,value){
  if(!items[i])return;
  items[i][key]=key==='desc'?value:(parseFloat(value)||0);
  if(key==='qty'||key==='rate')updateItemAmount(i);
  renderPreview();
}
function updateItemAmount(i){
  const cell=document.getElementById('item-amount-'+i);
  if(!cell||!items[i])return;
  cell.textContent=sym()+((items[i].qty||0)*(items[i].rate||0)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function renderItemsTable(){
  const tb=document.getElementById('items-body');
  if(!tb)return;
  tb.innerHTML=items.map((it,i)=>`<tr>
    <td class="col-desc"><input value="${it.desc}" placeholder="Service description" oninput="setItemValue(${i},'desc',this.value)"></td>
    <td class="col-qty"><input type="number" value="${it.qty}" min="1" oninput="setItemValue(${i},'qty',this.value)"></td>
    <td class="col-rate"><input type="number" value="${it.rate}" min="0" placeholder="0" oninput="setItemValue(${i},'rate',this.value)"></td>
    <td class="col-amt" id="item-amount-${i}">${sym()}${((it.qty||0)*(it.rate||0)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    <td class="col-del"><button class="del-btn" onclick="removeItem(${i})">✕</button></td>
  </tr>`).join('');
  renderPreview();
}

function calcTotals(){
  const sub=items.reduce((s,it)=>s+(it.qty||0)*(it.rate||0),0);
  const disc=parseFloat(document.getElementById('discount')?.value||0)/100;
  const tax=parseFloat(document.getElementById('tax-rate')?.value||0)/100;
  const afterDisc=sub*(1-disc);
  const taxAmt=afterDisc*tax;
  return{sub,disc:sub*disc,taxAmt,total:afterDisc+taxAmt};
}

function renderTotals(t){
  const s=sym(),taxLabel=document.getElementById('tax-label')?.value||'Tax';
  const dv=parseFloat(document.getElementById('discount')?.value||0);
  const tv=parseFloat(document.getElementById('tax-rate')?.value||0);
  return`<div class="totals-row"><span>Subtotal</span><span class="amount">${s}${t.sub.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
${dv>0?`<div class="totals-row"><span>Discount (${dv}%)</span><span class="amount">−${s}${t.disc.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
${tv>0?`<div class="totals-row"><span>${taxLabel} (${tv}%)</span><span class="amount">${s}${t.taxAmt.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
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
  const taxLabel=document.getElementById('tax-label')?.value||'GST';
  const taxRate=parseFloat(document.getElementById('tax-rate')?.value||0);
  const discRate=parseFloat(document.getElementById('discount')?.value||0);
  const area=document.getElementById('invoice-preview-area');
  if(!area)return;
  area.innerHTML=`<div class="invoice-preview">
    <div class="inv-header">
      <div>
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
      <thead><tr><th>Description</th><th class="text-right">Qty</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead>
      <tbody>${items.map(it=>`<tr>
        <td class="desc">${it.desc||'—'}</td>
        <td class="text-right">${it.qty}</td>
        <td class="text-right mono-cell">${s}${(it.rate||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td class="text-right mono-cell">${s}${((it.qty||0)*(it.rate||0)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="inv-totals">
      <div class="inv-total-row"><span>Subtotal</span><span class="v">${s}${t.sub.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
      ${discRate>0?`<div class="inv-total-row"><span>Discount (${discRate}%)</span><span class="v">−${s}${t.disc.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
      ${taxRate>0?`<div class="inv-total-row"><span>${taxLabel} (${taxRate}%)</span><span class="v">${s}${t.taxAmt.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>`:''}
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
    taxRate:parseFloat(document.getElementById('tax-rate').value||0),
    discount:parseFloat(document.getElementById('discount').value||0),
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
  items=[{desc:'',qty:1,rate:0}];
  document.getElementById('inv-number').value='INV-'+String(invoices.length+1).padStart(3,'0');
  document.getElementById('inv-date').value=new Date().toISOString().split('T')[0];
  const due=new Date();due.setDate(due.getDate()+15);
  document.getElementById('inv-due').value=due.toISOString().split('T')[0];
  ['client-name','client-email','client-address','inv-notes'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('tax-rate').value=profile.taxRate||'18';
  document.getElementById('tax-label').value=profile.taxLabel||'GST';
  document.getElementById('inv-currency').value=profile.currency||'₹';
  document.getElementById('inv-notes').value=profile.terms||'';
  document.getElementById('discount').value='0';
  renderItemsTable();
}

function editInvoice(id){
  const inv=invoices.find(i=>i.id===id);if(!inv)return;
  editingId=id;items=inv.items.map(it=>({...it}));
  document.getElementById('inv-number').value=inv.number;
  document.getElementById('inv-currency').value=inv.currency||'₹';
  document.getElementById('inv-date').value=inv.date;
  document.getElementById('inv-due').value=inv.dueDate;
  document.getElementById('client-name').value=inv.clientName;
  document.getElementById('client-email').value=inv.clientEmail;
  document.getElementById('client-address').value=inv.clientAddress;
  document.getElementById('tax-label').value=inv.taxLabel||'GST';
  document.getElementById('tax-rate').value=inv.taxRate;
  document.getElementById('discount').value=inv.discount||0;
  document.getElementById('inv-notes').value=inv.notes;
  renderItemsTable();showTab('builder');
}

function deleteInvoice(id){
  invoices=invoices.filter(i=>i.id!==id);
  localStorage.setItem('invoices',JSON.stringify(invoices));
  scheduleSync();
  renderDashboard();toast('Invoice deleted.');
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
  scheduleSync();
  closeModal();renderDashboard();toast('Status updated to '+s);
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
    dc.innerHTML=`<div class="empty"><div class="empty-icon">📄</div><div class="empty-title">No invoices yet</div><div class="empty-sub">Create your first invoice to get started.<br>It'll be saved locally on your device.</div></div>`;
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
  const w=window.open('','_blank','width=800,height=900');
  const baseUrl=location.href.replace(/[^/]*$/,"");
  w.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
  <base href="${baseUrl}">
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
  </head><body class="print-window">${area.innerHTML}</body></html>`);
  w.document.close();setTimeout(()=>{w.focus();w.print();},600);
}

function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}

bootApp();
