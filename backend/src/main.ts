import 'reflect-metadata';
import {ArgumentsHost,Body,Catch,Controller,ExceptionFilter,Get,HttpException,Module,Param,Patch,Post,Req,ServiceUnavailableException} from '@nestjs/common';
import {APP_GUARD,NestFactory} from '@nestjs/core';
import {Db} from './db';
import {Auth,AccessGuard,Public,Roles} from './auth';
import {body} from './domain';
import {Erp} from './service';
@Controller()
class Api {constructor(private db:Db,private auth:Auth,private erp:Erp){}
@Post('auth/login') @Public() login(@Body() b:unknown,@Req() r:any){return this.auth.login(body(b),r.ip??'unknown');}
@Get('auth/me') me(@Req() r:any){return r.user;}
@Post('auth/logout') async logout(@Req() r:any){await this.db.rows('DELETE FROM sessions WHERE token_hash=$1',[r.tokenHash]);return {ok:true};}
@Get('customers') customers(){return this.db.rows('SELECT * FROM customers ORDER BY created_at DESC LIMIT 200');}
@Post('customers') @Roles('finance_admin','cashier') customer(@Body() b:unknown){return this.erp.customer(body(b));}
@Get('inventory') inventory(){return this.db.rows('SELECT * FROM inventory ORDER BY created_at DESC LIMIT 200');}
@Post('inventory') @Roles() addInventory(@Body() b:unknown){return this.erp.inventory(body(b));}
@Post('inventory/:id/adjust') @Roles() adjust(@Param('id') id:string,@Body() b:unknown,@Req() r:any){return this.erp.adjust(id,body(b),r.user.id);}
@Get('orders') orders(){return this.db.rows("SELECT o.id,o.order_number,o.customer_id,o.total_amount,o.items,o.created_at,i.id AS invoice_id FROM orders o JOIN invoices i ON i.source_id=o.id AND i.source_module='pos' ORDER BY o.created_at DESC LIMIT 200");}
@Post('orders') @Roles('cashier') order(@Body() b:unknown,@Req() r:any){return this.erp.order(body(b),r.user.id);}
@Get('repairs') repairs(){return this.db.rows('SELECT * FROM repairs ORDER BY created_at DESC LIMIT 200');}
@Post('repairs') @Roles('hardware_tech','cashier') repair(@Body() b:unknown){return this.erp.repair(body(b));}
@Post('repairs/:id/quotation') @Roles('hardware_tech') quotation(@Param('id') id:string,@Body() b:unknown){return this.erp.quotation(id,body(b));}
@Patch('repairs/:id/state') @Roles('hardware_tech') state(@Param('id') id:string,@Body() b:unknown,@Req() r:any){return this.erp.repairState(id,body(b),r.user.id);}
@Get('projects') projects(){return this.db.rows("SELECT p.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'projectId',m.project_id,'name',m.name,'amount',m.amount::text,'status',m.status,'invoiceId',m.invoice_id,'completedAt',m.completed_at) ORDER BY m.name) FROM milestones m WHERE m.project_id=p.id),'[]'::jsonb) AS milestones FROM projects p ORDER BY p.created_at DESC LIMIT 200");}
@Post('projects') @Roles('software_dev') project(@Body() b:unknown){return this.erp.project(body(b));}
@Post('projects/:id/milestones/:mid/complete') @Roles('software_dev') complete(@Param('id') id:string,@Param('mid') mid:string,@Req() r:any){return this.erp.complete(id,mid,r.user.id);}
@Get('invoices') @Roles('finance_admin','cashier') invoices(){return this.db.rows('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 200');}
@Post('invoices/:id/payments') @Roles('finance_admin','cashier') payment(@Param('id') id:string,@Body() b:unknown,@Req() r:any){return this.erp.payment(id,body(b),r.user.id);}
@Get('ledger') @Roles('finance_admin') ledger(){return this.db.rows("SELECT j.id,j.reference_type,j.reference_id,j.memo,j.created_at,(SELECT jsonb_agg(jsonb_build_object('accountCode',l.account_code,'debit',l.debit::text,'credit',l.credit::text)) FROM journal_lines l WHERE l.journal_id=j.id) AS lines FROM journals j ORDER BY j.created_at DESC LIMIT 200");}
@Get('dashboard') @Roles('finance_admin') async dashboard(){const [d]=await this.db.rows("SELECT (SELECT coalesce(sum(total_amount),0)::numeric(15,2)::text FROM orders WHERE created_at>=current_date) AS sales_today,(SELECT coalesce(sum(total_amount-paid_amount),0)::numeric(15,2)::text FROM invoices) AS outstanding_receivables,(SELECT count(*)::int FROM orders) AS order_count,(SELECT count(*)::int FROM customers) AS customer_count,(SELECT count(*)::int FROM inventory WHERE current_stock<=minimum_threshold) AS low_stock_count,(SELECT count(*)::int FROM repairs WHERE current_state NOT IN ('delivered_closed','cancelled_unrepairable')) AS open_repairs,(SELECT count(*)::int FROM projects WHERE status<>'completed') AS active_projects");return {...d,integrations:{ppob:'unavailable',whatsapp:'unavailable',paymentGateway:'unavailable'}};}
@Post('integrations/:provider') unavailable(){throw new ServiceUnavailableException('Integration unavailable: no provider configured');}
@Get('health') @Public() async health(){await this.db.rows('SELECT 1');return {status:'ok'};}
}
@Catch()
class Errors implements ExceptionFilter {catch(e:any,host:ArgumentsHost){const res=host.switchToHttp().getResponse();let status=500,message='Internal server error';if(e instanceof HttpException){status=e.getStatus();const r=e.getResponse();message=typeof r==='string'?r:(r as any).message;}else if(['23505','23503','23514','22003','22007','22008','22P02'].includes(e.code)){status=e.code==='23505'?409:400;message=e.code==='23505'?'Duplicate record or reference':'Invalid data or conflicting reference';}else if(['ECONNREFUSED','ETIMEDOUT','57P01','53300','08006'].includes(e.code)){status=503;message='Database unavailable';}else console.error('Request failed',e.code??e.name);res.status(status).json({statusCode:status,message});}}
@Module({controllers:[Api],providers:[Db,Auth,Erp,{provide:APP_GUARD,useClass:AccessGuard}]})
class App {}
async function main(){const app=await NestFactory.create(App,{bodyParser:true});app.setGlobalPrefix('api/v1');app.enableCors({origin:process.env.CORS_ORIGIN??'http://localhost:3100',allowedHeaders:['Content-Type','Authorization'],methods:['GET','POST','PATCH','OPTIONS']});app.useGlobalFilters(new Errors());app.enableShutdownHooks();await app.listen(Number(process.env.PORT??3000),process.env.HOST??'127.0.0.1');}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
