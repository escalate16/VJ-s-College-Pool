const{neon}=require('@neondatabase/serverless');
let q,ready;
const sql=()=>q||(q=neon(process.env.DATABASE_URL||process.env.POSTGRES_URL));
const init=()=>ready||(ready=(async()=>{const s=sql();
  await s`create table if not exists docs(c text not null,id text not null,data jsonb not null,primary key(c,id))`;
  await s`create table if not exists users(id text primary key,email text unique not null,pw text not null)`})());
module.exports={
  async list(c){await init();return(await sql()`select id,data from docs where c=${c} order by id`).map(x=>({id:x.id,data:x.data}))},
  async get(c,id){await init();const r=await sql()`select data from docs where c=${c} and id=${id}`;return r[0]?{id,data:r[0].data}:null},
  async set(c,id,d){await init();await sql()`insert into docs(c,id,data) values(${c},${id},${JSON.stringify(d)}::jsonb) on conflict(c,id) do update set data=excluded.data`},
  async update(c,id,d){await init();await sql()`insert into docs(c,id,data) values(${c},${id},${JSON.stringify(d)}::jsonb) on conflict(c,id) do update set data=docs.data||excluded.data`},
  async del(c,id){await init();await sql()`delete from docs where c=${c} and id=${id}`},
  async userByEmail(e){await init();return(await sql()`select id,email,pw from users where email=${e}`)[0]||null},
  async userById(i){await init();return(await sql()`select id,email,pw from users where id=${i}`)[0]||null},
  async setPw(id,pw){await init();await sql()`update users set pw=${pw} where id=${id}`},
  async delUser(id){await init();await sql()`delete from users where id=${id}`},
  async addUser(u){await init();await sql()`insert into users(id,email,pw) values(${u.id},${u.email},${u.pw})`}
};
