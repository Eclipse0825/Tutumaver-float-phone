// Real storage and production handlers; model/network and UI side effects are isolated.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),kvData=new Map();let checks=0;
const check=(name,ok)=>{assert(ok,name);checks++;};
const sessions=[{id:'single',contactId:'a'},{id:'group',contactId:'g',isGroup:true,participantIds:['a','b']}];
const kv={kvGet:key=>kvData.get(key)||null,kvSet:(key,value)=>kvData.set(key,value),kvRemove:key=>kvData.delete(key),registerDynamicPrefix(){}};
function load(file,mocks={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(id=>{if(id in mocks)return mocks[id];throw Error('Unmocked import '+id);},m,m.exports);return m.exports;}
const mocks={'./kv-db':kv,'./chat-list-entry':{restoreChatListEntry(){}},'./chat-storage':{loadChatSessions:()=>sessions},'./llm-prompt-assembler':{formatChatTimestamp:x=>x}};
const store=load('lib/chat-offline-storage.ts',mocks);
const fields=text=>({assistantContent:text,rawText:`<content>${text}</content>`,summary:'SUMMARY_'+text,summaryTag:'memo',reasoningText:'REASON_'+text,thinkingText:'THINK_'+text,thinkingTag:'thought'});
const read=id=>store.loadChatOfflineTurns(id),sets=id=>store.loadChatOfflineReplyVersionSets(id);
const fingerprint=id=>JSON.stringify(read(id));
function retry(session,id,text){return store.commitChatOfflineReplyRetry(session,id,fields(text),fingerprint(session));}
function select(session,id,version){return store.selectChatOfflineReplyVersion(session,id,version,fingerprint(session));}
const prompt=load('lib/offline-prompt-builder.ts',{'./chat-offline-storage':store,'./settings-storage':{loadBindingConfig:()=>({}),loadApiConfigs:()=>[],resolveBinding:()=>({})}});
for(const session of sessions){
 const id=session.id,initial=store.appendChatOfflineTurn({sessionId:id,userContent:'USER',...fields('A'),assistantImage:{prompt:'independent image',usage:'decoration',ref:'asset://image'}});
 check(id+' initial has no alternatives',!sets(id)[initial.id]);
 retry(id,initial.id,'B');check(id+' first successful retry snapshots original and new',sets(id)[initial.id].versions.map(v=>v.assistantContent).join()==='A,B');
 for(const text of ['C','D','E','F','G'])retry(id,initial.id,text);
 check(id+' bounded history preserves original and latest five',sets(id)[initial.id].versions.map(v=>v.assistantContent).join()==='A,C,D,E,F,G');
 select(id,initial.id,'original');
 check(id+' selection restores all reply fields',Object.entries(fields('A')).every(([k,v])=>read(id)[0][k]===v));
 check(id+' picture is independent',read(id)[0].assistantImage.ref==='asset://image'&&sets(id)[initial.id].versions.every(v=>!('assistantImage'in v)));
 retry(id,initial.id,'H');check(id+' selection does not reset retry number',sets(id)[initial.id].versions.map(v=>v.assistantContent).join()==='A,D,E,F,G,H'&&sets(id)[initial.id].versions.at(-1).retry===7);
 const before=fingerprint(id),versions=JSON.stringify(sets(id));
 assert.throws(()=>store.commitChatOfflineReplyRetry(id,initial.id,fields(''),before));
 assert.throws(()=>store.commitChatOfflineReplyRetry(id,initial.id,fields('BAD'),'stale'));
 check(id+' empty/conflicting retries change neither official story nor versions',fingerprint(id)===before&&JSON.stringify(sets(id))===versions);
 const reloaded=load('lib/chat-offline-storage.ts',mocks);check(id+' exit/reload preserves history',reloaded.loadChatOfflineReplyVersionSets(id)[initial.id].versions.length===6);
 select(id,initial.id,'original');store.updateChatOfflineTurn(id,initial.id,fields('EDITED_A'));
 select(id,initial.id,'retry-7');select(id,initial.id,'original');check(id+' manual edit updates only selected snapshot',read(id)[0].assistantContent==='EDITED_A'&&sets(id)[initial.id].versions.at(-1).assistantContent==='H');
 const history=JSON.stringify(prompt.buildOfflinePromptHistory(session,read(id),'NEXT'));
 check(id+' only selected reply enters actual request history',history.includes('EDITED_A')&&!history.includes('REASON_H')&&!history.includes('<content>H</content>'));
 store.ensureChatOfflineScene(id,session.contactId);store.updateChatOfflineScene(id,{status:'paused'});check(id+' pause preserves choices',sets(id)[initial.id].versions.length===6);
 store.appendChatOfflineTurn({sessionId:id,userContent:session.isGroup?'':'NEXT',...fields('NEXT_REPLY')});check(id+' successful progression confirms all earlier choices',!Object.keys(sets(id)).length&&read(id)[0].assistantContent==='EDITED_A');
 retry(id,initial.id,'OLD_TURN_RETRY');check(id+' retrying earlier turn preserves later story',read(id).length===2&&read(id)[1].assistantContent==='NEXT_REPLY');
 const scene=store.loadChatOfflineSceneState(id).active;store.archiveChatOfflineScene({...scene,endedAt:new Date().toISOString(),summary:'FINAL_SUMMARY',turns:read(id)},fingerprint(id));
 const archive=store.loadChatOfflineSceneState(id).archives[0];check(id+' archive stores official selected story and cleans choices',archive.turns[0].assistantContent==='OLD_TURN_RETRY'&&!JSON.stringify(archive).includes('EDITED_A')&&!Object.keys(sets(id)).length);
 const t=store.appendChatOfflineTurn({sessionId:id,userContent:'U',...fields('DELETE_A')});retry(id,t.id,'DELETE_B');store.updateChatOfflineTurn(id,t.id,{assistantContent:''});check(id+' assistant-only deletion clears alternatives',!sets(id)[t.id]);
 const t2=store.appendChatOfflineTurn({sessionId:id,userContent:'U2',...fields('DELETE_C')});retry(id,t2.id,'DELETE_D');store.deleteChatOfflineTurnsFrom(id,t2.id);check(id+' delete-below clears removed alternatives',!sets(id)[t2.id]);
 const t3=store.appendChatOfflineTurn({sessionId:id,userContent:'U3',...fields('DELETE_E')});retry(id,t3.id,'DELETE_F');store.deleteChatOfflineTurn(id,t3.id);check(id+' delete-turn clears alternatives',!sets(id)[t3.id]);
 const t4=store.appendChatOfflineTurn({sessionId:id,userContent:'U4',...fields('DELETE_G')});retry(id,t4.id,'DELETE_H');store.clearChatOfflineTurns(id);check(id+' clear-session leaves no sidecar',!Object.keys(sets(id)).length&&!read(id).length);
}
// Merge into a different session moves sidecars without adding them to official records.
const mt=store.appendChatOfflineTurn({sessionId:'merge_source',userContent:'M',...fields('MA')});retry('merge_source',mt.id,'MB');store.saveChatOfflineTurns('merge_target',read('merge_source').map(t=>({...t,sessionId:'merge_target'})));store.mergeChatOfflineReplyVersions('merge_source','merge_target');store.clearChatOfflineTurns('merge_source');check('session merge preserves alternatives under target only',sets('merge_target')[mt.id].versions.length===2&&!Object.keys(sets('merge_source')).length);
check('backup module includes isolated sidecar prefix',fs.readFileSync(path.join(root,'lib/data-management/modules.ts'),'utf8').includes('ai_phone_chat_offline_reply_versions:'));
const identical=store.appendChatOfflineTurn({sessionId:'same_body',userContent:'U',...fields('SAME')});
const sameFingerprint=fingerprint('same_body');retry('same_body',identical.id,'SAME');
check('identical model reply really leaves official fingerprint unchanged',fingerprint('same_body')===sameFingerprint);
assert.throws(()=>store.commitChatOfflineReplyRetry('same_body',identical.id,fields('SHOULD_NOT_WIN'),sameFingerprint,'null'));
check('metadata fingerprint rejects concurrent identical-text retry',sets('same_body')[identical.id].versions.length===2&&read('same_body')[0].assistantContent==='SAME');
// Run the actual retry handler, including awaited generation failure/cancel/concurrent changes.
const source=fs.readFileSync(path.join(root,'components/chat/chat-room.tsx'),'utf8');
function extract(start,end,name,env){const code=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));return new Function(...Object.keys(env),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+`;return ${name};`)(...Object.values(env));}
(async()=>{
 for(const kind of ['success','failure','empty','cancel','conflict']){
  const id='handler_'+kind,t=store.appendChatOfflineTurn({sessionId:id,userContent:'INPUT',...fields('ORIGINAL')});let active=true;
  const env={...store,session:{id,contactId:'a'},isOfflineGenerating:false,offlineSceneBusy:false,showChatToast(){},setActiveOfflineTarget(){},setIsOfflineGenerating(){},setOfflineTurns(){},cancelFollowUp(){},setPendingOfflineUserText(){},setOfflineStreamPreview(){},offlineGenerationInputRef:{current:''},buildOfflinePromptHistory:()=>[],createOfflineGenerationRun:()=>({runId:'run',controller:new AbortController()}),isOfflineGenerationRunActive:()=>active,finishOfflineGenerationRun:()=>true,isAbortLikeError:e=>e?.name==='AbortError',generateOfflineChatCompletion:async()=>{if(kind==='failure')throw Error('model error');if(kind==='cancel')active=false;if(kind==='conflict')store.updateChatOfflineTurn(id,t.id,fields('OTHER_EDITOR'));return{content:kind==='empty'?'':'NEW_REPLY',rawText:'NEW_RAW',summary:'NEW_SUMMARY',summaryTag:'summary',reasoning:'NEW_REASON',thinking:'NEW_THINK',thinkingTag:'thinking'};}};
  const fn=extract('    const handleOfflineRetryFrom =','    const handleRetry =','handleOfflineRetryFrom',env);await fn(t.id);
  check('production retry '+kind+' preserves correct official story',read(id)[0].assistantContent===(kind==='success'?'NEW_REPLY':kind==='conflict'?'OTHER_EDITOR':'ORIGINAL'));
  check('production retry '+kind+' history only after success',!!sets(id)[t.id]===(kind==='success'));
 }
 for(const kind of ['success','failure','empty','cancel','conflict','spectator','invalid','invalid-image','meta-conflict','empty-markup']){
  const id='send_'+kind,t=store.appendChatOfflineTurn({sessionId:id,userContent:'INPUT',...fields('SELECTED')});retry(id,t.id,'UNSELECTED');select(id,t.id,'original');let active=true,capturedHistory;
  const done=new Promise(resolve=>{
   const env={...store,session:{id,contactId:'a',isGroup:kind==='spectator',isSpectator:kind==='spectator'},isOfflineGenerating:false,offlineSceneBusy:false,pendingOfflineImage:kind==='invalid-image'?{usage:'interactive',ref:'asset://image'}:null,showChatToast(){},setShowPlusMenu(){},setShowEmojiPanel(){},setShowStickerPanel(){},setRichModal(){},setPendingOfflineUserText(){},setIsOfflineGenerating(){},setOfflineStreamPreview(){},setPendingOfflineImage(){},setOfflineTurns(){},cancelFollowUp(){},offlineGenerationInputRef:{current:''},offlineStreamAccumRef:{current:''},offlineStreamFrameRef:{current:0},offlineTextInputRef:{current:{setText(){}}},offlineMusicContext:()=>'',resolveBinding:()=>({}),loadBindingConfig:()=>({}),loadApiConfigs:()=>[],createOfflineGenerationRun:()=>({runId:'run',controller:new AbortController()}),isOfflineGenerationRunActive:()=>active,finishOfflineGenerationRun:()=>{resolve();return true;},isAbortLikeError:e=>e?.name==='AbortError',buildOfflinePromptHistory:(_turns,text)=>{capturedHistory=prompt.buildOfflinePromptHistory(sessions[0],_turns,text);return capturedHistory;}};
   const generation=async()=>{if(kind==='failure')throw Error('model error');if(kind==='cancel')active=false;if(kind==='conflict')store.updateChatOfflineTurn(id,t.id,fields('OTHER_EDITOR'));if(kind==='meta-conflict')retry(id,t.id,'SELECTED');return{content:kind==='empty'||kind==='empty-markup'?'':'NEXT_REPLY',rawText:kind==='empty'?'':kind==='empty-markup'?'<thinking>NO_BODY</thinking>':'<content>NEXT_REPLY</content>',summary:'SUMMARY',summaryTag:'summary'};};env.generateOfflineChatCompletion=generation;env.generateGroupOfflineChatCompletion=generation;
   const fn=extract('    const handleOfflineSend =','    const handleOfflineEditSave =','handleOfflineSend',env);
   const sent=fn(kind==='invalid'||kind==='spectator'?'':'NEXT');if(!sent)resolve();
  });
  await done;
  const success=kind==='success'||kind==='spectator';
  check('production send '+kind+' clears choices only after successful progression',!!sets(id)[t.id]===!success);
  check('production send '+kind+' never loses selected/current story',read(id)[0].assistantContent===(kind==='conflict'?'OTHER_EDITOR':'SELECTED'));
  check('production send '+kind+' appends only valid new story',read(id).length===(success?2:1));
  if(capturedHistory)check('production send '+kind+' requests selected history only',JSON.stringify(capturedHistory).includes('SELECTED')&&!JSON.stringify(capturedHistory).includes('UNSELECTED'));
 }
 console.log(`PASS offline reply versions: ${checks} checks (private/group, bounded history, selection/edit/persistence, prompts, archive/delete/merge/backup and real retry outcomes).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
