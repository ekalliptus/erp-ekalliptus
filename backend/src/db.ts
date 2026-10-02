import {Injectable,OnModuleDestroy,ServiceUnavailableException} from '@nestjs/common';
import {Pool,PoolClient,types} from 'pg';
types.setTypeParser(1082,v=>v);
export function camel(row:any):any {if(Array.isArray(row))return row.map(camel);if(row&&typeof row==='object'&&!(row instanceof Date))return Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),camel(v)]));return row;}
@Injectable()
export class Db implements OnModuleDestroy {readonly pool:Pool;constructor(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');this.pool=new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000,statement_timeout:15000});this.pool.on('error',()=>console.error('PostgreSQL pool connection error'));}async onModuleDestroy(){await this.pool.end();}async rows(sql:string,args:any[]=[]){return camel((await this.pool.query(sql,args)).rows);}async tx<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{const c=await this.pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return camel(r);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}}
export async function one(c:PoolClient,sql:string,args:any[]=[]){return (await c.query(sql,args)).rows[0];}
