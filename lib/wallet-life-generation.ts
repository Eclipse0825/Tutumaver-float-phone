import {sendLLMRequest} from "./chat-engine";
import {loadCharacters} from "./character-storage";
import {loadChatMessages,loadChatSessions,getChatMessagePreview} from "./chat-storage";
import {loadCalendarWeekPlan} from "./calendar-storage";
import {getWeekStartIso} from "./calendar-utils";
import {loadApiConfigs,loadBindingConfig,loadPresets,resolveBinding,resolveUserIdentity,loadUserIdentities} from "./settings-storage";
import {WALLET_CURRENCIES,formatCurrencyAmount,getWalletCurrencyBalance,loadWalletState,saveWalletState,getActiveUserWalletIdentityId,roundWalletMoney,exchangeWalletAmount,walletResetReceipts} from "./wallet-storage";
import {settleFixedWalletDraft,walletMonth} from "./wallet-fixed-rules";
import type {WalletCurrency,WalletState,WalletTransaction} from "./wallet-types";
type Entry = { direction: "income" | "expense"; currency: WalletCurrency; amount: number; title: string; detail: string; category: string; createdAt: string; credit?: boolean };
function parseEntries(raw: string, start: number, end: number): Entry[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("生成结果没有可读取的流水，请重试。");
  let rows: unknown;
  try { rows = JSON.parse(match[0]); } catch { throw new Error("生成的流水格式有误，请重试。"); }
  if (!Array.isArray(rows)) throw new Error("生成的流水格式有误，请重试。");
  return (rows as unknown[]).slice(0, 10).flatMap((row): Entry[] => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const direction = r.direction === "income" || r.direction === "expense" ? r.direction : null;
    const currency = r.currency as WalletCurrency;
    const amount = Number(r.amount);
    const timestamp = Date.parse(String(r.createdAt || ""));
    if (!direction || !WALLET_CURRENCIES.includes(currency) || !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !Number.isFinite(timestamp) || timestamp <= start || timestamp > end) return [];
    const title = String(r.title || "").trim().slice(0, 100);
    if (!title) return [];
    return [{ direction, currency, amount, title, detail: String(r.detail || title).trim().slice(0, 350), category: String(r.category || (direction === "income" ? "收入" : "生活消费")).slice(0, 50), createdAt: new Date(timestamp).toISOString(), credit: r.account === "credit" && direction === "expense" }];
  }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}


export type WalletTarget={ownerId?:string;userIdentityId?:string};
const running=new Set<string>();
export function captureWalletTarget(ownerId?:string):WalletTarget{
 if(ownerId){if(!loadCharacters().some(c=>c.id===ownerId))throw Error("找不到角色。");return{ownerId};}
 const id=getActiveUserWalletIdentityId();if(!id)throw Error("请先选择用户身份。");return{userIdentityId:id};
}
const targetKey=(t:WalletTarget)=>t.ownerId?`char:${t.ownerId}`:`user:${t.userIdentityId}`;
const read=(t:WalletTarget)=>loadWalletState(t.ownerId,t.userIdentityId);
function person(t:WalletTarget){
 const c=t.ownerId?loadCharacters().find(c=>c.id===t.ownerId):null;
 const u=t.ownerId?resolveUserIdentity(t.ownerId,'checkphone'):loadUserIdentities().find(u=>u.id===t.userIdentityId);
 if(t.ownerId&&!c||!t.ownerId&&!u)throw Error("账户身份已变化，请重新打开钱包。");
 return{character:c,identity:u,text:c?`${c.name}：${c.persona}\n性格：${c.personality||''}`:`${u?.name||'用户'}：${u?.bio||''}\n职业：${u?.occupation||''}\n${u?.customSettings||''}`};
}
function apiFor(t:WalletTarget){const binding=resolveBinding(loadBindingConfig(),t.ownerId,t.ownerId?'checkphone':'chat');const list=loadApiConfigs();const api=list.find(a=>a.id===binding.apiConfigId)||list[0];if(!api)throw Error("请先设置 AI 接口。");const presets=loadPresets();return{api,preset:presets.find(p=>p.id===binding.presetId)||presets[0]||null};}
export function walletHasMeaningfulHistory(w:WalletState):boolean{
 return w.transactions.some(t=>t.id!=='wallet_initial_balance')||Object.values(w.creditDebts||{}).some(v=>(v||0)>0)||Object.values(w.currencyBalances||{}).some(v=>(v||0)>0)||(w.balance>0&&!(w.balance===10000&&w.transactions.every(t=>t.id==='wallet_initial_balance')));
}
export function settleWalletFixedRules(ownerId?:string,userIdentityId?:string,now=Date.now()):WalletState{
 const w=loadWalletState(ownerId,userIdentityId);
 if(!w.roleAssetsInitialized&&!walletHasMeaningfulHistory(w))return w;
 const next=settleFixedWalletDraft({...w,roleAssetsInitialized:true},now,roundWalletMoney);
 return JSON.stringify(next)===JSON.stringify(w)?w:saveWalletState(next,ownerId,userIdentityId);
}
function financialContext(t:WalletTarget,w:WalletState,start:number,now:number){
 const chats=loadChatSessions().filter(s=>t.ownerId?s.contactId===t.ownerId:resolveUserIdentity(s.isGroup?undefined:s.contactId,s.isGroup?'group_chat':'chat')?.id===t.userIdentityId).slice(0,3).flatMap(s=>loadChatMessages(s.id,24).filter(m=>!w.resetAt||Date.parse(m.createdAt)>=Date.parse(w.resetAt)).map(m=>getChatMessagePreview(m))).filter(Boolean).slice(-24);
 const schedules:string[]=[];
 // A reset only accepts items created in the new financial era, even if an old calendar remains.
 const owner=t.ownerId||'self',type=t.ownerId?'character' as const:'user' as const;
 for(let n=0;n<3;n++){const d=new Date(start+n*7*86400000);if(d.getTime()>now)break;const plan=loadCalendarWeekPlan(type,owner,getWeekStartIso(d));for(const item of plan?.items||[]){if(w.resetAt&&(!item.createdAt||Date.parse(item.createdAt)<Date.parse(w.resetAt)))continue;schedules.push(`${item.date} ${item.title} ${item.location}`);}}
 return{chats,schedules};
}
function matchesFixedEntry(e:Entry,w:WalletState):boolean{
 const text=`${e.title} ${e.detail} ${e.category}`.replace(/\s/g,'').toLowerCase();
 return(w.fixedRules||[]).some(r=>r.enabled&&r.currency===e.currency&&((r.kind==='income')===(e.direction==='income'))&&(text.includes(r.title.replace(/\s/g,'').toLowerCase())||(e.amount===r.amount&&/工资|薪|信托|月供|房租|还款|固定/.test(text))||(r.kind==='income'&&/工资|月薪|信托|固定收入/.test(text))||(r.kind==='debt'&&/月供|还款/.test(text))));
}
async function requestLiving(t:WalletTarget,w:WalletState,start:number,now:number,fresh:boolean):Promise<Entry[]>{
 const p=person(t),{api,preset}=apiFor(t),context=fresh?{chats:[],schedules:[]}:financialContext(t,w,start,now);
 const fixed=(w.fixedRules||[]).filter(r=>r.enabled).map(r=>`${r.title}，${r.kind}，${r.amount} ${r.currency}，每月${r.day==='last'?'月底':r.day+'日'}`).join('；');
 const prompt=`为虚构手机账户生成自然生活流水。只返回0到${Math.min(10,Math.max(1,Math.ceil((now-start)/86400000)*2))}项JSON数组，允许空数组。每项 direction(income或expense),currency(ISO),amount(正数),title(中文),detail(中文),category(中文),createdAt(ISO),account(debit或credit)。\n唯一当前人设：${p.text}\n经济情况：${w.wealthLevel||'按当前人设推断'}；收入来源：${w.incomeSources||'按当前人设推断，不凭空发工资'}。当前设定优先，不继承其他AU的职业、资产、车型、债务或消费。${fresh?'这是新账本初始化，没有旧账或其他APP历史可供继承。':''}\n${fixed?`固定收支由程序独立结算：${fixed}。这些来源及其同义描述绝不可再次生成；不要生成补发工资、固定信托、月供或固定项目的替代流水。只补充其他有明确生活依据的收支。`:'没有固定规则，可根据当前收入来源自然生成有依据的收入及支出，不要凭空发工资。'}\n时间范围：(${new Date(start).toISOString()},${new Date(now).toISOString()}]，首次最多一周，后续只补此区间，不要凑数。默认币种${w.primaryCurrency}，常用${(w.commonCurrencies||[]).join('、')}。现有各币余额：${WALLET_CURRENCIES.map(c=>`${c} ${getWalletCurrencyBalance(w,c)}`).join('；')}，不得生成付不起的支出。收入需要可靠人设依据。\n本账本允许的近期聊天：${context.chats.join('；')||'无'}；日程：${context.schedules.join('；')||'无'}。真实转账、红包、订单和平台收益另有账务，不要复刻或补单。商家、城市和消费水平符合所在地和新经济条件。${w.creditEnabled?'已开通信用卡，可有合理credit支出。':'未开通信用卡，全部debit。'}`;
 const raw=await sendLLMRequest(api,preset,[{role:'system',content:prompt},{role:'user',content:'给出这个账户的新流水JSON数组。'}],[],{characterName:p.character?.name,userName:p.identity?.name},{skipOutputRegex:true,appId:'wallet_living'});
 return parseEntries(raw,start,now).filter(e=>!matchesFixedEntry(e,w));
}
async function baseProposal(t:WalletTarget,w:WalletState,blind:boolean){
 const p=person(t),{api}=apiFor(t);
 const raw=await sendLLMRequest(api,null,[{role:'system',content:`依据当前人设建议初始储蓄金额，只返回JSON {"currency":"${w.primaryCurrency}","amount":数字,"explanation":"中文理由"}。金额必须合理、非负，信息模糊时保守估计。这是${blind?'隐蔽初始化':'供审核的建议'}，不是收入流水；不使用旧AU历史，不把本次尚未结算的固定收支提前计入。人设：${p.text}。经济情况：${w.wealthLevel||'未设置'}；收入来源：${w.incomeSources||'未设置'}。`},{role:'user',content:'给出建议基础金额。'}],[],{characterName:p.character?.name,userName:p.identity?.name},{skipOutputRegex:true,appId:'wallet_base'});
 const match=raw.match(/\{[\s\S]*\}/);if(!match)throw Error('无法解析建议金额，请重试。');let out:Record<string,unknown>;try{out=JSON.parse(match[0]);}catch{throw Error('无法解析建议金额，请重试。');}
 const amount=Number(out.amount);if(!Number.isFinite(amount)||amount<0||amount>1e9)throw Error('建议金额无效，请重试。');return{currency:w.primaryCurrency,amount:roundWalletMoney(amount,w.primaryCurrency),explanation:String(out.explanation||'根据当前人设建议。').slice(0,180)};
}
export async function suggestWalletBase(ownerId?:string,blind=false,userIdentityId?:string){return baseProposal(userIdentityId?{userIdentityId}:captureWalletTarget(ownerId),loadWalletState(ownerId,userIdentityId),blind);}
function applyLiving(w:WalletState,entries:Entry[],now:number){
 let s={...w,currencyBalances:{...w.currencyBalances},creditDebts:{...w.creditDebts},transactions:[...w.transactions]};let count=0,skipped=0;
 for(const [index,e]of entries.entries()){
  const credit=e.credit&&e.direction==='expense'&&s.creditEnabled;let currency=e.currency,amount=roundWalletMoney(e.amount,currency);
  if(e.direction==='income'&&s.autoConvertReceived){currency=s.primaryCurrency;amount=exchangeWalletAmount(amount,e.currency,currency);}
  const available=getWalletCurrencyBalance(s,currency);if(!credit&&e.direction==='expense'&&available<amount){skipped++;continue;}
  let after:number;
  if(credit){after=roundWalletMoney((s.creditDebts[currency]||0)+amount,currency);s.creditDebts[currency]=after;}
  else{after=roundWalletMoney(available+(e.direction==='income'?amount:-amount),currency);if(currency==='CNY')s.balance=after;else s.currencyBalances[currency]=after;}
  const tx:WalletTransaction={id:`living_${now}_${index}_${Math.random().toString(36).slice(2,7)}`,cardId:credit?'wallet_credit_card':s.defaultCardId,accountType:credit?'card':'balance',title:e.title,detail:e.detail,category:e.category,amount:e.direction==='income'||credit?amount:-amount,currency,credit:credit||undefined,kind:e.direction==='income'?'transfer_in':'payment',createdAt:e.createdAt,source:'generated',balanceAfter:after};s.transactions.unshift(tx);count++;
 }
 return{state:s,count,skipped};
}
function assertUnchanged(t:WalletTarget,snapshot:string,persona:string){if(JSON.stringify(read(t))!==snapshot||person(t).text!==persona)throw Error('生成期间账户、设定或交易已变化，未覆盖已有钱包，请重试。');}
export async function refreshWalletLiving(ownerId?:string):Promise<{count:number;skipped:number}>{
 const t=captureWalletTarget(ownerId),key=targetKey(t);if(running.has(key))throw Error('该账户正在生成，请稍后重试。');running.add(key);
 try{

  const original=read(t),snapshot=JSON.stringify(original),persona=person(t).text,now=Date.now();let draft={...original};
  const first=!draft.roleAssetsInitialized&&!walletHasMeaningfulHistory(draft);
  if(first){const base=await baseProposal(t,draft,!!ownerId);draft={...draft,balance:base.currency==='CNY'?base.amount:0,currencyBalances:base.currency==='CNY'?{}:{[base.currency]:base.amount},transactions:[],roleAssetsInitialized:true};}
  else draft={...draft,roleAssetsInitialized:true};
  draft=settleFixedWalletDraft(draft,now,roundWalletMoney);
  const last=original.lastLivingRefreshAt?Date.parse(original.lastLivingRefreshAt):NaN,start=Number.isFinite(last)&&last<=now?last:now-7*86400000;
  if(now-start<60000){assertUnchanged(t,snapshot,persona);if(JSON.stringify(draft)!==snapshot)saveWalletState(draft,t.ownerId,t.userIdentityId);return{count:0,skipped:0};}
  const entries=await requestLiving(t,draft,start,now,first);assertUnchanged(t,snapshot,persona);const applied=applyLiving(draft,entries,now);
  saveWalletState({...settleFixedWalletDraft(applied.state,now,roundWalletMoney),lastLivingRefreshAt:new Date(now).toISOString()},t.ownerId,t.userIdentityId);return{count:applied.count,skipped:applied.skipped};
 }finally{running.delete(key);}
}
export async function resetWalletAccount(t:WalletTarget):Promise<WalletState>{
 const key=targetKey(t);if(running.has(key))throw Error('该账户正在生成，请稍后重试。');running.add(key);
 try{
  const old=read(t),snapshot=JSON.stringify(old),persona=person(t).text,now=Date.now(),epoch=`wallet_${now}_${Math.random().toString(36).slice(2,9)}`;
  const blocked=new Set(old.blockedMessageIds||[]);
  for(const session of loadChatSessions().filter(s=>t.ownerId?(s.contactId===t.ownerId||!!s.isGroup&&!!s.participantIds?.includes(t.ownerId)):resolveUserIdentity(s.isGroup?undefined:s.contactId,s.isGroup?'group_chat':'chat')?.id===t.userIdentityId))for(const m of loadChatMessages(session.id))if(Date.parse(m.createdAt)<=now)blocked.add(m.id);
  let draft:WalletState={...old,financeEpoch:epoch,resetAt:new Date(now).toISOString(),balance:0,currencyBalances:{},cards:old.cards.map(c=>({...c,balance:0})),transactions:[],creditDebts:{},fixedSettlements:{},fixedDebtBalances:Object.fromEntries((old.fixedRules||[]).filter(r=>r.kind==='debt'&&r.debtTarget==='loan').map(r=>[r.id,r.principal||0])),lastLivingRefreshAt:undefined,roleAssetsInitialized:false,processedReferences:walletResetReceipts(old),blockedMessageIds:[...blocked]};
  const base=await baseProposal(t,draft,!!t.ownerId);if(base.currency==='CNY')draft.balance=base.amount;else draft.currencyBalances[base.currency]=base.amount;
  draft=settleFixedWalletDraft({...draft,roleAssetsInitialized:true},now,roundWalletMoney);
  const entries=await requestLiving(t,draft,now-7*86400000,now,true);const applied=applyLiving(draft,entries,now);assertUnchanged(t,snapshot,persona);
  return saveWalletState({...settleFixedWalletDraft(applied.state,now,roundWalletMoney),lastLivingRefreshAt:new Date(now).toISOString()},t.ownerId,t.userIdentityId,true);
 }finally{running.delete(key);}
}
