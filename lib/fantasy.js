// Fantasy football: draft, lineups, add/drop, trades, head-to-head schedule, stats sync.
// All writes happen here (server-checked); clients only read the collections.
const crypto=require('crypto');
const SL=['QB','RB','RB','WR','WR','TE','FLEX','K','DEF'];
const ELIG={QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],FLEX:['RB','WR','TE'],K:['K'],DEF:['DEF']};
const CAP={QB:4,RB:8,WR:8,TE:4,K:2,DEF:2};
const ABBR={Cardinals:'ARI',Falcons:'ATL',Ravens:'BAL',Bills:'BUF',Panthers:'CAR',Bears:'CHI',Bengals:'CIN',Browns:'CLE',Cowboys:'DAL',Broncos:'DEN',Lions:'DET',Packers:'GB',Texans:'HOU',Colts:'IND',Jaguars:'JAX',Chiefs:'KC',Raiders:'LV',Chargers:'LAC',Rams:'LAR',Dolphins:'MIA',Vikings:'MIN',Patriots:'NE',Saints:'NO',Giants:'NYG',Jets:'NYJ',Eagles:'PHI',Steelers:'PIT','49ers':'SF',Seahawks:'SEA',Buccaneers:'TB',Titans:'TEN',Commanders:'WAS'};
const DEF_CFG={on:false,fee:7,adm:2,start:12,end:17,mode:'h2h',sc:'pts_half_ppr',rmax:15,trade:true,tdl:0,sec:90,draft:{st:'off',order:[],n:0,dl:0,rounds:15},sched:{}};
const season=()=>{if(process.env.NFL_SEASON)return Number(process.env.NFL_SEASON);const d=new Date();return d.getMonth()<6?d.getFullYear()-1:d.getFullYear()};
const abbr=n=>{n=String(n||'').trim();if(ABBR[n])return ABBR[n];const k=Object.keys(ABBR).find(x=>n.endsWith(x));return k?ABBR[k]:n};
const fin=g=>typeof g.hs==='number'&&typeof g.as==='number'&&!g.live;
const gLocked=g=>!!(g.locked||g.live||fin(g)||(g.ko&&Date.now()>=Date.parse(g.ko)));

async function cfgOf(store){const d=await store.get('fl','cfg');return{...DEF_CFG,...(d&&d.data||{}),draft:{...DEF_CFG.draft,...((d&&d.data&&d.data.draft)||{})}}}
const saveCfg=(store,c)=>store.set('fl','cfg',c);
async function teamsOf(store){const o={};for(const x of await store.list('fteam'))o[x.id]=x.data;return o}
async function gamesOf(store){return(await store.list('games')).map(x=>({id:x.id,...x.data}))}
async function playersOf(store){const d=await store.get('fplayers','all');if(!d)return{p:[],map:{}};const map={};d.data.p.forEach(r=>map[r[0]]={id:r[0],name:r[1],pos:r[2],team:r[3],rank:r[4],inj:r[5]});return{p:d.data.p,map,t:d.data.t}}
function curWeek(games,cfg){const w=games.filter(g=>!fin(g)).map(g=>g.week).filter(Number.isFinite);return w.length?Math.min(...w):cfg.end}
function lockedPlayer(pl,week,games){if(!pl)return false;const g=games.find(x=>x.week===week&&(abbr(x.home)===pl.team||abbr(x.away)===pl.team));return g?gLocked(g):false}
function effLU(team,w,start){for(let k=w;k>=Math.max(1,start);k--)if(team.lu&&team.lu[k])return team.lu[k];return Array(SL.length).fill(null)}
const owned=teams=>{const s=new Set();Object.values(teams).forEach(t=>(t.roster||[]).forEach(p=>s.add(p)));return s};
const posCount=(roster,map,pos)=>roster.filter(p=>map[p]&&map[p].pos===pos).length;

function bestLU(roster,map){
  const by=r=>[...roster].filter(p=>map[p]).sort((a,b)=>map[a].rank-map[b].rank),used=new Set(),out=Array(SL.length).fill(null);
  SL.forEach((s,i)=>{if(s==='FLEX')return;const c=by().find(p=>!used.has(p)&&ELIG[s].includes(map[p].pos));if(c){out[i]=c;used.add(c)}});
  const fi=SL.indexOf('FLEX'),c=by().find(p=>!used.has(p)&&ELIG.FLEX.includes(map[p].pos));if(c){out[fi]=c}
  return out;
}
function cleanLU(team,pids,fromWeek){const lu={...(team.lu||{})};for(const w of Object.keys(lu)){if(+w>=fromWeek&&lu[w])lu[w]=lu[w].map(p=>pids.includes(p)?null:p)}return lu}

function robin(ids,weeks){
  const a=[...ids];if(a.length%2)a.push(null);const n=a.length,rounds=[];
  for(let r=0;r<n-1;r++){const m=[];for(let i=0;i<n/2;i++){const x=a[i],y=a[n-1-i];m.push(x===null?[y,null]:y===null?[x,null]:[x,y])}rounds.push(m);a.splice(1,0,a.pop())}
  const out={};weeks.forEach((w,i)=>{out[w]=rounds[i%rounds.length]});return out;
}

async function sleeperPlayers(store){
  const r=await fetch('https://api.sleeper.app/v1/players/nfl',{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('Sleeper player list status '+r.status);
  const j=await r.json(),POS=['QB','RB','WR','TE','K','DEF'],p=[];
  for(const [id,x] of Object.entries(j)){
    if(!x||!POS.includes(x.position)||!x.team)continue;
    const isKD=x.position==='K'||x.position==='DEF',rank=Number(x.search_rank)||9999;
    if(x.active===false&&!isKD)continue;
    if(!isKD&&rank>2500)continue;
    const nm=x.full_name||[x.first_name,x.last_name].filter(Boolean).join(' ')||id;
    p.push([String(id),String(nm).slice(0,40),x.position,String(x.team),rank,x.injury_status?String(x.injury_status).slice(0,3):'']);
  }
  p.sort((a,b)=>a[4]-b[4]);
  if(p.length<50)throw new Error('Player list looked empty');
  await store.set('fplayers','all',{t:Date.now(),p});return p.length;
}

function pickPts(item,sc){const s=item&&(item.stats||item);const v=s&&s[sc];return typeof v==='number'?v:null}
async function syncStats(store,cfg,week,force){
  const sid=season()+'_'+week,old=await store.get('fstats',sid);
  if(!force&&old&&Date.now()-(old.data.t||0)<45000)return{n:Object.keys(old.data.pts||{}).length,cached:true};
  const post=week>18,wk=post?week-18:week,st=post?'post':'regular',pts={};
  let got=false;
  try{
    const r=await fetch(`https://api.sleeper.com/stats/nfl/${season()}/${wk}?season_type=${st}`,{signal:AbortSignal.timeout(9000)});
    if(r.ok){const j=await r.json();
      if(Array.isArray(j)){for(const it of j){const id=it.player_id||(it.player&&it.player.player_id);const v=pickPts(it,cfg.sc);if(id&&v!==null){pts[String(id)]=v;got=true}}}
      else if(j&&typeof j==='object'){for(const [id,it] of Object.entries(j)){const v=pickPts(it,cfg.sc);if(v!==null){pts[String(id)]=v;got=true}}}
    }
  }catch(e){}
  if(!got){
    const teams=await teamsOf(store),ids=[...owned(teams)];
    for(let i=0;i<ids.length;i+=25){
      await Promise.all(ids.slice(i,i+25).map(async id=>{try{
        const r=await fetch(`https://api.sleeper.com/stats/nfl/player/${id}?season_type=${st}&season=${season()}&grouping=week`,{signal:AbortSignal.timeout(9000)});if(!r.ok)return;
        const j=await r.json(),row=j&&(j[String(wk)]||j[wk]);const v=pickPts(row,cfg.sc);if(v!==null){pts[id]=v;got=true}
      }catch(e){}}));
    }
  }
  if(!got&&!old)return{n:0,none:true};
  const merged={...((old&&old.data.pts)||{}),...pts};
  await store.set('fstats',sid,{t:Date.now(),pts:merged});return{n:Object.keys(merged).length};
}

async function applyPick(store,cfg,teams,uid,pid,map){
  const t=teams[uid];t.roster=[...(t.roster||[]),pid];await store.set('fteam',uid,t);
  const d=cfg.draft,N=d.order.length;d.n++;d.dl=Date.now()+(cfg.sec||90)*1000;
  if(d.n>=N*d.rounds){d.st='done';d.dl=0;for(const [id,tm] of Object.entries(teams)){tm.lu={...(tm.lu||{}),[cfg.start]:bestLU(tm.roster||[],map)};await store.set('fteam',id,tm)}}
  await saveCfg(store,cfg);
}
const onClock=d=>{const N=d.order.length;if(!N)return null;const r=Math.floor(d.n/N),i=d.n%N;return d.order[r%2===0?i:N-1-i]};
async function autoPick(cfg,teams,map,plist){
  const uid=onClock(cfg.draft),t=teams[uid],ros=t.roster||[],own=owned(teams),late=Math.floor(cfg.draft.n/cfg.draft.order.length)>=cfg.draft.rounds-2;
  const need=(p)=>(CAP[p.pos]||0)>posCount(ros,map,p.pos)&&(late||(p.pos!=='K'&&p.pos!=='DEF'));
  const row=plist.find(r=>!own.has(r[0])&&need({pos:r[2]}))||plist.find(r=>!own.has(r[0]));
  return row&&row[0];
}
async function tick(store){
  let cfg=await cfgOf(store);if(cfg.draft.st!=='live')return cfg;
  const {p,map}=await playersOf(store),teams=await teamsOf(store);let guard=0;
  while(cfg.draft.st==='live'&&cfg.draft.dl&&Date.now()>cfg.draft.dl&&guard++<60){
    const pid=await autoPick(cfg,teams,map,p);if(!pid)break;
    await applyPick(store,cfg,teams,onClock(cfg.draft),pid,map);
  }
  return cfg;
}

async function handle(store,u,b,res){
  const ok=j=>res.status(200).json(j||{ok:1}),bad=(c,m)=>res.status(c).json({error:m}),adm=u.role!=='player',uid=u.id;
  const op=b.op;
  if(op==='players'){
    let d=await playersOf(store);
    if(!d.p.length&&adm){try{await sleeperPlayers(store);d=await playersOf(store)}catch(e){return bad(502,'Could not load the NFL player list: '+e.message)}}
    return ok({t:d.t||0,p:d.p});
  }
  if(op==='psync'){if(!adm)return bad(403,'Commissioners only.');try{return ok({n:await sleeperPlayers(store)})}catch(e){return bad(502,'Could not load the NFL player list: '+e.message)}}
  if(op==='cfg'){
    if(!adm)return bad(403,'Commissioners only.');const c=await cfgOf(store),x=b.cfg||{};
    const num=(k,lo,hi)=>{if(x[k]!==undefined){const v=Number(x[k]);if(!Number.isFinite(v)||v<lo||v>hi)throw new Error('Bad '+k);c[k]=v}};
    try{
      if(x.on!==undefined)c.on=!!x.on;if(x.trade!==undefined)c.trade=!!x.trade;
      if(x.mode!==undefined){if(!['h2h','total'].includes(x.mode))throw new Error('Bad mode');c.mode=x.mode}
      if(x.sc!==undefined){if(!['pts_ppr','pts_half_ppr','pts_std'].includes(x.sc))throw new Error('Bad scoring');c.sc=x.sc}
      num('fee',0,500);num('adm',0,500);num('start',1,22);num('end',1,22);num('rmax',9,20);num('tdl',0,22);num('sec',15,600);
      if(c.end<c.start)throw new Error('End week must be after the start week.');
    }catch(e){return bad(400,e.message)}
    await saveCfg(store,c);return ok({cfg:c});
  }
  if(op==='draftstart'){
    if(!adm)return bad(403,'Commissioners only.');const c=await cfgOf(store);
    if(!c.on)return bad(400,'Turn the fantasy game on first.');
    const {p}=await playersOf(store);if(!p.length)return bad(400,'Load the NFL player list first.');
    const paid=(await store.list('fpaid')).filter(x=>x.data&&x.data.on).map(x=>x.id);
    if(paid.length<2)return bad(400,'Mark at least 2 players as paid first.');
    const old=await teamsOf(store);
    for(const id of paid){const pk=await store.get('picks',id);const nm=(pk&&pk.data&&pk.data.name)||'Team';await store.set('fteam',id,{name:String(nm).slice(0,30)+"'s team",roster:[],lu:{},ts:Date.now()})}
    for(const id of Object.keys(old))if(!paid.includes(id))await store.del('fteam',id);
    const order=paid.map(x=>[crypto.randomInt(1e9),x]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    c.draft={st:'live',order,n:0,dl:Date.now()+(c.sec||90)*1000,rounds:c.rmax};c.sched={};await saveCfg(store,c);return ok({order});
  }
  if(op==='tick'){const c=await tick(store);return ok({draft:c.draft})}
  if(op==='draft'){
    let c=await tick(store);const d=c.draft;if(d.st!=='live')return bad(400,'The draft is not running.');
    const who=onClock(d);if(who!==uid&&!(adm&&b.force))return bad(403,'It is not your turn.');
    const {map,p}=await playersOf(store),teams=await teamsOf(store),pl=map[String(b.pid)];
    if(!pl)return bad(400,'Unknown player.');if(owned(teams).has(pl.id))return bad(400,'That player was already drafted.');
    const t=teams[who];if(posCount(t.roster||[],map,pl.pos)>=CAP[pl.pos])return bad(400,'Your roster is full at '+pl.pos+'.');
    await applyPick(store,c,teams,who,pl.id,map);return ok({pick:pl.id});
  }
  if(op==='sched'){
    if(!adm)return bad(403,'Commissioners only.');const c=await cfgOf(store),teams=await teamsOf(store),ids=Object.keys(teams);
    if(ids.length<2)return bad(400,'Need at least 2 teams.');
    const {map}=await playersOf(store),weeks=[];for(let w=c.start;w<=c.end;w++)weeks.push(w);
    c.sched=c.mode==='h2h'?robin(ids,weeks):{};await saveCfg(store,c);
    for(const id of ids){const t=teams[id];if(!(t.lu&&t.lu[c.start])){t.lu={...(t.lu||{}),[c.start]:bestLU(t.roster||[],map)};await store.set('fteam',id,t)}}
    return ok({weeks:weeks.length,teams:ids.length});
  }
  if(op==='lineup'){
    const c=await cfgOf(store),teams=await teamsOf(store),t=teams[uid];if(!t)return bad(400,'You do not have a fantasy team.');
    const games=await gamesOf(store),{map}=await playersOf(store),w=Number(b.week),sl=Array.isArray(b.slots)?b.slots.slice(0,SL.length):[];
    if(!(w>=c.start&&w<=c.end))return bad(400,'That week is outside the fantasy season.');
    if(w<curWeek(games,c))return bad(400,'That week is over.');
    while(sl.length<SL.length)sl.push(null);const seen=new Set(),roster=t.roster||[];
    for(let i=0;i<SL.length;i++){const p=sl[i];if(!p)continue;
      if(!roster.includes(p))return bad(400,'A starter is not on your roster.');
      if(seen.has(p))return bad(400,'A player is in two slots.');seen.add(p);
      if(!ELIG[SL[i]].includes(map[p]&&map[p].pos))return bad(400,(map[p]&&map[p].name||'Player')+' cannot play '+SL[i]+'.')}
    const cur=effLU(t,w,c.start);
    for(let i=0;i<SL.length;i++){if((cur[i]||null)===(sl[i]||null))continue;
      for(const p of[cur[i],sl[i]])if(p&&lockedPlayer(map[p],w,games))return bad(400,(map[p].name)+"'s game has started, so that slot is locked.")}
    t.lu={...(t.lu||{}),[w]:sl.map(x=>x||null)};await store.set('fteam',uid,t);return ok();
  }
  if(op==='add'){
    const c=await cfgOf(store);if(!c.on||c.draft.st==='live')return bad(400,'Adds are not open right now.');
    const teams=await teamsOf(store),t=teams[uid];if(!t)return bad(400,'You do not have a fantasy team.');
    const games=await gamesOf(store),{map}=await playersOf(store),cw=curWeek(games,c),pl=map[String(b.pid)];
    if(!pl)return bad(400,'Unknown player.');if(owned(teams).has(pl.id))return bad(400,'That player is on a team already.');
    if(lockedPlayer(pl,cw,games))return bad(400,'That player\'s game has started.');
    let ros=[...(t.roster||[])];
    if(b.drop){const dp=map[String(b.drop)];if(!ros.includes(String(b.drop)))return bad(400,'You do not own that player.');
      const eff=effLU(t,cw,c.start);if(eff.includes(String(b.drop))&&lockedPlayer(dp,cw,games))return bad(400,'That player is locked in your lineup this week.');
      ros=ros.filter(x=>x!==String(b.drop));t.lu=cleanLU(t,[String(b.drop)],cw)}
    if(ros.length>=c.rmax)return bad(400,'Your roster is full. Pick a player to drop.');
    if(posCount(ros,map,pl.pos)>=CAP[pl.pos])return bad(400,'Your roster is full at '+pl.pos+'.');
    t.roster=[...ros,pl.id];await store.set('fteam',uid,t);return ok();
  }
  if(op==='trade'){
    const c=await cfgOf(store);if(!c.on||!c.trade||c.draft.st==='live')return bad(400,'Trades are closed.');
    const games=await gamesOf(store);if(c.tdl&&curWeek(games,c)>c.tdl)return bad(400,'The trade deadline has passed.');
    const teams=await teamsOf(store),a=teams[uid],to=String(b.to||''),bt=teams[to];
    if(!a||!bt||to===uid)return bad(400,'Pick another team to trade with.');
    const give=(b.give||[]).map(String),get=(b.get||[]).map(String);
    if(!give.length&&!get.length)return bad(400,'Choose at least one player.');if(give.length>5||get.length>5)return bad(400,'At most 5 players each way.');
    if(!give.every(p=>(a.roster||[]).includes(p))||!get.every(p=>(bt.roster||[]).includes(p)))return bad(400,'A player is no longer on that roster.');
    const id='t'+crypto.randomBytes(5).toString('hex');await store.set('ftrade',id,{from:uid,to,give,get,st:'open',ts:Date.now()});return ok({id});
  }
  if(op==='tradeact'){
    const tr=await store.get('ftrade',String(b.id));if(!tr||tr.data.st!=='open')return bad(400,'That trade is not open.');const x=tr.data,act=b.act;
    if(act==='cancel'){if(x.from!==uid&&!adm)return bad(403,'Not your trade.');await store.set('ftrade',tr.id,{...x,st:'no'});return ok()}
    if(act==='reject'){if(x.to!==uid&&!adm)return bad(403,'Not your trade.');await store.set('ftrade',tr.id,{...x,st:'no'});return ok()}
    if(act!=='accept'||x.to!==uid)return bad(403,'Only the other team can accept.');
    const c=await cfgOf(store);if(!c.on||!c.trade||c.draft.st==='live')return bad(400,'Trades are closed.');
    const games=await gamesOf(store);if(c.tdl&&curWeek(games,c)>c.tdl)return bad(400,'The trade deadline has passed.');
    const teams=await teamsOf(store),a=teams[x.from],t2=teams[x.to],{map}=await playersOf(store),cw=curWeek(games,c);
    if(!a||!t2||!x.give.every(p=>(a.roster||[]).includes(p))||!x.get.every(p=>(t2.roster||[]).includes(p)))return bad(400,'A player has moved since this was offered.');
    for(const p of[...x.give,...x.get])if(lockedPlayer(map[p],cw,games))return bad(400,(map[p]&&map[p].name||'A player')+"'s game has started. Try again after it ends.");
    const ra=[...a.roster.filter(p=>!x.give.includes(p)),...x.get],rb=[...t2.roster.filter(p=>!x.get.includes(p)),...x.give];
    if(ra.length>c.rmax||rb.length>c.rmax)return bad(400,'That trade would put a roster over the limit.');
    for(const [r] of[[ra],[rb]])for(const pos of Object.keys(CAP))if(posCount(r,map,pos)>CAP[pos])return bad(400,'That trade would put a roster over the '+pos+' limit.');
    a.roster=ra;t2.roster=rb;a.lu=cleanLU(a,x.give,cw);t2.lu=cleanLU(t2,x.get,cw);
    await store.set('fteam',x.from,a);await store.set('fteam',x.to,t2);await store.set('ftrade',tr.id,{...x,st:'done',done:Date.now()});
    const moved=[...x.give,...x.get];
    for(const o of await store.list('ftrade'))if(o.id!==tr.id&&o.data.st==='open'&&[...o.data.give,...o.data.get].some(p=>moved.includes(p)))await store.set('ftrade',o.id,{...o.data,st:'no'});
    return ok();
  }
  if(op==='sync'){
    const c=await cfgOf(store),w=Number(b.week);if(!(w>=1&&w<=22))return bad(400,'Bad week.');
    const r=await syncStats(store,c,w,adm&&!!b.force);if(r.none)return bad(502,'Could not read player stats from the stats feed.');return ok(r);
  }
  return bad(400,'Bad request');
}
module.exports={handle,SL,ELIG,CAP,robin,bestLU,onClock,effLU,abbr,season,cfgOf,DEF_CFG};
