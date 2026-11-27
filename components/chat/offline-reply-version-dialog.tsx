"use client";
import {useState} from "react";
import {Check} from "lucide-react";
import {ContentDialog} from "@/components/ui/modal";
import {loadChatOfflineReplyVersionSets,loadChatOfflineTurns} from "@/lib/chat-offline-storage";
import s from "./offline-reply-version-dialog.module.css";
export function OfflineReplyVersionDialog({sessionId,turnId,busy,onUse,onClose}:{sessionId:string;turnId:string;busy:boolean;onUse:(id:string,fingerprint:string,versionsFingerprint:string)=>void;onClose:()=>void}){
 const [initial]=useState(()=>({set:loadChatOfflineReplyVersionSets(sessionId)[turnId],fingerprint:JSON.stringify(loadChatOfflineTurns(sessionId))}));
 const [selected,setSelected]=useState(initial.set?.selectedId||"");
 const [error,setError]=useState("");
 return <div className={s.root}><ContentDialog title="回复版本" confirmLabel="使用此版本" cancelLabel="取消" onCancel={onClose} onConfirm={()=>{if(busy)return;try{onUse(selected,initial.fingerprint,JSON.stringify(initial.set||null));}catch(e){setError(e instanceof Error?e.message:"切换失败，请重新打开");}}}>
  <p className={s.note}>选择只替换当前回复。继续剧情成功后，其他暂存版本会清除。</p>
  <div className={s.list} aria-label="可选回复版本">{initial.set?.versions.map(version=><div className={s.item} key={version.id}>
   <button type="button" className={s.option} aria-pressed={selected===version.id} disabled={busy} onClick={()=>setSelected(version.id)}>
    <span className={s.label}>{version.retry===0?"初版":`重回 ${version.retry}`}{selected===version.id&&<Check size={14} aria-label="已选中"/>}{initial.set?.selectedId===version.id&&<small>当前正文</small>}</span>
    <span className={s.preview}>{version.assistantContent}</span>
   </button><details className={s.full}><summary>查看全文</summary><div>{version.assistantContent}</div></details>
  </div>)}</div>{error&&<p role="alert" className={s.error}>{error}</p>}
 </ContentDialog></div>;
}
