const core=require('../lib/core'),store=require('../lib/store');
module.exports=(req,res)=>core.db(store,req,res).catch(e=>{console.error(e);res.status(500).json({error:'Server error. Check the Vercel logs and that the database is connected.'})});
