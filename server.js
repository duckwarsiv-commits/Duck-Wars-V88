'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const Stripe=require('stripe');

const PORT=Number(process.env.PORT||10000);
const STRIPE_WEBHOOK_SECRET=String(process.env.STRIPE_WEBHOOK_SECRET||'').trim();
const PUBLIC_BASE_URL=String(process.env.PUBLIC_BASE_URL||'').trim().replace(/\/$/,'');
const STORE_FILE=path.resolve(process.env.DUCK_WARS_STORE_FILE||path.join(__dirname,'data','payments.json'));
const stripe=new Stripe('sk_test_webhook_verification_only');

const CATALOG=Object.freeze({
  starter:{name:'Starter Coins',cents:99,consumable:true,coins:500},
  small:{name:'Small Pouch',cents:199,consumable:true,coins:1200},
  medium:{name:'Medium Chest',cents:499,consumable:true,coins:3500},
  large:{name:'Large Vault',cents:999,consumable:true,coins:8000},
  mega:{name:'Mega Treasure',cents:1999,consumable:true,coins:18000},
  ultimate:{name:'Dragon Hoard',cents:3999,consumable:true,coins:50000},
  dragon:{name:'Dragon Bundle',cents:299},
  ice:{name:'Ice Dragon Pack',cents:399},
  thanksgiving:{name:'Thanksgiving Duck',cents:7000,limited:500},
  vip:{name:'VIP Duck',cents:499},
  doublecoins:{name:'2x Coins Pass',cents:599},
  speedpass:{name:'Speed Boost Pass',cents:399},
  autofire:{name:'Auto Fire Pass',cents:400},
  ambot:{name:'Aimbot Pass',cents:99},
  goldpass:{name:'Gold Duck Pass',cents:700}
});

function paymentLinks(){
  try{
    const x=JSON.parse(process.env.PAYMENT_LINKS_JSON||'{}');
    return x&&typeof x==='object'?x:{};
  }catch{return {};}
}
function itemForPaymentLink(id){
  for(const [item,v] of Object.entries(paymentLinks())){
    if(v&&String(v.id||'')===String(id||''))return item;
  }
  return '';
}
function emptyStore(){return{players:{},fulfilledSessions:{},thanksgiving:{sold:0}};}
function loadStore(){
  try{
    const v=JSON.parse(fs.readFileSync(STORE_FILE,'utf8'));
    return v&&typeof v==='object'?{...emptyStore(),...v,players:v.players||{},fulfilledSessions:v.fulfilledSessions||{},thanksgiving:{...emptyStore().thanksgiving,...(v.thanksgiving||{})}}:emptyStore();
  }catch{return emptyStore();}
}
let store=loadStore();
function saveStore(){
  fs.mkdirSync(path.dirname(STORE_FILE),{recursive:true});
  const tmp=STORE_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(store,null,2));
  fs.renameSync(tmp,STORE_FILE);
}
function cleanPlayerId(v){
  const s=String(v||'').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s)?s:'';
}
function playerIdFrom(req,url,body){
  return cleanPlayerId(req.headers['x-duck-player']||body?.playerId||url.searchParams.get('playerId'));
}
function getPlayer(id){
  if(!store.players[id])store.players[id]={entitlements:[],grants:[],purchases:[]};
  const p=store.players[id];
  if(!Array.isArray(p.entitlements))p.entitlements=[];
  if(!Array.isArray(p.grants))p.grants=[];
  if(!Array.isArray(p.purchases))p.purchases=[];
  return p;
}
function thanksgivingRemaining(){
  return Math.max(0,500-Number(store.thanksgiving.sold||0));
}
function fulfill(session){
  if(!session?.id||store.fulfilledSessions[session.id])return false;
  const item=String(session.metadata?.item||itemForPaymentLink(session.payment_link)||'');
  const playerId=cleanPlayerId(session.metadata?.playerId||session.client_reference_id||'');
  const sku=CATALOG[item];
  if(!sku||!playerId)return false;
  const p=getPlayer(playerId);
  if(sku.consumable){
    p.grants.push({id:session.id+':'+item,type:'coins',amount:sku.coins,item,claimed:false,createdAt:Date.now()});
  }else if(!p.entitlements.includes(item)){
    p.entitlements.push(item);
  }
  p.purchases.push({sessionId:session.id,item,amountTotal:session.amount_total||sku.cents,currency:session.currency||'usd',paidAt:Date.now()});
  store.fulfilledSessions[session.id]={playerId,item,at:Date.now()};
  if(item==='thanksgiving')store.thanksgiving.sold=Math.min(500,Number(store.thanksgiving.sold||0)+1);
  saveStore();
  return true;
}
function configured(){
  const links=paymentLinks();
  return Boolean(STRIPE_WEBHOOK_SECRET)&&Object.keys(CATALOG).every(k=>links[k]?.url&&links[k]?.id);
}
function json(res,code,payload){
  const body=JSON.stringify(payload);
  res.writeHead(code,{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(body),
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, X-Duck-Player, Stripe-Signature',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
  });
  res.end(body);
}
function readBody(req,limit=1024*1024){
  return new Promise((resolve,reject)=>{
    let body='';
    req.setEncoding('utf8');
    req.on('data',chunk=>{body+=chunk;if(body.length>limit){reject(new Error('too large'));req.destroy();}});
    req.on('end',()=>resolve(body));
    req.on('error',reject);
  });
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS')return json(res,204,{});
  const url=new URL(req.url||'/','http://'+(req.headers.host||'localhost'));

  if(req.method==='GET'&&url.pathname==='/')return json(res,200,{service:'Duck Wars V88 Payments API',ok:true,testMode:true,paymentsConfigured:configured()});
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,testMode:true,payments:configured(),linksConfigured:Object.keys(paymentLinks()).length,thanksgivingRemaining:thanksgivingRemaining()});
  if(req.method==='GET'&&url.pathname==='/api/store')return json(res,200,{
    configured:configured(),
    testMode:true,
    items:Object.fromEntries(Object.entries(CATALOG).map(([id,x])=>[id,{name:x.name,cents:x.cents,consumable:Boolean(x.consumable),available:Boolean(paymentLinks()[id]?.url)}])),
    thanksgivingRemaining:thanksgivingRemaining()
  });

  if(req.method==='GET'&&url.pathname==='/api/me'){
    const playerId=playerIdFrom(req,url,null);
    if(!playerId)return json(res,400,{error:'Missing player ID'});
    const p=getPlayer(playerId);
    return json(res,200,{entitlements:p.entitlements,grants:p.grants.filter(g=>!g.claimed),paymentsConfigured:configured(),testMode:true,thanksgivingRemaining:thanksgivingRemaining()});
  }

  if(req.method==='POST'&&url.pathname==='/api/claim'){
    try{
      const body=JSON.parse(await readBody(req)||'{}');
      const playerId=playerIdFrom(req,url,body);
      if(!playerId)return json(res,400,{error:'Missing player ID'});
      const ids=new Set(Array.isArray(body.grantIds)?body.grantIds.map(String):[]);
      const p=getPlayer(playerId);
      for(const g of p.grants)if(ids.has(String(g.id)))g.claimed=true;
      saveStore();
      return json(res,200,{ok:true});
    }catch{return json(res,400,{error:'Invalid claim payload'});}
  }

  if(req.method==='POST'&&url.pathname==='/api/checkout'){
    try{
      const body=JSON.parse(await readBody(req)||'{}');
      const item=String(body.item||'');
      const playerId=playerIdFrom(req,url,body);
      const sku=CATALOG[item];
      const link=paymentLinks()[item];
      if(!playerId)return json(res,400,{error:'Missing player ID'});
      if(!sku)return json(res,400,{error:'Unknown store item'});
      if(!STRIPE_WEBHOOK_SECRET)return json(res,503,{error:'Webhook verification is not configured yet'});
      if(!link?.url)return json(res,503,{error:'This test item is not configured yet'});
      const p=getPlayer(playerId);
      if(!sku.consumable&&p.entitlements.includes(item))return json(res,409,{error:'You already own this item'});
      if(item==='thanksgiving'&&thanksgivingRemaining()<=0)return json(res,409,{error:'Thanksgiving Duck is sold out'});
      const joiner=link.url.includes('?')?'&':'?';
      return json(res,200,{url:link.url+joiner+'client_reference_id='+encodeURIComponent(playerId),testMode:true});
    }catch{return json(res,400,{error:'Invalid checkout request'});}
  }

  if(req.method==='POST'&&url.pathname==='/api/stripe/webhook'){
    if(!STRIPE_WEBHOOK_SECRET)return json(res,503,{error:'Stripe webhook is not configured'});
    try{
      const raw=await readBody(req);
      const event=stripe.webhooks.constructEvent(raw,req.headers['stripe-signature'],STRIPE_WEBHOOK_SECRET);
      if(event.type==='checkout.session.completed'&&event.data.object.payment_status==='paid')fulfill(event.data.object);
      if(event.type==='checkout.session.async_payment_succeeded')fulfill(event.data.object);
      return json(res,200,{received:true});
    }catch(err){
      console.error('Webhook verification failed:',err.message);
      return json(res,400,{error:'Webhook verification failed'});
    }
  }
  return json(res,404,{error:'Not found'});
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log('Duck Wars V88 Payments API listening on '+PORT);
  console.log('Test payments configured: '+configured());
});