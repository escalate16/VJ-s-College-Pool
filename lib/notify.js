// Optional email (Resend) and text (Twilio) delivery. Does nothing unless the env vars are set.
const cfg=()=>({email:!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM),sms:!!(process.env.TWILIO_SID&&process.env.TWILIO_TOKEN&&process.env.TWILIO_FROM)});
const phone=p=>{const d=String(p||'').replace(/[^\d+]/g,'');if(/^\+\d{10,15}$/.test(d))return d;const n=d.replace(/\D/g,'');if(n.length===10)return'+1'+n;if(n.length===11&&n[0]==='1')return'+'+n;return''};
const mailOk=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||''));
async function sendEmail(to,subject,text){
  if(!cfg().email||!mailOk(to))return false;
  try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[to],subject:String(subject).slice(0,150),text:String(text).slice(0,8000)})});return r.ok}catch(e){return false}
}
async function sendSms(to,body){
  const n=phone(to);if(!cfg().sms||!n)return false;
  try{const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+process.env.TWILIO_SID+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.TWILIO_SID+':'+process.env.TWILIO_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:n,From:process.env.TWILIO_FROM,Body:String(body).slice(0,1500)}).toString()});return r.ok}catch(e){return false}
}
module.exports={cfg,phone,mailOk,sendEmail,sendSms};
