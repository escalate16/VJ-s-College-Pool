// Diagnostic: shows what ESPN returns for a college football week. Public data only, no login or database.
module.exports=async(req,res)=>{
  const y=(()=>{const d=new Date();return d.getMonth()<6?d.getFullYear()-1:d.getFullYear()})();
  const q=(req.query&&req.query.w)||'13';
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&dates=${y}&seasontype=2&week=${encodeURIComponent(q)}&limit=300`;
  const out={url,now:new Date().toISOString()};
  try{
    const r=await fetch(url);out.status=r.status;const j=await r.json();
    const ev=j.events||[];out.events=ev.length;out.topKeys=Object.keys(j).slice(0,12);
    out.sample=ev.slice(0,6).map(e=>{const c=(e.competitions||[])[0]||{};return{name:e.name,date:e.date,state:((c.status||e.status||{}).type||{}).state,ranks:(c.competitors||[]).map(t=>t.curatedRank&&t.curatedRank.current)}});
    out.ranked=ev.filter(e=>((e.competitions||[])[0]||{}).competitors&&(e.competitions[0].competitors||[]).some(t=>t.curatedRank&&t.curatedRank.current>=1&&t.curatedRank.current<=25)).length;
    out.pre=ev.filter(e=>(((e.competitions||[])[0]||{}).status||e.status||{}).type&&((((e.competitions||[])[0]||{}).status||e.status).type.state==='pre')).length;
  }catch(e){out.error=String(e&&e.message||e)}
  res.setHeader('content-type','application/json');res.status(200).send(JSON.stringify(out,null,1));
};
