import type {WalletFixedRule,WalletState,WalletTransaction,WalletCurrency} from "./wallet-types";
export const walletMonth=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
const monthNumber=(s:string)=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
const validMonth=(s:unknown):s is string=>typeof s==="string"&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function normalizeWalletFixedRules(value:unknown,currencies:readonly string[]):WalletFixedRule[]{
 if(!Array.isArray(value))return[];const ids=new Set<string>();
 return value.flatMap((r):WalletFixedRule[]=>{
  if(!r||typeof r!=="object"||typeof r.id!=="string"||ids.has(r.id)||!r.title?.trim()||!['income','expense','debt'].includes(r.kind)||!currencies.includes(r.currency)||!Number.isFinite(r.amount)||r.amount<=0||r.amount>1e9||!validMonth(r.startMonth))return[];
  if(r.day!=="last"&&(!Number.isInteger(r.day)||r.day<1||r.day>31))return[];
  if(r.endMonth&&(!validMonth(r.endMonth)||r.endMonth<r.startMonth))return[];
  if(r.kind==='debt'&&r.debtTarget==='loan'&&(!Number.isFinite(r.principal)||r.principal<0||!Number.isFinite(r.principalPerPayment)||r.principalPerPayment<=0||r.principalPerPayment>r.amount))return[];
  const unit=r.currency==='JPY'||r.currency==='KRW'?1:100,amount=Math.round(r.amount*unit)/unit;if(amount<=0)return[];
  ids.add(r.id);return[{id:r.id.slice(0,100),title:r.title.trim().slice(0,100),kind:r.kind,currency:r.currency,amount,day:r.day,startMonth:r.startMonth,endMonth:r.endMonth||undefined,enabled:r.enabled!==false,...(r.kind==='debt'?{debtTarget:r.debtTarget==='loan'?'loan':'credit',principal:r.principal,principalPerPayment:r.principalPerPayment}:{})}];
 }).slice(0,100);
}
/** Pure, synchronous settlement: no timer, API, storage or model calls. */
export function settleFixedWalletDraft(input:WalletState,now=Date.now(),round:(n:number,c:WalletCurrency)=>number=(n,c)=>Math.round(n*(c==='JPY'||c==='KRW'?1:100))/(c==='JPY'||c==='KRW'?1:100)):WalletState{
 const s:WalletState={...input,currencyBalances:{...input.currencyBalances},creditDebts:{...input.creditDebts},fixedDebtBalances:{...input.fixedDebtBalances},fixedSettlements:{...input.fixedSettlements},transactions:[...input.transactions]};
 const end=monthNumber(walletMonth(new Date(now))),floor=input.resetAt?monthNumber(walletMonth(new Date(input.resetAt))):0;
 const balance=(c:WalletCurrency)=>c==='CNY'?s.balance:s.currencyBalances[c]||0;
 const setBalance=(c:WalletCurrency,n:number)=>{if(c==='CNY')s.balance=round(n,c);else s.currencyBalances[c]=round(n,c);};
 const events:{rule:WalletFixedRule;due:Date;ym:string;key:string}[]=[];
 for(const rule of s.fixedRules||[]){if(!rule.enabled)continue;
  const start=Math.max(monthNumber(rule.startMonth),floor,end-1199),last=Math.min(end,rule.endMonth?monthNumber(rule.endMonth):end);
  for(let month=start;month<=last;month++){
   const y=Math.floor(month/12),m=month%12,days=new Date(y,m+1,0).getDate(),due=new Date(y,m,rule.day==='last'?days:Math.min(days,rule.day));
   if(due.getTime()>now)continue;const ym=walletMonth(due);events.push({rule,due,ym,key:`${rule.id}:${ym}`});
  }
 }
 events.sort((a,b)=>a.due.getTime()-b.due.getTime()||(a.rule.kind==='income'?-1:0)-(b.rule.kind==='income'?-1:0));
 // A second pass can settle pending bills after income arrived later in the same passive check.
 for(let pass=0;pass<2;pass++)for(const {rule,due,ym,key} of events){
   if(s.fixedSettlements![key]?.status==='paid'||s.fixedSettlements![key]?.status==='no_debt')continue;
   let amount=round(rule.amount,rule.currency),principal=0;
   if(rule.kind==='debt'){
    const debt=rule.debtTarget==='loan'?(s.fixedDebtBalances![rule.id]??rule.principal??0):(s.creditDebts![rule.currency]||0);
    if(debt<=0){s.fixedSettlements![key]={status:'no_debt',amount:0,at:due.toISOString()};continue;}
    if(rule.debtTarget==='loan'){principal=Math.min(debt,rule.principalPerPayment||amount);amount=round(principal+rule.amount-(rule.principalPerPayment||rule.amount),rule.currency);}else amount=Math.min(amount,debt);
   }
   if(rule.kind!=='income'&&balance(rule.currency)<amount){s.fixedSettlements![key]={status:'pending',amount,at:due.toISOString()};continue;}
   const id=`fixed:${s.financeEpoch||'initial'}:${key}`;
   if(s.transactions.some(t=>t.id===id)){s.fixedSettlements![key]={status:'paid',amount,at:due.toISOString()};continue;}
   setBalance(rule.currency,balance(rule.currency)+(rule.kind==='income'?amount:-amount));
   const tx:WalletTransaction={id,cardId:s.defaultCardId,accountType:'balance',title:rule.title,amount:rule.kind==='income'?amount:-amount,currency:rule.currency,kind:rule.kind==='income'?'transfer_in':'payment',source:'generated',category:rule.kind==='income'?'固定收入':rule.kind==='debt'?'固定还款':'固定支出',detail:`${ym} 固定收支 · 程序补记`,createdAt:due.toISOString(),balanceAfter:balance(rule.currency),relatedOrderId:id};s.transactions.unshift(tx);
   if(rule.kind==='debt'){
    if(rule.debtTarget==='loan')s.fixedDebtBalances![rule.id]=round((s.fixedDebtBalances![rule.id]??rule.principal??0)-principal,rule.currency);
    else {const remaining=round((s.creditDebts![rule.currency]||0)-amount,rule.currency);s.creditDebts![rule.currency]=remaining;s.transactions.unshift({...tx,id:id+':debt',cardId:'wallet_credit_card',credit:true,kind:'transfer_out',amount:-amount,balanceAfter:remaining});}
   }
   s.fixedSettlements![key]={status:'paid',amount,at:due.toISOString()};
 }
 return s;
}
