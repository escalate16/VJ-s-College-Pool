const crypto=require('crypto');
const LV={player:1,admin:2,owner:3};
const secret=()=>process.env.SESSION_SECRET||'dev-secret-change-me';
const sign=s=>crypto.createHmac('sha256',secret()).update(s).digest('hex').slice(0,32);
const mkToken=id=>{const b=id+'.'+(Date.now()+30*864e5);return b+'.'+sign(b)};
const readToken=t=>{const p=(t||'').split('.');if(p.length!==3)return null;const b=p[0]+'.'+p[1];if(sign(b)!==p[2]||Date.now()>+p[1])return null;return p[0]};
const getCk=req=>{const m=(req.headers.cookie||'').match(/(?:^|;\s*)vjp=([^;]*)/);return m?m[1]:''};
const setCk=(res,t,age)=>res.setHeader('Set-Cookie',`vjp=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`);
const hash=(pw,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(pw,salt,32).toString('hex');
const check=(pw,h)=>{const[s,x]=h.split(':'),y=crypto.scryptSync(pw,s,32).toString('hex');return x.length===y.length&&crypto.timingSafeEqual(Buffer.from(x),Buffer.from(y))};
const emails=k=>(process.env[k]||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
const roleFor=e=>{e=e.toLowerCase();return emails('OWNER_EMAIL').includes(e)?'owner':emails('ADMIN_EMAILS').includes(e)?'admin':'player'};
const pub=r=>({id:r.id,email:r.email,role:roleFor(r.email)});
const pubA=async(store,r)=>{const u=pub(r);if(u.role==='player'){try{const a=await store.get('assist','list');if(((a&&a.data&&a.data.emails)||[]).map(e=>String(e).toLowerCase()).includes(String(r.email).toLowerCase()))u.role='admin'}catch(e){}}return u};
const err=(res,c,m)=>res.status(c).json({error:m});
async function user(store,req){const id=readToken(getCk(req));if(!id)return null;const r=await store.userById(id);return r?pubA(store,r):null}
function allowed(u,op,c,id){
  if(!u)return false;const L=LV[u.role]||1,own=!!id&&id===u.id;
  if(c==='assist'||c==='reset')return L>=3;
  if(c==='pconf')return op==='read'||L>=3;
  if(c==='settings'&&id==='flags')return op==='read'||L>=3;
  if(c==='members')return L>=2||own;
  if(/^f(l|team|trade|stats|players)$/.test(c))return op==='read'||L>=3;
  if(c==='squares')return true;
  if(c==='chat')return op==='read'||!id||L>=2;
  if(c==='surv')return op==='read'||own||L>=2;
  if(c==='picks')return op==='read'||own||L>=3;
  if(['games','paid','settings','sqcfg'].includes(c))return op==='read'||L>=2;
  return op==='read'||L>=2;
}
async function auth(store,req,res){
  if(req.method!=='POST')return err(res,405,'POST only');
  const b=req.body||{};
  if(b.op==='logout'){setCk(res,'',0);return res.status(200).json({ok:1})}
  if(b.op==='me'){const u=await user(store,req);return res.status(200).json({user:u})}
  const email=String(b.email||'').trim().toLowerCase(),pw=String(b.password||'');
  const hc=c=>crypto.createHash('sha256').update(String(c)+secret()).digest('hex');
  const wipe=async r=>{await store.delUser(r.id);for(const c of['picks','members'])await store.del(c,r.id);await store.del('reset',String(r.email).toLowerCase())};
  if(b.op==='issue'){
    const u=await user(store,req);if(!u||u.role==='player')return err(res,403,'Commissioners only.');
    const r=await store.userByEmail(email);if(!r)return err(res,404,'No account uses that email.');
    const code=crypto.randomBytes(4).toString('hex').toUpperCase();
    await store.set('reset',email,{h:hc(code),exp:Date.now()+86400000,n:0});
    return res.status(200).json({code});
  }
  if(b.op==='reset'){
    const code=String(b.code||'').trim().toUpperCase();
    if(pw.length<8)return err(res,400,'Choose a password of at least 8 characters.');
    const d=await store.get('reset',email);
    if(!d||d.data.exp<Date.now())return err(res,400,'That code is not valid or has expired. Ask the commissioner for a new one.');
    if(d.data.n>=5){await store.del('reset',email);return err(res,429,'Too many tries. Ask the commissioner for a new code.')}
    if(d.data.h!==hc(code)){await store.set('reset',email,{...d.data,n:d.data.n+1});return err(res,400,'That code is not correct.')}
    const r=await store.userByEmail(email);if(!r)return err(res,400,'No account uses that email.');
    await store.setPw(r.id,hash(pw));await store.del('reset',email);
    setCk(res,mkToken(r.id),30*86400);return res.status(200).json({user:await pubA(store,r)});
  }
  if(b.op==='delete'){
    const u=await user(store,req);if(!u)return err(res,401,'Please sign in.');
    const r=await store.userById(u.id);if(!r||!check(pw,r.pw))return err(res,403,'Wrong password.');
    if(u.role==='owner')return err(res,400,'The commissioner account cannot be deleted here.');
    await wipe(r);setCk(res,'',0);return res.status(200).json({ok:1});
  }
  if(b.op==='remove'){
    const u=await user(store,req);if(!u||u.role!=='owner')return err(res,403,'Only the commissioner can delete accounts.');
    const r=await store.userByEmail(email);if(!r)return err(res,404,'No account uses that email.');
    if(roleFor(r.email)==='owner')return err(res,400,'That is the commissioner account.');
    await wipe(r);return res.status(200).json({ok:1});
  }
  if(b.op==='register'){
    if(!/^\S+@\S+\.\S+$/.test(email)||pw.length<8)return err(res,400,'Enter a valid email and a password of at least 8 characters.');
    if(process.env.INVITE_CODE&&b.invite!==process.env.INVITE_CODE)return err(res,403,'That invite code is not correct.');
    if(await store.userByEmail(email))return err(res,409,'That email already has an account. Sign in instead.');
    const id='u_'+crypto.randomBytes(8).toString('hex');await store.addUser({id,email,pw:hash(pw)});
    setCk(res,mkToken(id),30*86400);return res.status(200).json({user:await pubA(store,{id,email})});
  }
  if(b.op==='login'){
    const r=await store.userByEmail(email);
    if(!r||!check(pw,r.pw))return err(res,401,'Wrong email or password.');
    setCk(res,mkToken(r.id),30*86400);return res.status(200).json({user:await pubA(store,r)});
  }
  return err(res,400,'Bad request');
}
async function db(store,req,res){
  if(req.method!=='POST')return err(res,405,'POST only');
  const u=await user(store,req);if(!u)return err(res,401,'Please sign in.');
  const{op,c,id,data}=req.body||{};
  if(typeof c!=='string'||!/^[\w-]+$/.test(c))return err(res,400,'Bad collection');
  if(id!==undefined&&!/^[\w.@+:-]+$/.test(String(id)))return err(res,400,'Bad id');
  if(data!==undefined&&JSON.stringify(data).length>200000)return err(res,413,'Too large');
  if(op==='list'){if(!allowed(u,'read',c))return err(res,403,'Not allowed');return res.status(200).json({docs:await store.list(c)})}
  if(op==='get'){if(!allowed(u,'read',c,id))return err(res,403,'Not allowed');return res.status(200).json({doc:await store.get(c,id)})}
  if(op==='add'&&c==='chat'){if(!allowed(u,'write',c))return err(res,403,'Not allowed');const t=String(data&&data.text||'').trim().slice(0,280);if(!t)return err(res,400,'Write something first.');const pk=await store.get('picks',u.id);const nm=String((pk&&pk.data&&pk.data.name)||'Player').slice(0,30);const n='a'+crypto.randomBytes(6).toString('hex');await store.set('chat',n,{uid:u.id,name:nm,text:t,ts:Date.now()});try{const all=await store.list('chat');if(all.length>400){all.sort((a,b)=>(a.data.ts||0)-(b.data.ts||0));for(const x of all.slice(0,all.length-300))await store.del('chat',x.id)}}catch(e){}return res.status(200).json({id:n})}
  if(op==='add'){if(!allowed(u,'write',c))return err(res,403,'Not allowed');const n='a'+crypto.randomBytes(6).toString('hex');await store.set(c,n,data||{});return res.status(200).json({id:n})}
  if(['set','update','delete'].includes(op)){
    if(!id||!allowed(u,'write',c,id))return err(res,403,'Not allowed');
    if(op==='set')await store.set(c,id,data||{});else if(op==='update')await store.update(c,id,data||{});else await store.del(c,id);
    return res.status(200).json({ok:1});
  }
  return err(res,400,'Bad request');
}
async function seed(store,req,res){
  const u=await user(store,req);if(!u||u.role!=='owner')return err(res,403,'Owner only');
  if((await store.list('games')).length)return res.status(200).json({seeded:0});
  const g=require('../seed.json');for(const d of g)await store.set('games',d.id,d.data);
  await store.set('meta','seed',{done:true});return res.status(200).json({seeded:g.length});
}

const ESPN='https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const CAP=12;
const seasonYr=()=>{const d=new Date();return d.getMonth()<6?d.getFullYear()-1:d.getFullYear()};
const calWeek=()=>Math.min(15,Math.max(1,Math.floor((Date.now()-Date.UTC(seasonYr(),7,25))/6048e5)+1));
const isoz=d=>{const t=new Date(d);return isNaN(t)?'':t.toISOString().replace(/\.\d+Z$/,'Z')};
const espnUrl=w=>{const y=seasonYr();return w>=16?`${ESPN}?groups=80&seasontype=3&dates=${y}1201-${y+1}0131&limit=300`:`${ESPN}?groups=80&dates=${y}&seasontype=2&week=${w}&limit=300`};
const postWeek=ev=>{const c=(ev.competitions||[])[0]||{},n=[...(c.notes||[]),...(ev.notes||[])].map(x=>x&&x.headline||'').join(' ')+' '+(ev.name||'');
  if(/national championship/i.test(n))return 22;if(/semifinal/i.test(n))return 21;if(/quarterfinal/i.test(n))return 20;if(/(playoff|cfp).*first round|first round.*(playoff|cfp)/i.test(n))return 19;return 16};
function mkLive(c,aw,hm,st){
  try{
    const s=c.situation||{},pt=[aw,hm].find(x=>x.team&&s.possession!==undefined&&String(x.team.id)===String(s.possession)),ld=[],K={passingYards:'Pass',rushingYards:'Rush',receivingYards:'Rec'};
    const take=(arr,abbr)=>{for(const L of(arr||[])){const k=K[L.name],x=k&&(L.leaders||[])[0];if(x&&x.athlete)ld.push({k,t:String(abbr||(x.team&&x.team.abbreviation)||'').slice(0,4),n:String(x.athlete.shortName||x.athlete.displayName||'').slice(0,30),s:String(x.displayValue||'').slice(0,60)})}};
    for(const t of[aw,hm])take(t.leaders,t.team&&t.team.abbreviation);
    if(!ld.length)take(c.leaders,'');
    const order={Pass:0,Rush:1,Rec:2};ld.sort((a,b)=>order[a.k]-order[b.k]);
    return{clk:String(st.shortDetail||st.detail||'').slice(0,30),poss:pt&&pt.team?String(pt.team.abbreviation||pt.team.name||'').slice(0,12):'',dd:String(s.downDistanceText||s.shortDownDistanceText||'').slice(0,40),rz:!!s.isRedZone,ld:ld.slice(0,6)};
  }catch(e){return null}
}
async function scores(store,req,res){
  if(req.method!=='POST')return err(res,405,'POST only');
  const u=await user(store,req);if(!u)return err(res,403,'Please sign in.');
  const isAdm=u.role!=='player',b=isAdm?(req.body||{}):{...(req.body||{}),all:false};
  if(!isAdm){const m=await store.get('meta','scoresync');if(m&&Date.now()-(m.data.t||0)<45000)return res.status(200).json({cached:true,weeks:[],finals:0,live:0,times:0,unmatched:0,created:0,tb:0,failed:0})}
  await store.set('meta','scoresync',{t:Date.now()});
  const all=await store.list('games'),gs=all.map(x=>({id:x.id,...x.data}));
  const wk=gs.filter(g=>typeof g.hs!=='number'||typeof g.as!=='number').map(g=>g.week).filter(Number.isFinite);
  const cur=wk.length?Math.min(...wk):calWeek();
  const near=gs.filter(g=>g.ko&&Math.abs(Date.parse(g.ko)-Date.now())<36*36e5).sort((a,b)=>Math.abs(Date.parse(a.ko)-Date.now())-Math.abs(Date.parse(b.ko)-Date.now())).map(g=>g.week).filter(Number.isFinite);
  const dec=new Date().getMonth()===11||new Date().getMonth()<=0,weeks=[...new Set((b.all?Array.from({length:16},(_,i)=>i+1):[...near,cur,cur+1].concat(dec?[16]:[])).map(w=>w>=16?16:w))].filter(w=>w>=1&&w<=16).slice(0,b.all?16:5);
  const out={weeks,finals:0,live:0,times:0,unmatched:0,created:0,tb:0,failed:0};
  const got=await Promise.all(weeks.map(async w=>{try{const r=await fetch(espnUrl(w),{signal:AbortSignal.timeout(9000)});if(!r.ok)throw new Error('status '+r.status);return{w,j:await r.json()}}catch(e){return{w,err:e}}}));
  const ok=got.filter(x=>!x.err);out.failed=got.length-ok.length;
  if(!ok.length)return err(res,502,'Could not reach the score service ('+(got[0].err&&got[0].err.message)+'). Try again in a minute.');
  for(const{w,j}of ok){
    let idx=0;
    const rk=t=>{const n=Number(t&&t.curatedRank&&t.curatedRank.current);return n>=1&&n<=25?n:99};
    const meta=new Map(),want=new Set();
    for(const ev of(j.events||[])){const c=(ev.competitions||[])[0];if(!c)continue;const aw=(c.competitors||[]).find(x=>x.homeAway==='away'),hm=(c.competitors||[]).find(x=>x.homeAway==='home');if(!aw||!hm)continue;
      const ew=w>=16?postWeek(ev):w;meta.set(ev.id,{ew,ar:rk(aw),hr:rk(hm),pre:((c.status||ev.status||{}).type||{}).state==='pre'})}
    const byW={};for(const[id,m]of meta){if(gs.some(x=>String(x.eid)===String(id)))continue;(byW[m.ew]=byW[m.ew]||[]).push({id,...m})}
    for(const ew of Object.keys(byW)){const e=+ew,have=gs.filter(x=>x.week===e).length;
      const q=byW[ew].filter(x=>x.pre&&(e>=19||Math.min(x.ar,x.hr)<=25)).sort((a,b)=>(a.ar<99&&a.hr<99?0:1)-(b.ar<99&&b.hr<99?0:1)||(a.ar+a.hr)-(b.ar+b.hr));
      q.slice(0,e>=19?20:Math.max(0,CAP-have)).forEach(x=>want.add(x.id))}
    for(const ev of(j.events||[])){
      const c=(ev.competitions||[])[0];if(!c)continue;
      const aw=(c.competitors||[]).find(x=>x.homeAway==='away'),hm=(c.competitors||[]).find(x=>x.homeAway==='home');if(!aw||!hm)continue;
      const mt=meta.get(ev.id)||{ew:w,ar:99,hr:99};let g=gs.find(x=>String(x.eid)===String(ev.id));
      if(!g){
        if(want.has(ev.id)&&aw.team&&hm.team){
          const nm=t=>String(t.shortDisplayName||t.location||t.displayName||'').slice(0,28);
          g={id:'c'+ev.id,week:mt.ew,away:nm(aw.team),home:nm(hm.team),ko:'',as:null,hs:null,locked:false,order:mt.ew*100+(idx++),tb:false,eid:String(ev.id),ar:mt.ar,hr:mt.hr};
          const{id:_i,...rest}=g;await store.set('games',g.id,rest);gs.push(g);out.created++;
        }else{out.unmatched++;continue}
      }
      const st=(c.status||ev.status||{}).type||{},patch={},ko=isoz(ev.date);
      if(ko&&g.ko!==ko){patch.ko=ko;out.times++}
      if(g.ar!==mt.ar||g.hr!==mt.hr){patch.ar=mt.ar;patch.hr=mt.hr}
      const a=Number(aw.score),h=Number(hm.score),has=aw.score!==undefined&&hm.score!==undefined&&!isNaN(a)&&!isNaN(h);
      if(st.completed&&has){if(g.as!==a||g.hs!==h||g.live||!g.locked){patch.as=a;patch.hs=h;patch.live=false;patch.locked=true;out.finals++}}
      else if(st.state==='in'&&has){if(g.as!==a||g.hs!==h||!g.live){patch.as=a;patch.hs=h;patch.live=true;patch.locked=true;out.live++}}
      try{const od=(c.odds||[])[0]||{},fv=od.homeTeamOdds&&od.homeTeamOdds.favorite?'h':od.awayTeamOdds&&od.awayTeamOdds.favorite?'a':'',ou=Number(od.overUnder)||0,bc=[...new Set((c.broadcasts||[]).flatMap(x=>x.names||[]))].join(', ').slice(0,60);
        const spv=Math.abs(Number(od.spread))||Math.abs(parseFloat(String(od.details||'').replace(/[^0-9.\-]+/g,' ').trim().split(' ').pop()))||0;
        if(fv&&g.fav!==fv)patch.fav=fv;if(ou&&g.ou!==ou)patch.ou=ou;if(spv&&g.sp!==spv)patch.sp=spv;if(bc&&g.bc!==bc)patch.bc=bc}catch(e){}
      if(st.state==='in'){const lv=mkLive(c,aw,hm,st);if(JSON.stringify(lv)!==JSON.stringify(g.lv||null))patch.lv=lv}else if(g.lv)patch.lv=null;
      if(Object.keys(patch).length){await store.update('games',g.id,patch);Object.assign(g,patch)}
    }
    if(w<=18){
      const ws=gs.filter(x=>x.week===w);
      if(ws.length&&ws.every(x=>x.ko)){
        const last=ws.reduce((m,x)=>x.ko>m.ko?x:m,ws[0]),cur=ws.find(x=>x.tb);
        if(!(cur&&(cur.tbSet||cur.id===last.id||cur.ko>=last.ko))){
          for(const x of ws)if(x.tb&&x.id!==last.id){await store.update('games',x.id,{tb:false});x.tb=false}
          await store.update('games',last.id,{tb:true});last.tb=true;out.tb++;
        }
      }
    }
  }
  return res.status(200).json(out);
}
async function health(store,req,res){
  if(req.method!=='POST')return err(res,405,'POST only');
  const u=await user(store,req);if(!u||u.role==='player')return err(res,403,'Commissioners only.');
  const c=[],add=(name,ok,note)=>c.push({name,ok,note});
  add('Database address',!!(process.env.DATABASE_URL||process.env.POSTGRES_URL),process.env.DATABASE_URL||process.env.POSTGRES_URL?'Found.':'Missing. In Vercel, open Storage and connect Neon, then redeploy.');
  let games=0;try{games=(await store.list('games')).length;add('Database connection',true,'Connected.')}catch(e){add('Database connection',false,'Could not read the database: '+(e&&e.message))}
  add('Games loaded',games>0,games?games+' games in the database.':'No games yet. Sign in as the owner and open any page, or use Check whole season.');
  add('Owner email',emails('OWNER_EMAIL').length>0,emails('OWNER_EMAIL').length?'Set.':'Missing. Add OWNER_EMAIL in Environment Variables and redeploy.');
  add('Session secret',!!process.env.SESSION_SECRET,process.env.SESSION_SECRET?'Set.':'Missing. Add SESSION_SECRET (a long random string) and redeploy. Until then logins use an unsafe default.');
  add('Email sending',N.cfg().email,N.cfg().email?'On. Winner letters and welcome notes go out by email.':'Off. Add RESEND_API_KEY and MAIL_FROM to send emails automatically. Until then letters appear in the app and you can send them with one tap.');
  add('Text sending',N.cfg().sms,N.cfg().sms?'On. Welcome texts and winner texts go out automatically.':'Off. Add TWILIO_SID, TWILIO_TOKEN and TWILIO_FROM to send texts automatically.');
  add('Invite code',!!process.env.INVITE_CODE,process.env.INVITE_CODE?'Set. New players need it to register. The referral code is optional.':'Not set, so anyone with the link can create an account. Add INVITE_CODE in Environment Variables to require one.');
  try{const r=await fetch(espnUrl(1),{signal:AbortSignal.timeout(6000)});add('Score feed',r.ok,r.ok?'Reachable.':'The score service answered with status '+r.status+'.')}catch(e){add('Score feed',false,'Could not reach the score service.')}
  return res.status(200).json({checks:c,you:u.role});
}

async function pot(store,req,res){
  const docs=await store.list('paid'),xd=await store.get('settings','xpot'),x=(xd&&xd.data)||{},rounds={};
  docs.forEach(d=>{const w=(d.data&&d.data.w)||{};Object.entries(w).forEach(([wk,v])=>{if(v==='paid'||v==='late')rounds[wk]=(rounds[wk]||0)+1})});
  let total=0,entries=0;
  Object.entries(rounds).forEach(([wk,n])=>{entries+=n;total+=n*8+(Number(x.s)||0)+(Number(x[wk])||0)});
  const ks=Object.keys(rounds).map(Number).filter(n=>n>0).sort((a,b)=>b-a),cw=ks[0]||0,cur=cw?rounds[cw]*8+(Number(x.s)||0)+(Number(x[cw])||0):0;
  res.setHeader('Cache-Control','s-maxage=30, stale-while-revalidate=60');
  return res.status(200).json({total,entries,rounds:Object.keys(rounds).length,week:cw,current:cur});
}
const N=require('./notify');
const WELCOME=(alias)=>`Hi ${alias||'there'}, thank you for joining VJ's College Pool! We're so glad you're here. We're always looking to improve and we're open to your suggestions, so tell the commissioner anything that would make the pool better. Good luck this week!`;
async function notify(store,req,res){
  if(req.method!=='POST')return err(res,405,'POST only');
  const u=await user(store,req);if(!u)return err(res,401,'Please sign in.');
  const b=req.body||{},L=LV[u.role]||1,c=N.cfg();
  if(b.op==='status'){if(L<2)return err(res,403,'Not allowed');const l=await store.list('notices');return res.status(200).json({email:c.email,sms:c.sms,sent:Object.fromEntries(l.map(x=>[x.id,{ts:x.data.ts,email:x.data.email,sms:x.data.sms,n:x.data.n}]))})}
  if(b.op==='welcome'){
    const key='welcome:'+u.id;if(await store.get('notices',key))return res.status(200).json({skipped:1});
    await store.set('notices',key,{ts:Date.now()});
    const e=await N.sendEmail(u.email,"Welcome to VJ's College Pool",WELCOME(b.alias)),t=await N.sendSms(b.phone,WELCOME(b.alias));
    return res.status(200).json({email:e,sms:t});
  }
  if(b.op==='letter'){
    if(L<2)return err(res,403,'Not allowed');
    const key=String(b.key||'').replace(/[^\w:.-]/g,'').slice(0,60);if(!key)return err(res,400,'Missing key');
    const id='letter:'+key,prev=await store.get('notices',id);if(prev&&!b.force)return res.status(200).json({skipped:1});
    const items=Array.isArray(b.items)?b.items.slice(0,300):[];let em=0,sm=0;
    for(const it of items){const body=String(it.body||'').slice(0,4000),sub=String(it.subject||'Pool results').slice(0,150);
      if(it.email&&await N.sendEmail(it.email,sub,body))em++;if(it.phone&&await N.sendSms(it.phone,String(it.sms||body).slice(0,1500)))sm++}
    if(!(prev&&prev.data&&prev.data.chat)&&b.chat){const n='a'+crypto.randomBytes(6).toString('hex');await store.set('chat',n,{uid:'pool',name:'\ud83c\udfc6 Pool news',text:String(b.chat).slice(0,280),ts:Date.now()})}
    await store.set('notices',id,{ts:Date.now(),email:em,sms:sm,n:items.length,chat:1});
    return res.status(200).json({email:em,sms:sm,n:items.length,configured:c});
  }
  return err(res,400,'Bad request');
}
const F=require('./fantasy');
async function fantasy(store,req,res){
  if(req.method!=='POST')return err(res,405,'POST only');
  const u=await user(store,req);if(!u)return err(res,401,'Please sign in.');
  return F.handle(store,u,req.body||{},res);
}
async function ask(store,req,res){
  if(req.method!=='POST')return err(res,405,'POST only');
  const u=await user(store,req);if(!u)return err(res,401,'Please sign in.');
  const key=process.env.ANTHROPIC_API_KEY;if(!key)return err(res,503,'The AI guide is not set up.');
  const b=req.body||{},q=String(b.q||'').trim().slice(0,300),ctx=String(b.ctx||'').slice(0,7000);if(!q)return err(res,400,'Ask a question first.');
  const day=new Date().toISOString().slice(0,10),lim=Number(process.env.ASK_LIMIT)||15,d=await store.get('askq',u.id),n=d&&d.data.d===day?d.data.n:0;
  if(n>=lim)return err(res,429,'You have used today\'s questions. Try again tomorrow.');
  await store.set('askq',u.id,{d:day,n:n+1});
  const sys="You are the friendly, professional guide for VJ's College Pool, an college football pick'em pool with side games. Answer only from the pool facts below. If the facts do not cover the question, say you are not sure and suggest asking the commissioner. Never invent rules, amounts or dates. Keep answers short and plain, 2 to 5 sentences, no markdown.\n\nPOOL FACTS:\n"+ctx;
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ASK_MODEL||'claude-haiku-5-5',max_tokens:350,system:sys,messages:[{role:'user',content:q}]}),signal:AbortSignal.timeout(20000)});
    if(!r.ok)return err(res,502,'The AI guide could not answer right now.');
    const j=await r.json(),t=((j.content||[]).find(x=>x.type==='text')||{}).text||'';return res.status(200).json({a:t.slice(0,1200)});
  }catch(e){return err(res,502,'The AI guide could not answer right now.')}
}
module.exports={auth,db,seed,scores,health,pot,allowed,roleFor,fantasy,ask,notify};
