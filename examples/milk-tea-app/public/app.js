const $=id=>document.getElementById(id), money=cents=>`¥${(cents/100).toFixed(2)}`;
const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let entries=[],selected=null,quote=null,order=null,shop='',category='',pending=false,orderKey='';
let quoteVersion=0,quoteAbort=null,quoteTimer=null,quoteExpiryTimer=null;
async function api(path,body,options={}){const res=await fetch(path,body===undefined?options:{...options,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error?.message||'请求失败');return data;}
function notify(text){$('message').textContent=text;$('message').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('message').hidden=true,5000);}
function cup(p){const [top,bottom]=p.colors;return `<svg class="cup-svg" viewBox="0 0 120 160" aria-hidden="true"><defs><linearGradient id="g-${esc(p.shop.id+'-'+p.icon.codePointAt(0))}" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><ellipse cx="60" cy="145" rx="35" ry="5" fill="#000" opacity=".04"/><path d="M42 7h7l10 111h-7z" fill="#eee4c5"/><path d="M26 34h68l-8 100q-26 13-52 0z" fill="url(#g-${esc(p.shop.id+'-'+p.icon.codePointAt(0))})" stroke="#fff" stroke-width="2"/><ellipse cx="60" cy="35" rx="35" ry="7" fill="#f9f2df" stroke="#fff" stroke-width="2"/><ellipse cx="60" cy="34" rx="31" ry="4" fill="${top}"/><path d="M31 41l7 87" stroke="#fff" opacity=".4" stroke-width="3"/><circle cx="60" cy="80" r="20" fill="#ffffffc5"/><text x="60" y="87" text-anchor="middle" font-size="20" fill="#526948">${esc(p.icon)}</text><text x="60" y="104" text-anchor="middle" font-size="5" letter-spacing="1" fill="#fff">TEA, YOUR WAY</text>${[43,55,67,77].map((x,i)=>`<circle cx="${x}" cy="${123-i%2*4}" r="4" fill="#654a38" opacity=".5"/>`).join('')}</svg>`;}
async function search(){
  try{const args={query:$('search').value.trim(),...(shop?{shop_id:shop}:{}),...(category?{category}:{}),...($('budget').value!==''?{max_price_cny:Number($('budget').value)}:{})};const data=await api('/api/search',args);entries=data.entries;
    $('result-count').textContent=`${entries.length} 款饮品`;
    $('menu-grid').innerHTML=entries.length?entries.map(({entry:e})=>{const p=e.attributes,available=p.inventory.availability_status==='in_stock';return `<article class="product-card ${selected?.entry_id===e.entry_id?'selected':''}" data-entry="${esc(e.entry_id)}"><div class="product-art" style="--art:${p.colors[0]}35"><span class="shop-label">${esc(p.shop.name)}</span>${cup(p)}${available?'':'<div class="soldout">今日售罄</div>'}</div><div class="product-info"><h3>${esc(e.title)}</h3><p>${esc(e.summary)}</p><div class="product-bottom"><span class="price">¥${p.price.amount}<small>起</small></span><button class="choose" data-select="${esc(e.entry_id)}" aria-label="选择${esc(e.title)} · ${esc(p.shop.name)}" ${available?'':'disabled'}>+</button></div></div></article>`;}).join(''):'<p>没有找到饮品，试试其他关键词或提高预算。</p>';
    document.querySelectorAll('[data-select]').forEach(button=>button.addEventListener('click',()=>selectProduct(button.dataset.select)));
  }catch(error){notify(error.message);$('menu-grid').innerHTML='<p>门店连接失败，请重试搜索。</p>';}
}
function selectProduct(id){selected=entries.find(x=>x.entry.entry_id===id).entry;quote=null;order=null;orderKey='';renderSelection();document.querySelectorAll('.product-card').forEach(card=>card.classList.toggle('selected',card.dataset.entry===id));if(innerWidth<720)$('selection').scrollIntoView({behavior:'smooth',block:'start'});}
function renderSelection(){const e=selected,p=e.attributes,options=p.options;
  const select=(id,label,values,defaultValue)=>`<label class="field">${label}<select id="${id}" aria-label="${label}">${Object.entries(values).map(([key,value])=>`<option value="${key}" ${key===defaultValue?'selected':''}>${esc(value)}</option>`).join('')}</select></label>`;
  $('selection').innerHTML=`<h2 class="selected-title">${esc(e.title)}</h2><div class="selected-shop">${esc(p.shop.name)} · 到店自取 · 模拟</div><div class="option-grid">${select('size','杯型',options.sizes,'regular')}${select('sugar','甜度',options.sugars,'light')}${select('ice','冰量',options.ices,'less')}<label class="field">数量<input id="quantity" aria-label="数量" type="number" min="1" max="5" value="1"></label></div><div class="addon-title">加一点喜欢的</div><div class="addon-list">${Object.entries(options.addons).map(([key,a])=>`<label><input type="checkbox" name="addon" value="${key}"> ${esc(a.name)} +¥${a.cents/100}</label>`).join('')}</div><div id="quote-area" aria-live="polite"></div>`;
  $('selection').querySelectorAll('select,input').forEach(el=>el.addEventListener(el.type==='number'?'input':'change',scheduleQuote));
  scheduleQuote();
}
function scheduleQuote(){
  const version=++quoteVersion;quoteAbort?.abort();clearTimeout(quoteTimer);clearTimeout(quoteExpiryTimer);
  quote=null;orderKey='';
  if(!$('quote-area'))return;
  $('quote-area').innerHTML='<div class="quote-box"><p class="quote-note">正在更新价格…</p></div>';
  quoteTimer=setTimeout(()=>getQuote(version),120);
}
async function getQuote(version){
  if(!selected||!$('quantity'))return;
  const quantity=Number($('quantity').value);
  if(!Number.isInteger(quantity)||quantity<1||quantity>5){$('quote-area').innerHTML='<p class="warning">数量请选择 1–5 杯。</p>';return;}
  quoteAbort=new AbortController();const entryId=selected.entry_id;
  try{const result=await api('/api/quote',{entry_id:entryId,size:$('size').value,sugar:$('sugar').value,ice:$('ice').value,quantity,addons:[...document.querySelectorAll('input[name="addon"]:checked')].map(el=>el.value)},{signal:quoteAbort.signal});
    if(version!==quoteVersion||selected.entry_id!==entryId||!$('quote-area'))return;
    quote=result.quote;orderKey=crypto.randomUUID();
    const over=$('budget').value!==''&&quote.total_cents>Number($('budget').value)*100;
    $('quote-area').innerHTML=`<div class="quote-box">${quote.breakdown.map(row=>`<div class="quote-row"><span>${esc(row.label)}</span><span>${money(row.cents)}</span></div>`).join('')}<div class="quote-row"><span>数量</span><span>${quote.quantity} 杯</span></div><div class="quote-total"><span>合计</span><strong>${money(quote.total_cents)}</strong></div><p class="quote-note">${esc(quote.selection_label)}<br>${esc(quote.shop_name)} · 价格已自动更新</p>${over?'<p class="warning">最终总价超过你设置的预算，请确认是否继续。</p>':''}<label class="confirm-check"><input id="confirm" type="checkbox">我已确认门店、规格、数量与金额，创建模拟订单。</label><button class="primary" id="order-button" disabled>确认模拟下单</button><p class="quote-note">不会支付或向真实商家下单。</p></div>`;
    $('confirm').onchange=()=>$('order-button').disabled=!$('confirm').checked;
    $('order-button').onclick=createOrder;
    const quoteId=quote.quote_id;quoteExpiryTimer=setTimeout(()=>{if(quote?.quote_id===quoteId&&$('quote-area'))scheduleQuote();},Math.max(1000,Date.parse(quote.expires_at)-Date.now()-1000));
  }catch(error){if(error.name==='AbortError'||version!==quoteVersion)return;if($('quote-area'))$('quote-area').innerHTML=`<p class="warning">${esc(error.message)}</p>`;}
}
async function createOrder(){if(pending||!quote||!$('confirm').checked)return;pending=true;clearTimeout(quoteExpiryTimer);$('selection').querySelectorAll('select,input,button').forEach(el=>el.disabled=true);
  try{order=await api('/api/orders',{quote_id:quote.quote_id,expected_total_cents:quote.total_cents,user_confirmed:true,idempotency_key:orderKey});
    $('selection').innerHTML=`<div class="order-success"><div class="success-icon">✓</div><h2>这一杯，已为你记下。</h2><p class="quote-note">${esc(order.title)} · ${esc(order.shop_name)}<br>${esc(order.selection_label)} × ${order.quantity}</p><div class="quote-total"><span>模拟订单金额</span><strong>${money(order.total_cents)}</strong></div><span class="status-pill" id="current-status">${esc(order.status_label)}</span><p class="quote-note">模拟取餐码</p><div class="pickup">${esc(order.pickup_code)}</div><p class="order-meta">订单号：${esc(order.order_id)}<br>无真实支付 · 无真实履约</p><button class="primary" id="status-button">查询订单状态</button></div>`;
    $('status-button').onclick=async()=>{try{const data=await api(`/api/orders/${order.order_id}`);$('current-status').textContent=data.status_label;notify('订单状态已更新');}catch(e){notify(e.message);}};
    await search();notify('模拟订单创建成功，未产生真实付款。');
  }catch(error){notify(error.message);if($('order-button')){$('selection').querySelectorAll('select,input').forEach(el=>el.disabled=false);$('order-button').disabled=false;}}finally{pending=false;}
}
async function showOrders(){try{const orders=await api('/api/orders');$('order-count').textContent=orders.length||'';$('orders-list').innerHTML=orders.length?orders.map(o=>`<article class="order-record"><div><h3>${esc(o.title)} × ${o.quantity}</h3><p>${esc(o.shop_name)} · ${esc(o.selection_label)}</p><div class="order-meta">${esc(o.order_id)}<br>${new Date(o.created_at).toLocaleString('zh-CN')}</div></div><div><span class="status-pill">${esc(o.status_label)}</span><div class="pickup">${esc(o.pickup_code)}</div><strong>${money(o.total_cents)}</strong><p class="quote-note">模拟订单，无真实支付</p></div></article>`).join(''):'<p class="quote-note">还没有订单。去菜单选一杯喜欢的吧。</p>';}catch(e){notify(e.message);}}
async function showTrace(){try{const rows=await api('/api/trace');$('trace-list').innerHTML=rows.map(row=>`<div class="trace-row"><span>${new Date(row.time).toLocaleTimeString('zh-CN')}</span><strong>${esc(row.step)}</strong><span>${esc(row.shop)}</span><code>${esc(row.endpoint)}</code></div>`).join('')||'<p>先搜索或下单，就会出现实际调用记录。</p>';}catch(e){notify(e.message);}}
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));for(const tab of ['menu','orders','protocol'])$(`${tab}-tab`).hidden=tab!==button.dataset.tab;if(button.dataset.tab==='orders')showOrders();if(button.dataset.tab==='protocol')showTrace();});
document.querySelectorAll('[data-shop]').forEach(button=>button.onclick=()=>{shop=button.dataset.shop;document.querySelectorAll('[data-shop]').forEach(b=>b.classList.toggle('active',b===button));search();});
document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b===button));search();});
$('search-button').onclick=search;$('search').onkeydown=e=>{if(e.key==='Enter')search();};$('refresh-orders').onclick=showOrders;
setInterval(()=>{if(!$('orders-tab').hidden)showOrders();},5000);
search();
