"use client";
import {useState} from "react";
import {captureWalletTarget,resetWalletAccount,type WalletTarget} from "@/lib/wallet-life-generation";
import {loadWalletState,formatCurrencyAmount} from "@/lib/wallet-storage";
import s from "./wallet-tools.module.css";
export function WalletResetControl({ownerId,name,onReset}:{ownerId?:string;name:string;onReset:()=>void}){
 const [target,setTarget]=useState<WalletTarget|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <><button type="button" className={s.resetButton} onClick={()=>{try{setTarget(captureWalletTarget(ownerId));setError('');}catch(e){setError(e instanceof Error?e.message:'请先选择账户');}}}>重置余额与流水</button>{error&&!target&&<p role="alert" className={s.notice}>{error}</p>}
 {target&&<div className={s.overlay} onClick={()=>{if(!busy)setTarget(null);}}><section className={s.dialog} role="dialog" aria-modal="true" aria-label="重置余额与流水" onClick={e=>e.stopPropagation()}><h3>重置 {name} 的钱包？</h3><p>旧余额、流水和欠款将由新账本替换。只按当前人设及财务配置生成，不继承旧 AU 的聊天、日程或收益。生成失败保留旧钱包。</p><p>币种、银行卡和当前固定规则保留；新规则从重置当月开始，不追补旧 AU 月份。</p>{(loadWalletState(target.ownerId,target.userIdentityId).fixedRules||[]).filter(r=>r.enabled).map(r=><small className={s.rulePreview} key={r.id}>{r.title} · {formatCurrencyAmount(r.amount,r.currency)}／月</small>)}{error&&<p role="alert" className={s.notice}>{error}</p>}<div className={s.row}><button type="button" className={s.button} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await resetWalletAccount(target);setTarget(null);onReset();}catch(e){setError(e instanceof Error?e.message:'重置失败，旧钱包保留。');}finally{setBusy(false);}}}>{busy?'正在重新生成…':'确认重新生成'}</button><button type="button" className={s.secondary} disabled={busy} onClick={()=>setTarget(null)}>取消</button></div></section></div>}
 </>;
}
