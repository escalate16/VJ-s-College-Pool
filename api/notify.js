const core=require('../lib/core'),store=require('../lib/store');
module.exports=(req,res)=>core.notify(store,req,res).catch(e=>{console.error(e);res.status(500).json({error:'Server error: '+(e&&e.message)})});
