
/* ════════════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════════ */
const API_KEY = '';
const TWELVE_DATA_API_KEY = '';
const INR_RATE   = 83.5;
const START_CASH = 100000;

/* ════════════════════════════════════════════════════════════
   AUTH STORAGE  — all users stored under sv_users (object)
   Each user: { id, name, email, pwHash, createdAt, state }
   state: { cash, holdings, transactions, perfHistory }
   Session: sv_session = userId
════════════════════════════════════════════════════════════ */

function getSession(){ return localStorage.getItem('sv_session')||null; }
function setSession(id){ localStorage.setItem('sv_session',id); }
function clearSession(){ localStorage.removeItem('sv_session'); }

/* Simple hash (not cryptographic — client-side demo only) */
function hashPass(pw){ let h=5381; for(let i=0;i<pw.length;i++){h=((h<<5)+h)+pw.charCodeAt(i)|0;} return (h>>>0).toString(16); }

function freshState(){ return {cash:START_CASH,holdings:{},transactions:[],perfHistory:[]}; }

/* ════════════════════════════════════════════════════════════
   AUTH UI
════════════════════════════════════════════════════════════ */
let CURRENT_USER = null;
let STATE        = null;

function showAuthPanel(panel){
  document.getElementById('panel-signin').style.display = panel==='signin'?'flex':'none';
  document.getElementById('panel-signup').style.display = panel==='signup'?'flex':'none';
  clearAuthErrors();
}

function clearAuthErrors(){
  ['si-global-err','su-global-err'].forEach(id=>{ const el=document.getElementById(id); if(el){el.textContent='';el.classList.remove('show');} });
  ['si-email','si-pass','su-name','su-email','su-pass','su-confirm'].forEach(id=>{ const el=document.getElementById(id); if(el)el.classList.remove('err-field'); });
  ['si-email-err','si-pass-err','su-name-err','su-email-err','su-pass-err','su-confirm-err'].forEach(id=>{ const el=document.getElementById(id); if(el){el.textContent='';el.classList.remove('show');} });
}

function fieldErr(inputId,errId,msg){
  const inp=document.getElementById(inputId); if(inp)inp.classList.add('err-field');
  const err=document.getElementById(errId);   if(err){err.textContent=msg;err.classList.add('show');}
}
function globalErr(id,msg){ const el=document.getElementById(id); if(el){el.textContent=msg;el.classList.add('show');} }

function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function updatePwStrength(pw){
  const bar=document.getElementById('pw-bar'), hint=document.getElementById('pw-hint');
  if(!pw){bar.style.width='0%';hint.textContent='Enter a password';return;}
  let score=0;
  if(pw.length>=6)  score++;
  if(pw.length>=10) score++;
  if(/[A-Z]/.test(pw)) score++;
  if(/[0-9]/.test(pw)) score++;
  if(/[^A-Za-z0-9]/.test(pw)) score++;
  const labels =['Very Weak','Weak','Fair','Good','Strong'];
  const colors =['#ef4444','#f97316','#f59e0b','#22c55e','#22c55e'];
  const widths =['18%','36%','54%','76%','100%'];
  bar.style.width     = widths[score-1]||'0%';
  bar.style.background= colors[score-1]||'#ef4444';
  hint.textContent    = labels[score-1]||'Too short';
}

/* ── SIGN UP ────────────────────────────────────────────── */
async function apiUserRequest(url, options={}){
  const response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Database request failed.');
  return data;
}

async function doSignUp(){
  clearAuthErrors();
  const name    = document.getElementById('su-name').value.trim();
  const email   = document.getElementById('su-email').value.trim().toLowerCase();
  const pw      = document.getElementById('su-pass').value;
  const confirm = document.getElementById('su-confirm').value;
  let ok=true;

  if(!name){fieldErr('su-name','su-name-err','Full name is required.');ok=false;}
  if(!email){fieldErr('su-email','su-email-err','Email is required.');ok=false;}
  else if(!isValidEmail(email)){fieldErr('su-email','su-email-err','Enter a valid email address.');ok=false;}
  if(!pw){fieldErr('su-pass','su-pass-err','Password is required.');ok=false;}
  else if(pw.length<6){fieldErr('su-pass','su-pass-err','Password must be at least 6 characters.');ok=false;}
  else if(!/[^A-Za-z0-9]/.test(pw)){fieldErr('su-pass','su-pass-err','Password must include at least one special character.');ok=false;}
  if(pw&&confirm!==pw){fieldErr('su-confirm','su-confirm-err','Passwords do not match.');ok=false;}
  if(!ok)return;

  const id='u_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  try{
    const user=await apiUserRequest('/api/auth/signup',{
      method:'POST',body:JSON.stringify({id,name,email,password:pw,passwordHash:hashPass(pw)})
    });
    setSession(id);
    bootApp(user);
  }catch(error){globalErr('su-global-err',error.message);}
}

/* ── SIGN IN ────────────────────────────────────────────── */
async function doSignIn(){
  clearAuthErrors();
  const email = document.getElementById('si-email').value.trim().toLowerCase();
  const pw    = document.getElementById('si-pass').value;
  let ok=true;
  if(!email){fieldErr('si-email','si-email-err','Email is required.');ok=false;}
  else if(!isValidEmail(email)){fieldErr('si-email','si-email-err','Enter a valid email address.');ok=false;}
  if(!pw){fieldErr('si-pass','si-pass-err','Password is required.');ok=false;}
  if(!ok)return;

  try{
    const user=await apiUserRequest('/api/auth/signin',{
      method:'POST',body:JSON.stringify({email,passwordHash:hashPass(pw)})
    });
    setSession(user.id);
    bootApp(user);
  }catch(error){globalErr('si-global-err',error.message);}
}

/* ── SIGN OUT ───────────────────────────────────────────── */
function doSignOut(){
  saveCurrentUserState();
  clearSession();
  CURRENT_USER=null; STATE=null;
  closeUserMenu();
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').style.display='none';
  // clear sign-in fields
  document.getElementById('si-email').value='';
  document.getElementById('si-pass').value='';
  showAuthPanel('signin');
}

/* ── BOOT APP ───────────────────────────────────────────── */
function bootApp(user){
  CURRENT_USER = user;
  STATE = user.state;
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').style.display='grid';

  // populate header user UI
  const initials = user.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('hdr-avatar').textContent    = initials;
  document.getElementById('hdr-username').textContent  = user.name.split(' ')[0];
  document.getElementById('ud-name').textContent       = user.name;
  document.getElementById('ud-email').textContent      = user.email;

  // settings page
  document.getElementById('settings-avatar').textContent = initials;
  document.getElementById('settings-name').textContent   = user.name;
  document.getElementById('settings-email').textContent  = user.email;
  document.getElementById('settings-joined').textContent = 'Member since '+new Date(user.createdAt).toLocaleDateString('en-IN',{year:'numeric',month:'long'});

  updateHeaderCash();
  setTimeout(()=>{showPage('dash');renderWatchlist();},0);
}

/* ── Auto-login on page load ────────────────────────────── */
(async function(){
  document.getElementById('app').style.display='none';
  const sid=getSession();
  if(sid){
    try{bootApp(await apiUserRequest('/api/users/'+encodeURIComponent(sid)));}
    catch(error){clearSession();}
  }
})();

/* ── Enter key on auth forms ────────────────────────────── */
document.getElementById('si-pass').addEventListener('keydown',e=>{if(e.key==='Enter')doSignIn();});
document.getElementById('si-email').addEventListener('keydown',e=>{if(e.key==='Enter')doSignIn();});
document.getElementById('su-confirm').addEventListener('keydown',e=>{if(e.key==='Enter')doSignUp();});

/* ════════════════════════════════════════════════════════════
   SAVE USER STATE
════════════════════════════════════════════════════════════ */
function saveCurrentUserState(){
  if(!CURRENT_USER)return;
  apiUserRequest('/api/users/'+encodeURIComponent(CURRENT_USER.id),{
    method:'PUT',body:JSON.stringify({state:STATE})
  }).catch(()=>showToast('Could not save portfolio to local database','err'));
}

/* ════════════════════════════════════════════════════════════
   USER MENU
════════════════════════════════════════════════════════════ */
function toggleUserMenu(){
  const dropdown=document.getElementById('user-dropdown');
  const open=dropdown.classList.toggle('open');
  document.querySelector('.user-btn').setAttribute('aria-expanded',String(open));
}
function closeUserMenu(){
  document.getElementById('user-dropdown').classList.remove('open');
  document.querySelector('.user-btn').setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{
  const wrap=document.getElementById('user-menu-wrap');
  if(wrap&&!wrap.contains(e.target))closeUserMenu();
});

/* ════════════════════════════════════════════════════════════
   SETTINGS ACTIONS
════════════════════════════════════════════════════════════ */
async function changeDisplayName(){
  const newName=document.getElementById('settings-new-name').value.trim();
  if(!newName){showToast('Name cannot be empty','warn');return;}
  try{
    const user=await apiUserRequest('/api/users/'+encodeURIComponent(CURRENT_USER.id),{
      method:'PUT',body:JSON.stringify({name:newName})
    });
    CURRENT_USER=user;
  }catch(error){showToast(error.message,'err');return;}
  const initials=newName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('hdr-avatar').textContent=initials;
  document.getElementById('hdr-username').textContent=newName.split(' ')[0];
  document.getElementById('ud-name').textContent=newName;
  document.getElementById('settings-avatar').textContent=initials;
  document.getElementById('settings-name').textContent=newName;
  document.getElementById('settings-new-name').value='';
  showToast('Display name updated','ok');
}

async function changePassword(){
  const cur    =document.getElementById('settings-cur-pass').value;
  const nw     =document.getElementById('settings-new-pass').value;
  const confirm=document.getElementById('settings-confirm-pass').value;
  if(!cur||!nw||!confirm){showToast('All password fields are required','warn');return;}
  if(CURRENT_USER.pwHash!==hashPass(cur)){showToast('Current password is incorrect','err');return;}
  if(nw.length<6){showToast('New password must be at least 6 characters','warn');return;}
  if(!/[^A-Za-z0-9]/.test(nw)){showToast('New password must include a special character','warn');return;}
  if(nw!==confirm){showToast('New passwords do not match','err');return;}
  try{
    CURRENT_USER=await apiUserRequest('/api/users/'+encodeURIComponent(CURRENT_USER.id),{
      method:'PUT',body:JSON.stringify({password:nw,passwordHash:hashPass(nw)})
    });
  }catch(error){showToast(error.message,'err');return;}
  document.getElementById('settings-cur-pass').value='';
  document.getElementById('settings-new-pass').value='';
  document.getElementById('settings-confirm-pass').value='';
  showToast('Password updated successfully','ok');
}

function confirmDeleteAccount(){ document.getElementById('del-pass').value=''; document.getElementById('del-err').textContent=''; setModalVisibility('del-modal',true); }
async function executeDeleteAccount(){
  const pw=document.getElementById('del-pass').value;
  if(!CURRENT_USER||CURRENT_USER.pwHash!==hashPass(pw)){
    const e=document.getElementById('del-err'); e.textContent='Incorrect password.'; e.classList.add('show'); return;
  }
  try{await apiUserRequest('/api/users/'+encodeURIComponent(CURRENT_USER.id),{method:'DELETE'});}
  catch(error){showToast(error.message,'err');return;}
  clearSession();
  setModalVisibility('del-modal',false);
  doSignOut();
  showToast('Account deleted','warn');
}

/* ════════════════════════════════════════════════════════════
   WATCHLIST
════════════════════════════════════════════════════════════ */
const WATCHLIST=[
  {sym:'AAPL',name:'Apple Inc.'},{sym:'GOOGL',name:'Alphabet Inc.'},{sym:'MSFT',name:'Microsoft Corp.'},
  {sym:'AMZN',name:'Amazon.com Inc.'},{sym:'TSLA',name:'Tesla Inc.'},{sym:'META',name:'Meta Platforms'},
  {sym:'NVDA',name:'NVIDIA Corp.'},{sym:'NFLX',name:'Netflix Inc.'},{sym:'JPM',name:'JPMorgan Chase'},
  {sym:'JNJ',name:'Johnson & Johnson'},{sym:'V',name:'Visa Inc.'},{sym:'PG',name:'Procter & Gamble'},
  {sym:'UNH',name:'UnitedHealth Group'},{sym:'HD',name:'Home Depot Inc.'},{sym:'MA',name:'Mastercard Inc.'},
];
let availableTickers=[],availableTickerBySymbol=new Map(),tickerSearchEntries=[],tickerSuggestionMatches=[],activeTickerSuggestion=-1,tickerSuggestionQuery='';
let userWatchlist=[],watchlistFilter='',marketQuoteCache=new Map();
function renderWatchlist(){
  if(!CURRENT_USER)return;
  const key='sv_watchlist_'+CURRENT_USER.id;
  let saved=null;
  try{saved=localStorage.getItem(key);}
  catch(error){
    console.error('[StockVision] Could not read saved watchlist:',error);
    userWatchlist=WATCHLIST.map(stock=>({...stock}));
    showToast('Browser storage is unavailable. The default watchlist is shown.','err');
    renderSidebarWatchlist();
    renderWatchlistPage();
    renderDashboardWatchlist();
    loadAvailableTickers();
    return;
  }
  if(saved){
    try{
      const parsed=JSON.parse(saved);
      if(!Array.isArray(parsed)||parsed.some(stock=>!stock||typeof stock.sym!=='string'||!/^[A-Z0-9][A-Z0-9._-]{0,14}$/.test(stock.sym)||typeof stock.name!=='string')){
        throw new Error('Saved watchlist has an invalid format.');
      }
      userWatchlist=parsed;
    }catch(error){
      userWatchlist=WATCHLIST.map(stock=>({...stock}));
      showToast('Could not load your saved watchlist. Defaults are shown; your saved data was not changed.','err');
    }
  }else{
    userWatchlist=WATCHLIST.map(stock=>({...stock}));
  }
  renderSidebarWatchlist();
  renderWatchlistPage();
  renderDashboardWatchlist();
  loadAvailableTickers();
}

function saveWatchlist(){
  if(!CURRENT_USER)return;
  try{
    localStorage.setItem('sv_watchlist_'+CURRENT_USER.id,JSON.stringify(userWatchlist));
  }catch(error){
    console.error('[StockVision] Could not save watchlist:',error);
    showToast('Could not save your watchlist in this browser.','err');
  }
}

function renderSidebarWatchlist(){
  const el=document.getElementById('wlList');
  if(!el)return;
  el.innerHTML=userWatchlist.map(stock=>`
    <button class="wi" type="button" id="wi-${escapeHtml(stock.sym)}" data-symbol="${escapeHtml(stock.sym)}" title="${escapeHtml(stock.name)}">
      <span class="wi-l"><span class="wi-sym">${escapeHtml(stock.sym)}</span><span class="wi-name">${escapeHtml(stock.name)}</span></span>
      <span class="wi-r"><span class="wi-chg" id="wchg-${stock.sym}">—</span></span>
    </button>`).join('');
  el.querySelectorAll('.wi[data-symbol]').forEach(button=>{
    button.addEventListener('click',()=>selectStock(button.dataset.symbol));
  });
  userWatchlist.forEach(stock=>{
    const quote=marketQuoteCache.get(stock.sym);
    const change=document.getElementById('wchg-'+stock.sym);
    if(quote&&change){
      change.textContent=(quote.pct>=0?'+':'')+quote.pct.toFixed(2)+'%';
      change.className='wi-chg '+(quote.pct>=0?'up':'dn');
    }
  });
}

function renderWatchlistPage(){
  const tbody=document.getElementById('watchlist-tbody');
  const count=document.getElementById('watchlist-count');
  if(!tbody||!count)return;
  const query=watchlistFilter.trim().toLowerCase();
  const filtered=userWatchlist.filter(stock=>stock.sym.toLowerCase().includes(query)||stock.name.toLowerCase().includes(query));
  count.textContent=userWatchlist.length+' stock'+(userWatchlist.length===1?'':'s');
  if(!filtered.length){
    tbody.innerHTML=`<tr class="empty-row"><td colspan="4">${userWatchlist.length?'No stocks match this search.':'Your watchlist is empty. Add a stock above.'}</td></tr>`;
    return;
  }
  tbody.innerHTML=filtered.map(stock=>{
    const quote=marketQuoteCache.get(stock.sym);
    const last=quote?'$'+quote.price.toFixed(2)+' · '+new Date(quote.updatedAt).toLocaleTimeString():'Not analyzed yet';
    return `<tr><td><button class="ticker-link" type="button" onclick="selectStock('${escapeHtml(stock.sym)}')">${escapeHtml(stock.sym)}</button></td><td>${escapeHtml(stock.name)}</td><td>${escapeHtml(last)}</td><td><button class="watchlist-remove" type="button" onclick="removeWatchlistStock('${escapeHtml(stock.sym)}')">Remove</button></td></tr>`;
  }).join('');
}

function renderDashboardWatchlist(){
  const tbody=document.getElementById('dashboard-watchlist');
  if(!tbody)return;
  if(!userWatchlist.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="4">Your watchlist is empty. Add a stock from Watchlist.</td></tr>';
    return;
  }
  tbody.innerHTML=userWatchlist.slice(0,8).map(stock=>{
    const quote=marketQuoteCache.get(stock.sym);
    const last=quote?'$'+quote.price.toFixed(2)+' · '+new Date(quote.updatedAt).toLocaleTimeString():'Not analyzed yet';
    return `<tr><td><button class="ticker-link" type="button" onclick="selectStock('${escapeHtml(stock.sym)}')">${escapeHtml(stock.sym)}</button></td><td>${escapeHtml(stock.name)}</td><td>${escapeHtml(last)}</td><td><button class="detail-btn" type="button" onclick="selectStock('${escapeHtml(stock.sym)}')">Analyze</button></td></tr>`;
  }).join('');
}

function addWatchlistStock(){
  const input=document.getElementById('watchlist-add-input');
  const entered=input.value.trim();
  if(!entered){showToast('Enter a ticker or company name.','warn');return;}
  const exact=availableTickerBySymbol.get(entered.toUpperCase());
  const nameMatches=availableTickers.filter(stock=>String(stock.name||'').toLowerCase().includes(entered.toLowerCase()));
  if(!exact&&nameMatches.length>1){showToast('Search by ticker or enter a more specific company name.','warn');return;}
  const match=exact||nameMatches[0];
  const symbol=(match?.sym||entered).toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9._-]{0,14}$/.test(symbol)){showToast('Enter a valid ticker symbol.','warn');return;}
  if(userWatchlist.some(stock=>stock.sym===symbol)){showToast(symbol+' is already on your watchlist.','warn');return;}
  userWatchlist.unshift({sym:symbol,name:match?.name||symbol});
  saveWatchlist();
  renderSidebarWatchlist();
  renderWatchlistPage();
  renderDashboardWatchlist();
  input.value='';
  showToast(symbol+' added to your watchlist.','ok');
}

function removeWatchlistStock(symbol){
  userWatchlist=userWatchlist.filter(stock=>stock.sym!==symbol);
  saveWatchlist();
  renderSidebarWatchlist();
  renderWatchlistPage();
  renderDashboardWatchlist();
}

async function loadAvailableTickers(){
  const count=document.getElementById('availableTickerCount');
  if(!count)return;
  const fetchWithTimeout=(request,timeout=12000)=>Promise.race([
    request,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Ticker catalog request timed out')),timeout))
  ]);
  const merged=new Map();
  try{
    const response=await fetchWithTimeout(fetch('/api/twelve/stocks'));
    if(!response.ok)throw new Error(`Ticker catalog request failed (${response.status})`);
    const data=await response.json();
    const rows=Array.isArray(data?.data)?data.data:[];
    rows.forEach(row=>{
      const symbol=String(row.symbol||'').trim().toUpperCase();
      if(symbol)merged.set(symbol,{sym:symbol,name:row.name||row.symbol,exchange:row.exchange||''});
    });
  }catch(error){
    console.warn('[StockVision] Ticker catalog unavailable; showing the default watchlist:',error);
  }

  WATCHLIST.forEach(stock=>{
    if(!merged.has(stock.sym))merged.set(stock.sym,{sym:stock.sym,name:stock.name,exchange:''});
  });
  availableTickers=[...merged.values()].sort((a,b)=>a.sym.localeCompare(b.sym));
  availableTickerBySymbol=new Map(availableTickers.map(stock=>[stock.sym,stock]));
  tickerSearchEntries=availableTickers.map(stock=>({
    stock,
    symbol:stock.sym.toLowerCase(),
    name:String(stock.name||'').toLowerCase()
  }));
  count.textContent=availableTickers.length.toLocaleString()+' tickers available';
  filterAvailableTickers(document.getElementById('ticker').value);
  renderWatchlistPage();
}

function hideTickerSuggestions(){
  const list=document.getElementById('tickerSuggestions');
  if(!list)return;
  list.hidden=true;
  document.getElementById('ticker').setAttribute('aria-expanded','false');
  document.getElementById('ticker').removeAttribute('aria-activedescendant');
  activeTickerSuggestion=-1;
  const count=document.getElementById('availableTickerCount');
  if(availableTickers.length)count.textContent=availableTickers.length.toLocaleString()+' tickers available';
}

function setActiveTickerSuggestion(index){
  const list=document.getElementById('tickerSuggestions');
  const options=list.querySelectorAll('.ticker-suggestion');
  if(!options.length){
    activeTickerSuggestion=-1;
    document.getElementById('ticker').removeAttribute('aria-activedescendant');
    return;
  }
  activeTickerSuggestion=Math.max(0,Math.min(index,options.length-1));
  options.forEach((option,i)=>{
    const active=i===activeTickerSuggestion;
    option.classList.toggle('active',active);
    option.setAttribute('aria-selected',String(active));
  });
  const activeOption=options[activeTickerSuggestion];
  if(activeOption){
    document.getElementById('ticker').setAttribute('aria-activedescendant',activeOption.id);
    activeOption.scrollIntoView({block:'nearest'});
  }
}

function filterAvailableTickers(query){
  const list=document.getElementById('tickerSuggestions');
  const count=document.getElementById('availableTickerCount');
  const normalized=query.trim().toLowerCase();
  list.replaceChildren();
  tickerSuggestionMatches=[];
  activeTickerSuggestion=-1;
  tickerSuggestionQuery=normalized;
  if(!normalized){
    count.textContent=availableTickers.length
      ? availableTickers.length.toLocaleString()+' tickers available'
      : 'Loading stock directory...';
    hideTickerSuggestions();
    return;
  }

  let matchCount=0;
  const preferred=[],otherMatches=[];
  tickerSearchEntries.forEach(entry=>{
    const stock=entry.stock;
    if(!entry.symbol.includes(normalized)&&!entry.name.includes(normalized))return;
    matchCount++;
    const bucket=entry.symbol.startsWith(normalized)||entry.name.startsWith(normalized)?preferred:otherMatches;
    if(bucket.length<8)bucket.push(stock);
  });
  tickerSuggestionMatches=preferred.concat(otherMatches).slice(0,8);
  count.textContent=matchCount.toLocaleString()+' matching ticker'+(matchCount===1?'':'s');

  if(!tickerSuggestionMatches.length){
    const empty=document.createElement('div');
    empty.className='ticker-suggestion-empty';
    empty.textContent='No matching company found. You can still analyze a ticker symbol.';
    list.appendChild(empty);
  }else{
    tickerSuggestionMatches.forEach(stock=>{
      const option=document.createElement('button');
      option.type='button';
      option.className='ticker-suggestion';
      option.id='ticker-suggestion-'+tickerSuggestionMatches.indexOf(stock);
      option.setAttribute('role','option');
      option.setAttribute('aria-selected','false');
      option.dataset.symbol=stock.sym;
      const main=document.createElement('span');
      main.className='ticker-suggestion-main';
      const top=document.createElement('span');
      top.className='ticker-suggestion-top';
      const symbol=document.createElement('span');
      symbol.className='ticker-suggestion-symbol';
      symbol.textContent=stock.sym;
      top.appendChild(symbol);
      if(stock.exchange){
        const exchange=document.createElement('span');
        exchange.className='ticker-suggestion-exchange';
        exchange.textContent=stock.exchange;
        top.appendChild(exchange);
      }
      const name=document.createElement('span');
      name.className='ticker-suggestion-name';
      name.textContent=stock.name||stock.sym;
      main.append(top,name);
      const action=document.createElement('span');
      action.className='ticker-suggestion-action';
      action.textContent='Analyze →';
      option.append(main,action);
      option.addEventListener('click',()=>selectStock(stock.sym));
      list.appendChild(option);
    });
  }
  list.hidden=false;
  document.getElementById('ticker').setAttribute('aria-expanded','true');
}
function highlightWatchItem(sym){ document.querySelectorAll('.wi').forEach(e=>e.classList.remove('sel')); const el=document.getElementById('wi-'+sym); if(el)el.classList.add('sel'); }

/* ════════════════════════════════════════════════════════════
   CLOCK & MARKET
════════════════════════════════════════════════════════════ */
function updateClock(){
  const now=new Date(); document.getElementById('clock').textContent=now.toLocaleTimeString('en-US',{hour12:false});
  const et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const day=et.getDay(),mins=et.getHours()*60+et.getMinutes();
  const open=day>=1&&day<=5&&mins>=570&&mins<960;
  document.getElementById('market-label').textContent=open?'Market Open':'Market Closed';
  const dot=document.querySelector('.dot');
  dot.style.background=open?'var(--green)':'var(--red)'; dot.style.boxShadow=open?'0 0 7px var(--green)':'0 0 7px var(--red)';
}
setInterval(updateClock,1000); updateClock();

/* ════════════════════════════════════════════════════════════
   PAGE ROUTING
════════════════════════════════════════════════════════════ */
function showPage(name){
  const page=document.getElementById('page-'+name);
  if(!page)return;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  page.classList.add('active');
  document.querySelectorAll('.nav[data-page]').forEach(nav=>{
    const active=nav.dataset.page===name;
    nav.classList.toggle('active',active);
    if(active)nav.setAttribute('aria-current','page');
    else nav.removeAttribute('aria-current');
  });
  document.getElementById('main').scrollTop=0;
  if(name==='dash')         refreshDashboard();
  if(name==='portfolio')    refreshPortfolioPage();
  if(name==='transactions') refreshTransactionsPage();
  if(name==='watchlist')    renderWatchlistPage();
}
document.querySelectorAll('.nav[data-page]').forEach(el=>el.addEventListener('click',()=>showPage(el.dataset.page)));
function toggleSidebar(){
  const app=document.getElementById('app');
  const button=document.getElementById('sidebar-toggle');
  const collapsed=app.classList.toggle('sidebar-collapsed');
  button.setAttribute('aria-expanded',String(!collapsed));
  button.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');
  button.title=collapsed?'Expand sidebar':'Collapse sidebar';
  button.textContent=collapsed?'›':'‹';
}

/* ════════════════════════════════════════════════════════════
   ANALYTICS STATE
════════════════════════════════════════════════════════════ */
let stockChart=null,volumeChart=null,currentSymbol=null,currentPrice=0,currentPrices=[],currentDates=[],currentVolumes=[],currentTab='1M',tradeSide='buy',quoteRequestId=0,chartRequestId=0;

function selectStock(sym){
  hideTickerSuggestions();
  showPage('analytics');
  document.getElementById('ticker').value=sym;
  highlightWatchItem(sym);
  runAnalysis();
}

/* ════════════════════════════════════════════════════════════
   ANALYSIS FLOW
════════════════════════════════════════════════════════════ */
function checkApiError(data){
  // Alpha Vantage sends rate-limit / error info in these fields
  if(data['Note'])         return 'API rate limit reached (25 req/day on free plan). Try again tomorrow or upgrade your API key.';
  if(data['Information'])  return 'API rate limit reached. Free tier allows 25 requests/day.';
  if(data['Error Message'])return 'Invalid ticker symbol or API error: '+data['Error Message'];
  return null;
}

let alphaRequestQueue=Promise.resolve();
let lastAlphaRequestStartedAt=0;
function fetchAlpha(url){
  const request=alphaRequestQueue.then(async()=>{
    const wait=Math.max(0,1100-(Date.now()-lastAlphaRequestStartedAt));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    lastAlphaRequestStartedAt=Date.now();
    return fetch(url);
  });
  alphaRequestQueue=request.then(()=>undefined,()=>undefined);
  return request;
}

function runAnalysis(){
  const tickerInput=document.getElementById('ticker');
  const entered=tickerInput.value.trim();
  const exactMatch=availableTickerBySymbol.get(entered.toUpperCase());
  const searchMatch=tickerSuggestionQuery===entered.toLowerCase()
    ? tickerSuggestionMatches[activeTickerSuggestion>=0?activeTickerSuggestion:0]
    : null;
  const sym=(exactMatch||searchMatch)?.sym||entered.toUpperCase();
  if(!sym){showToast('Please enter a ticker symbol.','warn');return;}
  if(!/^[A-Z0-9][A-Z0-9._-]{0,14}$/.test(sym)){showToast('Enter a valid ticker symbol.','warn');return;}
  tickerInput.value=sym;
  hideTickerSuggestions();
  const requestId=++quoteRequestId;
  chartRequestId++;
  const stock=availableTickerBySymbol.get(sym);
  document.getElementById('id-name').textContent=stock?.name||'';
  currentSymbol=sym;currentPrice=0;currentDates=[];currentPrices=[];currentVolumes=[];
  document.querySelector('#welcome .wlc-title').textContent='Select a stock to analyze & trade';
  document.querySelector('#welcome .wlc-sub').textContent='Pick a ticker from the watchlist, or type a custom symbol. You have '+fmtINR(STATE.cash)+' virtual cash available.';
  document.getElementById('pred-p').textContent='—';
  document.getElementById('pred-c').textContent='—';
  document.getElementById('pred-meta').textContent='Waiting for real price history.';
  highlightWatchItem(sym); setLoading(true); hideApiErrorBanner(); showAnalyticsDashboard(false);

  fetch(`/api/twelve/quote?symbol=${encodeURIComponent(sym)}`)
    .then(r=>{
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    })
    .then(data=>{
      if(requestId!==quoteRequestId)return;
      if(data.status==='error'||data.code&&(!data.close||data.close==='')){
        throw new Error(data.message||'Ticker unavailable in Twelve Data');
      }
      const price=parseFloat(data.close);
      if(!Number.isFinite(price)){
        throw new Error('No price returned for '+sym);
      }
      const change=parseFloat(data.change);
      const pct=parseFloat(data.percent_change);
      const previousRaw=parseFloat(data.previous_close);
      const previous=Number.isFinite(previousRaw)?previousRaw:Number.isFinite(change)?price-change:price;
      hideApiErrorBanner();
      currentPrice=price;
      document.getElementById('id-meta').textContent='Twelve Data · Paper Trading';
      renderQuote(sym,price,Number.isFinite(change)?change:price-previous,Number.isFinite(pct)?pct:(price-previous)/previous*100,parseFloat(data.high),parseFloat(data.low),parseInt(data.volume),previous);
      setLoading(false);
      showAnalyticsDashboard(true);
      loadChart(sym);
    })
    .catch(err=>{
      if(requestId!==quoteRequestId)return;
      console.warn('[StockVision] Twelve Data quote unavailable, trying Alpha Vantage:',err.message);
      fetchAlpha(`/api/alpha?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}`)
        .then(r=>{
          if(!r.ok) throw new Error('HTTP '+r.status);
          return r.json();
        })
        .then(data=>{
          if(requestId!==quoteRequestId)return;
          const apiErr=checkApiError(data);
          if(apiErr)throw new Error(apiErr);
          const q=data['Global Quote'];
          if(!q||!q['05. price']){
            throw new Error('Symbol "'+sym+'" was not found by either market-data provider.');
          }
          const price=parseFloat(q['05. price']);
          const change=parseFloat(q['09. change']);
          const pct=parseFloat(q['10. change percent'].replace('%',''));
          const high=parseFloat(q['03. high']);
          const low=parseFloat(q['04. low']);
          const prevCls=parseFloat(q['08. previous close']);
          if(!Number.isFinite(price)||!Number.isFinite(change)||!Number.isFinite(pct)){
            throw new Error('Alpha Vantage returned an incomplete quote.');
          }
          hideApiErrorBanner();
          currentPrice=price;
          document.getElementById('id-meta').textContent='Alpha Vantage · Paper Trading';
          renderQuote(sym,price,change,pct,high,low,parseInt(q['06. volume']),prevCls);
          setLoading(false);
          showAnalyticsDashboard(true);
          loadChart(sym);
        })
        .catch(fallbackErr=>{
          if(requestId!==quoteRequestId)return;
          console.error('[StockVision] Market data fetch failed:',fallbackErr);
          showQuoteUnavailable(sym,fallbackErr.message||'Market data is temporarily unavailable.');
        });
    });
}

/* ════════════════════════════════════════════════════════════
   RENDER QUOTE
════════════════════════════════════════════════════════════ */
function fmtINR(n){return '₹'+Math.abs(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
const fmtUSD=n=>'$'+n.toFixed(2);
function signed(n){return (n>=0?'+':'-')+'₹'+Math.abs(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function renderQuote(sym,price,change,pct,high,low,volume,prevCls){
  if(!Number.isFinite(prevCls))prevCls=price-change;
  if(!Number.isFinite(volume))volume=null;
  if(!Number.isFinite(high))high=null;
  if(!Number.isFinite(low))low=null;
  marketQuoteCache.set(sym,{price,change,pct,high,low,volume,prevClose:prevCls,updatedAt:Date.now()});
  const up=change>=0, fmtP=p=>(p>=0?'+':'')+p.toFixed(2)+'%';
  document.getElementById('id-sym').textContent=sym;
  document.getElementById('id-name').textContent=availableTickerBySymbol.get(sym)?.name||'';
  document.getElementById('id-price').textContent=fmtUSD(price);
  document.getElementById('id-price').style.color=up?'var(--green)':'var(--red)';
  const chg=document.getElementById('id-chg');
  chg.textContent=(up?'+':'')+change.toFixed(2)+' ('+fmtP(pct)+')'; chg.className='id-chg '+(up?'up':'dn');
  document.getElementById('id-inr').textContent='₹'+(price*INR_RATE).toFixed(2)+' INR  ·  Change: '+(up?'+':'')+'₹'+(change*INR_RATE).toFixed(2);
  document.getElementById('mc-price').textContent=fmtUSD(price); document.getElementById('mc-price').style.color='var(--t1)';
  const chgEl=document.getElementById('mc-change'); chgEl.textContent=(up?'+':'')+change.toFixed(2); chgEl.style.color=up?'var(--green)':'var(--red)';
  document.getElementById('mc-change-sub').textContent=fmtP(pct)+' vs prev close';
  document.getElementById('mc-high').textContent=high===null?'—':fmtUSD(high); document.getElementById('mc-low').textContent=low===null?'—':fmtUSD(low);
  document.getElementById('mc-prev-close').textContent=fmtUSD(prevCls);
  document.getElementById('mc-volume').textContent=volume===null?'—':volume.toLocaleString('en-US');
  let badge,cls,desc;
  if(pct>2){badge='STRONG BUY';cls='sig-buy';desc='Strong upward momentum — ideal entry point';}
  else if(pct>.5){badge='BUY';cls='sig-buy';desc='Positive trend — good entry opportunity';}
  else if(pct<-2){badge='SELL';cls='sig-sell';desc='Declining trend — consider reducing position';}
  else if(pct<-.5){badge='WATCH';cls='sig-hold';desc='Minor decline — monitor for further movement';}
  else{badge='HOLD';cls='sig-hold';desc='Stable price — maintain current position';}
  const sigEl=document.getElementById('sig-badge'); sigEl.textContent=badge; sigEl.className='sig-badge '+cls;
  document.getElementById('sig-desc').textContent=desc;
  renderSidebarWatchlist();renderWatchlistPage();renderDashboardWatchlist();
  updateTradeCashDisplay(); updateOrderSummary();
}

/* ════════════════════════════════════════════════════════════
   CHART
════════════════════════════════════════════════════════════ */
function loadChart(sym){
  const requestId=++chartRequestId;
  const loader=document.getElementById('cloader');
  document.getElementById('chartError').hidden=true;
  document.getElementById('volumeEmpty').hidden=false;
  loader.classList.remove('hidden');
  if(stockChart){stockChart.destroy();stockChart=null;}
  if(volumeChart){volumeChart.destroy();volumeChart=null;}
  fetch(`/api/twelve/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=260`)
    .then(r=>{
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    })
    .then(data=>{
      if(requestId!==chartRequestId||sym!==currentSymbol)return;
      if(data.status==='error'||!Array.isArray(data.values)||!data.values.length)throw new Error(data.message||'No Twelve Data chart values');
      const rows=[...data.values].reverse().map(value=>({
        date:value.datetime,price:Number(value.close),volume:Number(value.volume)
      })).filter(row=>row.date&&Number.isFinite(row.price));
      if(!rows.length)throw new Error('Twelve Data returned no valid price history.');
      setChartRows(sym,rows);
    })
    .catch(error=>{
      if(requestId!==chartRequestId||sym!==currentSymbol)return;
      console.warn('[StockVision] Twelve Data chart unavailable, trying Alpha Vantage:',error.message);
      loadAlphaVantageChart(sym,requestId);
    });
}

function loadAlphaVantageChart(sym,requestId){
  fetchAlpha(`/api/alpha?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(sym)}&outputsize=compact`)
    .then(r=>{
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    })
    .then(data=>{
      if(requestId!==chartRequestId||sym!==currentSymbol)return;
      const apiErr=checkApiError(data);
      if(apiErr)throw new Error(apiErr);
      const series=data['Time Series (Daily)'];
      if(!series||!Object.keys(series).length)throw new Error('No Alpha Vantage daily history was returned.');
      const rows=Object.keys(series).sort().map(date=>({
        date,price:Number(series[date]['4. close']),volume:Number(series[date]['5. volume'])
      })).filter(row=>Number.isFinite(row.price));
      if(!rows.length)throw new Error('Alpha Vantage returned no valid price history.');
      setChartRows(sym,rows);
    })
    .catch(error=>{
      if(requestId!==chartRequestId||sym!==currentSymbol)return;
      console.error('[StockVision] Chart fetch failed:',error);
      showChartUnavailable('Price history is unavailable from both market-data providers.');
    });
}

function setChartRows(sym,rows){
  if(rows.length<2){
    showChartUnavailable('At least two valid daily closes are required to draw this chart.');
    return;
  }
  currentDates=rows.map(row=>row.date);
  currentPrices=rows.map(row=>row.price);
  currentVolumes=rows.map(row=>row.volume);
  const{d,p,v}=sliceData(currentTab);
  drawChart(sym,d,p);
  drawVolumeChart(d,v);
  renderPrediction(currentPrices);
  document.getElementById('cloader').classList.add('hidden');
}

function showChartUnavailable(message){
  document.getElementById('cloader').classList.add('hidden');
  document.getElementById('chartErrorText').textContent=message;
  document.getElementById('chartError').hidden=false;
  document.getElementById('volumeEmpty').hidden=false;
  if(stockChart){stockChart.destroy();stockChart=null;}
  if(volumeChart){volumeChart.destroy();volumeChart=null;}
}

function sliceData(tab){
  const length=currentDates.length;
  const count=tab==='1D'?1:tab==='1W'?5:tab==='1M'?22:tab==='3M'?66:tab==='1Y'?252:length;
  return{d:currentDates.slice(-count),p:currentPrices.slice(-count),v:currentVolumes.slice(-count)};
}
function setTab(btn,tab){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); btn.classList.add('active'); currentTab=tab;
  if(currentSymbol&&currentPrices.length){
    const{d,p,v}=sliceData(tab);
    drawChart(currentSymbol,d,p);
    drawVolumeChart(d,v);
    renderPrediction(currentPrices);
  }
}
function drawChart(sym,dates,prices){
  if(!prices.length)return;
  const ctx=document.getElementById('stockChart').getContext('2d'); if(stockChart)stockChart.destroy();
  const up=prices[prices.length-1]>=prices[0],color=up?'#22c55e':'#ef4444',fill=up?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)';
  const hasTrend=prices.length>1,trend=hasTrend?prices[prices.length-1]-prices[prices.length-2]:0,pred=prices[prices.length-1]+trend;
  const datasets=[{label:sym+' Close',data:hasTrend?[...prices,null]:prices,borderColor:color,backgroundColor:fill,borderWidth:2,pointRadius:hasTrend?0:3,pointHoverRadius:4,fill:true,tension:.35,spanGaps:false}];
  if(hasTrend)datasets.push({label:'Trend estimate',data:[...Array(prices.length).fill(null),pred],borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,.2)',borderWidth:0,pointRadius:7,pointHoverRadius:9,pointBackgroundColor:'#f59e0b',pointBorderColor:'#0d1117',pointBorderWidth:2,fill:false});
  stockChart=new Chart(ctx,{type:'line',data:{labels:hasTrend?[...dates,'Next']:dates,datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{labels:{color:'#8b9bbd',font:{size:11},boxWidth:10,padding:16}},tooltip:{backgroundColor:'#1c2333',borderColor:'#21303f',borderWidth:1,titleColor:'#e2e8f0',bodyColor:'#8b9bbd',padding:10,callbacks:{label:c=>' '+c.dataset.label+': $'+(c.parsed.y!=null?c.parsed.y.toFixed(2):'—')}}},
    scales:{x:{ticks:{color:'#3d5068',maxTicksLimit:6,font:{size:10},maxRotation:0},grid:{color:'rgba(33,48,63,.7)',drawBorder:false}},y:{ticks:{color:'#3d5068',font:{size:10},callback:v=>'$'+v.toFixed(0)},grid:{color:'rgba(33,48,63,.7)',drawBorder:false},position:'right'}}}});
}
function drawVolumeChart(dates,volumes){
  if(volumeChart){volumeChart.destroy();volumeChart=null;}
  const valid=volumes.map((volume,index)=>({date:dates[index],volume})).filter(row=>Number.isFinite(row.volume)&&row.volume>=0);
  if(!valid.length){
    document.getElementById('volumeEmpty').hidden=false;
    return;
  }
  document.getElementById('volumeEmpty').hidden=true;
  volumeChart=new Chart(document.getElementById('volumeChart').getContext('2d'),{
    type:'bar',
    data:{labels:valid.map(row=>row.date),datasets:[{label:'Volume',data:valid.map(row=>row.volume),backgroundColor:'rgba(16,185,129,.55)',borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>' Volume: '+Number(context.parsed.y).toLocaleString('en-US')}}},
      scales:{x:{display:false,grid:{display:false}},y:{display:false,grid:{display:false}}}}
  });
}
function renderPrediction(prices){
  if(prices.length<2)return;
  const last=prices[prices.length-1],prev=prices[prices.length-2],trend=last-prev,pred=last+trend,pct=(pred-last)/last*100,up=pred>=last;
  document.getElementById('pred-p').textContent='$'+pred.toFixed(2); document.getElementById('pred-p').style.color=up?'var(--green)':'var(--red)';
  const pc=document.getElementById('pred-c'); pc.textContent=(up?'+':'')+pct.toFixed(2)+'%'; pc.className=up?'up':'dn';
  document.getElementById('pred-meta').textContent='One-step linear extrapolation from the two most recent closes. This estimate is not a calibrated forecast.';
}

/* ════════════════════════════════════════════════════════════
   TRADE PANEL
════════════════════════════════════════════════════════════ */
function switchTradeSide(side){
  tradeSide=side;
  document.getElementById('ttab-buy').className='trade-tab'+(side==='buy'?' buy-active':'');
  document.getElementById('ttab-sell').className='trade-tab'+(side==='sell'?' sell-active':'');
  document.getElementById('exec-btn').className='exec-btn '+(side==='buy'?'buy':'sell');
  document.getElementById('exec-btn').textContent='Review '+(side==='buy'?'BUY':'SELL')+' Order';
  updateOrderSummary();
}
function updateTradeCashDisplay(){
  const el=document.getElementById('trade-cash-disp'); if(el)el.textContent=fmtINR(STATE.cash);
  const wlc=document.getElementById('wlc-cash'); if(wlc)wlc.textContent=fmtINR(STATE.cash);
}
function updateOrderSummary(){
  const qty=parseInt(document.getElementById('trade-qty').value)||0;
  const sumEl=document.getElementById('order-summary'),execBtn=document.getElementById('exec-btn');
  if(!currentPrice||!currentSymbol||qty<=0){sumEl.style.display='none';return;}
  const total=qty*currentPrice*INR_RATE; sumEl.style.display='flex';
  document.getElementById('os-price').textContent=fmtINR(currentPrice*INR_RATE);
  document.getElementById('os-qty').textContent=qty+' shares';
  document.getElementById('os-total').textContent=fmtINR(total);
  if(tradeSide==='buy'){
    const after=STATE.cash-total;
    document.getElementById('os-after-label').textContent='Cash after buy';
    document.getElementById('os-after').textContent=fmtINR(after); document.getElementById('os-after').style.color=after>=0?'var(--green)':'var(--red)';
    execBtn.disabled=after<0;
  } else {
    const held=(STATE.holdings[currentSymbol]||{qty:0}).qty,after=STATE.cash+total;
    document.getElementById('os-after-label').textContent='Cash after sell';
    document.getElementById('os-after').textContent=fmtINR(after); document.getElementById('os-after').style.color='var(--green)';
    execBtn.disabled=qty>held;
  }
}

/* ════════════════════════════════════════════════════════════
   CONFIRM MODAL
════════════════════════════════════════════════════════════ */
function openConfirmModal(){
  const qty=parseInt(document.getElementById('trade-qty').value)||0;
  if(!qty||qty<=0){showToast('Enter a valid quantity','warn');return;}
  const total=qty*currentPrice*INR_RATE;
  if(tradeSide==='buy'&&total>STATE.cash){showToast('Insufficient cash for this order','err');return;}
  if(tradeSide==='sell'){const h=STATE.holdings[currentSymbol];if(!h||h.qty<qty){showToast('You do not hold enough shares to sell','err');return;}}
  document.getElementById('m-sym').textContent=currentSymbol;
  document.getElementById('m-action').textContent=tradeSide.toUpperCase(); document.getElementById('m-action').style.color=tradeSide==='buy'?'var(--green)':'var(--red)';
  document.getElementById('m-qty').textContent=qty+' shares';
  document.getElementById('m-price').textContent=fmtINR(currentPrice*INR_RATE);
  document.getElementById('m-total').textContent=fmtINR(total);
  const cb=document.getElementById('modal-confirm-btn'); cb.textContent='Confirm '+tradeSide.toUpperCase(); cb.className='modal-confirm '+(tradeSide==='buy'?'buy':'sell');
  document.getElementById('modal-title').textContent='Confirm '+tradeSide.toUpperCase()+' Order';
  setModalVisibility('modal-overlay',true);
}
function closeModal(){setModalVisibility('modal-overlay',false);}

/* ════════════════════════════════════════════════════════════
   EXECUTE TRADE
════════════════════════════════════════════════════════════ */
function executeTrade(){
  closeModal();
  const qty=parseInt(document.getElementById('trade-qty').value)||0;
  const priceINR=currentPrice*INR_RATE,total=qty*priceINR;
  const ts=new Date().toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'});
  if(tradeSide==='buy'){
    if(total>STATE.cash){showToast('Insufficient cash','err');return;}
    STATE.cash-=total;
    if(!STATE.holdings[currentSymbol])STATE.holdings[currentSymbol]={qty:0,avgCost:0};
    const h=STATE.holdings[currentSymbol];
    h.avgCost=(h.qty*h.avgCost+qty*priceINR)/(h.qty+qty); h.qty+=qty;
    STATE.transactions.unshift({type:'BUY',sym:currentSymbol,qty,price:priceINR,total,cashAfter:STATE.cash,ts});
    showToast('✅ Bought '+qty+' × '+currentSymbol+' for '+fmtINR(total),'ok');
  } else {
    const h=STATE.holdings[currentSymbol];
    if(!h||h.qty<qty){showToast('Insufficient shares','err');return;}
    STATE.cash+=total; h.qty-=qty; if(h.qty===0)delete STATE.holdings[currentSymbol];
    STATE.transactions.unshift({type:'SELL',sym:currentSymbol,qty,price:priceINR,total,cashAfter:STATE.cash,ts});
    showToast('✅ Sold '+qty+' × '+currentSymbol+' for '+fmtINR(total),'ok');
  }
  STATE.perfHistory.push({ts:new Date().toISOString().split('T')[0],val:calcPortfolioValue()});
  if(STATE.perfHistory.length>60)STATE.perfHistory=STATE.perfHistory.slice(-60);
  saveCurrentUserState(); document.getElementById('trade-qty').value='';
  updateOrderSummary(); updateTradeCashDisplay(); updateHeaderCash(); refreshDashboardCharts();
}

/* ════════════════════════════════════════════════════════════
   PORTFOLIO CALC
════════════════════════════════════════════════════════════ */
function calcPortfolioValue(){ let t=0; Object.values(STATE.holdings).forEach(h=>t+=h.qty*h.avgCost); return STATE.cash+t; }
function calcInvested(){       let t=0; Object.values(STATE.holdings).forEach(h=>t+=h.qty*h.avgCost); return t; }
function calcMarketPortfolioValue(){
  let value=STATE.cash;
  for(const [sym,holding] of Object.entries(STATE.holdings)){
    const quote=marketQuoteCache.get(sym);
    if(!quote)return null;
    value+=holding.qty*quote.price*INR_RATE;
  }
  return value;
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD REFRESH
════════════════════════════════════════════════════════════ */
let perfChartInst=null,allocChartInst=null;
function refreshDashboard(){
  const invested=calcInvested(),total=calcMarketPortfolioValue(),pnl=total===null?null:total-START_CASH,pnlPct=pnl===null?null:pnl/START_CASH*100,numH=Object.keys(STATE.holdings).length;
  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  s('kpi-total',total===null?'Unavailable':fmtINR(total));s('kpi-cash',fmtINR(STATE.cash));s('kpi-invested',fmtINR(invested));s('kpi-holdings',numH);
  const pe=document.getElementById('kpi-pnl');if(pe){pe.textContent=pnl===null?'—':signed(pnl);pe.style.color=pnl===null?'var(--t2)':pnl>=0?'var(--green)':'var(--red)';}
  const pp=document.getElementById('kpi-pnl-pct');if(pp){pp.textContent=pnlPct===null?'—':(pnl>=0?'+':'')+pnlPct.toFixed(2)+'%';pp.style.color=pnlPct===null?'var(--t2)':pnl>=0?'var(--green)':'var(--red)';}
  refreshDashboardCharts(); renderHoldingsTable(); renderRecentTx();
}
function refreshDashboardCharts(){
  const perfCtx=document.getElementById('perfChart'); if(!perfCtx)return;
  if(perfChartInst)perfChartInst.destroy();
  const hist=STATE.perfHistory.length>1?STATE.perfHistory:[{ts:'Start',val:START_CASH},{ts:'Now',val:calcPortfolioValue()}];
  const labels=hist.map(h=>h.ts),vals=hist.map(h=>h.val),up=vals[vals.length-1]>=vals[0];
  perfChartInst=new Chart(perfCtx,{type:'line',data:{labels,datasets:[{label:'Portfolio Value',data:vals,borderColor:up?'#22c55e':'#ef4444',backgroundColor:up?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)',borderWidth:2,fill:true,tension:.35,pointRadius:0,pointHoverRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c2333',borderColor:'#21303f',borderWidth:1,bodyColor:'#8b9bbd',callbacks:{label:c=>' ₹'+c.parsed.y.toLocaleString('en-IN',{maximumFractionDigits:0})}}},
      scales:{x:{ticks:{color:'#3d5068',font:{size:9},maxTicksLimit:5,maxRotation:0},grid:{color:'rgba(33,48,63,.5)',drawBorder:false}},y:{ticks:{color:'#3d5068',font:{size:9},callback:v=>'₹'+Math.round(v/1000)+'k'},grid:{color:'rgba(33,48,63,.5)',drawBorder:false},position:'right'}}}});
  const allocCtx=document.getElementById('allocChart'); if(!allocCtx)return;
  if(allocChartInst)allocChartInst.destroy();
  const hkeys=Object.keys(STATE.holdings);
  if(hkeys.length===0){
    allocChartInst=new Chart(allocCtx,{type:'doughnut',data:{labels:['Cash'],datasets:[{data:[100],backgroundColor:['#21303f'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#3d5068',font:{size:10}}},tooltip:{enabled:false}},cutout:'68%'}});return;
  }
  const total=calcPortfolioValue(),alLabels=['Cash',...hkeys],alData=[STATE.cash/total*100,...hkeys.map(k=>STATE.holdings[k].qty*STATE.holdings[k].avgCost/total*100)];
  const colors=['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1'];
  allocChartInst=new Chart(allocCtx,{type:'doughnut',data:{labels:alLabels,datasets:[{data:alData,backgroundColor:colors.slice(0,alLabels.length),borderWidth:2,borderColor:'#1c2333'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8b9bbd',font:{size:10},boxWidth:10,padding:10}},tooltip:{backgroundColor:'#1c2333',borderColor:'#21303f',borderWidth:1,bodyColor:'#8b9bbd',callbacks:{label:c=>` ${c.label}: ${c.parsed.toFixed(1)}%`}}},cutout:'62%'}});
}
function renderHoldingsTable(){
  const tbody=document.getElementById('holdings-tbody'); if(!tbody)return;
  const keys=Object.keys(STATE.holdings);
  if(keys.length===0){tbody.innerHTML='<tr class="empty-row"><td colspan="5">No holdings yet — buy your first stock from Analytics</td></tr>';return;}
  tbody.innerHTML=keys.map(sym=>{
    const h=STATE.holdings[sym],quote=marketQuoteCache.get(sym),change=quote?(quote.price*INR_RATE-h.avgCost)*h.qty:null;
    return`<tr><td><div class="h-sym">${escapeHtml(sym)}</div></td><td style="color:var(--t1);font-weight:700">${h.qty}</td><td style="color:var(--t2)">${fmtINR(h.avgCost)}</td><td style="color:var(--t2)">${quote?fmtINR(quote.price*INR_RATE):'Unavailable'}</td><td style="color:${change===null?'var(--t2)':change>=0?'var(--green)':'var(--red)'}">${change===null?'—':signed(change)}</td></tr>`;
  }).join('');
}
function renderRecentTx(){
  const el=document.getElementById('db-tx-list'); if(!el)return;
  const txs=STATE.transactions.slice(0,8);
  if(txs.length===0){el.innerHTML='<div class="empty-tx">No transactions yet</div>';return;}
  el.innerHTML=txs.map(tx=>`<div class="tx-item"><div class="tx-l"><div class="tx-icon ${tx.type==='BUY'?'b':'s'}">${tx.type==='BUY'?'B':'S'}</div><div class="tx-info"><div class="tx-sym">${escapeHtml(tx.sym)}</div><div class="tx-detail">${Number(tx.qty)} shares · ${escapeHtml(tx.ts)}</div></div></div><div class="tx-r"><div class="tx-amt" style="color:${tx.type==='BUY'?'var(--red)':'var(--green)'}">${tx.type==='BUY'?'-':'+'}${fmtINR(Number(tx.total))}</div></div></div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   PORTFOLIO PAGE
════════════════════════════════════════════════════════════ */
function refreshPortfolioPage(){
  const invested=calcInvested(),total=calcMarketPortfolioValue(),pnl=total===null?null:total-START_CASH,pnlPct=pnl===null?null:pnl/START_CASH*100;
  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  s('p-kpi-total',total===null?'Unavailable':fmtINR(total));s('p-kpi-cash',fmtINR(STATE.cash));s('p-kpi-invested',fmtINR(invested));s('p-kpi-holdings',Object.keys(STATE.holdings).length);
  const pe=document.getElementById('p-kpi-pnl');if(pe){pe.textContent=pnl===null?'—':signed(pnl);pe.style.color=pnl===null?'var(--t2)':pnl>=0?'var(--green)':'var(--red)';}
  const pp=document.getElementById('p-kpi-pnl-pct');if(pp){pp.textContent=pnlPct===null?'—':(pnl>=0?'+':'')+pnlPct.toFixed(2)+'%';pp.style.color=pnlPct===null?'var(--t2)':pnl>=0?'var(--green)':'var(--red)';}
  const tbody=document.getElementById('portfolio-tbody'); if(!tbody)return;
  const query=(document.getElementById('portfolio-filter')?.value||'').trim().toLowerCase();
  const sort=document.getElementById('portfolio-sort')?.value||'symbol';
  const holdings=Object.keys(STATE.holdings).map(sym=>({sym,h:STATE.holdings[sym]}))
    .filter(({sym})=>sym.toLowerCase().includes(query)||(availableTickerBySymbol.get(sym)?.name||'').toLowerCase().includes(query));
  holdings.sort((a,b)=>{
    if(sort==='quantity')return b.h.qty-a.h.qty;
    if(sort==='invested')return b.h.qty*b.h.avgCost-a.h.qty*a.h.avgCost;
    return a.sym.localeCompare(b.sym);
  });
  if(!holdings.length){
    const message=Object.keys(STATE.holdings).length?'No holdings match this search.':'No holdings. Go to Analytics to buy your first stock.';
    tbody.innerHTML=`<tr class="empty-row"><td colspan="9">${message}</td></tr>`;
    return;
  }
  tbody.innerHTML=holdings.map(({sym,h})=>{
    const invested=h.qty*h.avgCost,quote=marketQuoteCache.get(sym);
    const marketValue=quote?h.qty*quote.price*INR_RATE:null;
    const pnl=marketValue===null?null:marketValue-invested;
    const pnlPct=pnl===null||invested===0?null:pnl/invested*100;
    const name=availableTickerBySymbol.get(sym)?.name||'';
    return`<tr><td><div class="h-sym">${escapeHtml(sym)}</div><div class="holding-name">${escapeHtml(name)}</div></td>
      <td style="color:var(--t1);font-weight:700">${h.qty}</td><td>${fmtINR(h.avgCost)}</td>
      <td style="color:var(--t2)">${quote?fmtINR(quote.price*INR_RATE):'Unavailable'}</td>
      <td>${marketValue===null?'—':fmtINR(marketValue)}</td><td>${fmtINR(invested)}</td>
      <td style="color:${pnl===null?'var(--t2)':pnl>=0?'var(--green)':'var(--red)'}">${pnl===null?'—':signed(pnl)}</td>
      <td style="color:${pnlPct===null?'var(--t2)':pnlPct>=0?'var(--green)':'var(--red)'}">${pnlPct===null?'—':(pnlPct>=0?'+':'')+pnlPct.toFixed(2)+'%'}</td>
      <td><button class="abtn" type="button" style="padding:5px 12px;font-size:11px" onclick="quickSell('${escapeHtml(sym)}')">Sell</button></td></tr>`;
  }).join('');
}
function quickSell(sym){document.getElementById('ticker').value=sym;showPage('analytics');switchTradeSide('sell');runAnalysis();}

/* ════════════════════════════════════════════════════════════
   TRANSACTIONS PAGE
════════════════════════════════════════════════════════════ */
function refreshTransactionsPage(){
  const tbody=document.getElementById('tx-tbody'); if(!tbody)return;
  const txs=STATE.transactions;
  const query=(document.getElementById('tx-search')?.value||'').trim().toLowerCase();
  const type=document.getElementById('tx-type')?.value||'';
  const fromValue=document.getElementById('tx-from')?.value||'';
  const toValue=document.getElementById('tx-to')?.value||'';
  const from=fromValue?new Date(fromValue+'T00:00:00'):null;
  const to=toValue?new Date(toValue+'T23:59:59.999'):null;
  const filtered=txs.map((tx,index)=>({tx,index})).filter(({tx})=>{
    if(type&&tx.type!==type)return false;
    const company=availableTickerBySymbol.get(tx.sym)?.name||'';
    if(query&&!String(tx.sym).toLowerCase().includes(query)&&!company.toLowerCase().includes(query))return false;
    if(from||to){
      const date=parseTransactionDate(tx.ts);
      if(!date||(from&&date<from)||(to&&date>to))return false;
    }
    return true;
  });
  document.getElementById('tx-count').textContent=`${filtered.length} of ${txs.length} transaction${txs.length===1?'':'s'}`;
  if(!filtered.length){
    const message=txs.length?'No transactions match these filters.':'No transactions yet.';
    tbody.innerHTML=`<tr class="empty-row"><td colspan="10">${message}</td></tr>`;
    return;
  }
  tbody.innerHTML=filtered.map(({tx,index})=>`<tr><td style="color:var(--t3)">${txs.length-index}</td><td style="color:var(--t2)">${escapeHtml(tx.ts)}</td><td><span style="font-weight:800;color:${tx.type==='BUY'?'var(--green)':'var(--red)'}">${escapeHtml(tx.type)}</span></td><td style="font-weight:700">${escapeHtml(tx.sym)}</td><td>${Number(tx.qty)}</td><td>${fmtINR(Number(tx.price))}</td><td style="font-weight:700;color:${tx.type==='BUY'?'var(--red)':'var(--green)'}">${tx.type==='BUY'?'-':'+'}${fmtINR(Number(tx.total))}</td><td style="color:var(--t2)">${fmtINR(Number(tx.cashAfter))}</td><td><span class="tx-status">Recorded</span></td><td><button class="detail-btn" type="button" onclick="openTransactionDetails(${index})">Details</button></td></tr>`).join('');
}

function parseTransactionDate(value){
  const text=String(value||'');
  const match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if(match){
    const year=Number(match[3])<100?2000+Number(match[3]):Number(match[3]);
    let hour=Number(match[4]);
    if(match[6]&&match[6].toLowerCase()==='pm'&&hour<12)hour+=12;
    if(match[6]&&match[6].toLowerCase()==='am'&&hour===12)hour=0;
    const date=new Date(year,Number(match[2])-1,Number(match[1]),hour,Number(match[5]));
    return Number.isNaN(date.getTime())?null:date;
  }
  const parsed=new Date(text);
  return Number.isNaN(parsed.getTime())?null:parsed;
}

function openTransactionDetails(index){
  const tx=STATE.transactions[index];
  if(!tx)return;
  const rows=[
    ['Status','Recorded'],
    ['Type',tx.type],
    ['Stock',tx.sym],
    ['Quantity',String(tx.qty)],
    ['Price per share',fmtINR(Number(tx.price))],
    ['Total',fmtINR(Number(tx.total))],
    ['Cash after',fmtINR(Number(tx.cashAfter))],
    ['Date and time',tx.ts]
  ];
  document.getElementById('tx-detail-content').innerHTML=rows.map(([label,value])=>
    `<div class="minfo"><span class="minfo-key">${escapeHtml(label)}</span><span class="minfo-val">${escapeHtml(value)}</span></div>`
  ).join('');
  setModalVisibility('tx-detail-modal',true);
}
function closeTransactionDetails(){setModalVisibility('tx-detail-modal',false);}

/* ════════════════════════════════════════════════════════════
   RESET
════════════════════════════════════════════════════════════ */
function confirmReset(){setModalVisibility('reset-modal',true);}
function resetAccount(){
  STATE=freshState(); saveCurrentUserState(); setModalVisibility('reset-modal',false);
  updateHeaderCash(); showPage('dash'); showToast('Portfolio reset — ₹1,00,000 virtual cash restored','ok');
}

/* ════════════════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════════════════ */
function updateHeaderCash(){ const el=document.getElementById('hdr-cash'); if(el)el.textContent=fmtINR(STATE.cash); }
function setModalVisibility(id,open){
  const modal=document.getElementById(id);
  modal.classList.toggle('open',open);
  modal.setAttribute('aria-hidden',String(!open));
}

function showApiErrorBanner(msg){
  const banner = document.getElementById('api-err-banner');
  const msgEl  = document.getElementById('api-err-msg');
  if(!banner||!msgEl) return;
  msgEl.textContent=msg;
  banner.classList.add('show');
}
function hideApiErrorBanner(){
  const banner = document.getElementById('api-err-banner');
  if(banner) banner.classList.remove('show');
}
function showAnalyticsDashboard(show){
  document.getElementById('welcome').style.display    =show?'none':'flex';
  document.getElementById('identity').style.display   =show?'block':'none';
  document.getElementById('cards').style.display      =show?'grid':'none';
  document.getElementById('chartPanel').style.display =show?'flex':'none';
  document.getElementById('brow').style.display       =show?'grid':'none';
  document.getElementById('tradePanel').style.display =show?'flex':'none';
}
function showQuoteUnavailable(sym,message){
  setLoading(false);
  currentPrice=0;
  showAnalyticsDashboard(false);
  document.querySelector('#welcome .wlc-title').textContent='Live quote unavailable';
  document.querySelector('#welcome .wlc-sub').textContent=`No quote is being shown for ${sym}. ${message}`;
  showApiErrorBanner('Live market data is unavailable: '+message);
  updateOrderSummary();
  showToast('Could not load a live quote for '+sym+'.','err');
}
function setLoading(on){ const btn=document.getElementById('analyzeBtn'); btn.disabled=on; btn.innerHTML=on?'<span class="spin"></span>Analyzing…':'Analyze'; }

let toastTimer;
function showToast(msg,type='ok'){
  const t=document.getElementById('toast'); t.textContent=msg;
  t.className=type==='err'?'show err':type==='warn'?'show warn':'show';
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='',4000);
}

document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});
document.getElementById('tx-detail-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeTransactionDetails();});
const tickerInput=document.getElementById('ticker');
tickerInput.addEventListener('input',()=>filterAvailableTickers(tickerInput.value));
tickerInput.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'&&!document.getElementById('tickerSuggestions').hidden){
    e.preventDefault();
    setActiveTickerSuggestion(activeTickerSuggestion+1);
  }else if(e.key==='ArrowUp'&&!document.getElementById('tickerSuggestions').hidden){
    e.preventDefault();
    setActiveTickerSuggestion(activeTickerSuggestion-1);
  }else if(e.key==='Enter'){
    e.preventDefault();
    const option=tickerSuggestionMatches[activeTickerSuggestion>=0?activeTickerSuggestion:0];
    if(!document.getElementById('tickerSuggestions').hidden&&option)selectStock(option.sym);
    else runAnalysis();
  }else if(e.key==='Escape'){
    hideTickerSuggestions();
  }
});
document.addEventListener('click',e=>{
  if(!e.target.closest('.stock-picker'))hideTickerSuggestions();
});
document.getElementById('watchlist-search').addEventListener('input',event=>{
  watchlistFilter=event.target.value;
  renderWatchlistPage();
});
document.getElementById('watchlist-add-input').addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();addWatchlistStock();}
});
document.getElementById('portfolio-filter').addEventListener('input',refreshPortfolioPage);
document.getElementById('portfolio-sort').addEventListener('change',refreshPortfolioPage);
['tx-search','tx-type','tx-from','tx-to'].forEach(id=>{
  document.getElementById(id).addEventListener(id==='tx-search'?'input':'change',refreshTransactionsPage);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    closeTransactionDetails();
    closeModal();
  }
});
