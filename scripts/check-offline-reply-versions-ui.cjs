// React DOM interactions with real storage and the production dialog, no model/API requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react');
const {JSDOM}=require(process.env.JSDOM_PATH||path.join(__dirname,'../../test-runtime/node_modules/jsdom'));
const root=path.resolve(__dirname,'..'),data=new Map(),kv={kvGet:k=>data.get(k)||null,kvSet:(k,v)=>data.set(k,v),kvRemove:k=>data.delete(k),registerDynamicPrefix(){}};
function load(file,mocks){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(id=>{if(id in mocks)return mocks[id];if(['react','react/jsx-runtime','lucide-react'].includes(id))return require(id);throw Error(id);},m,m.exports);return m.exports;}
const store=load('lib/chat-offline-storage.ts',{'./kv-db':kv,'./chat-list-entry':{restoreChatListEntry(){}},'./chat-storage':{loadChatSessions:()=>[]},'./llm-prompt-assembler':{formatChatTimestamp:x=>x}});
const fields=text=>({assistantContent:text,rawText:text,summary:'',summaryTag:'summary'});
const turn=store.appendChatOfflineTurn({sessionId:'s',userContent:'USER',...fields('ORIGINAL')});
for(let i=1;i<=7;i++)store.commitChatOfflineReplyRetry('s',turn.id,fields('RETRY_'+i),JSON.stringify(store.loadChatOfflineTurns('s')));
const modal=load('components/ui/modal.tsx',{});
const {OfflineReplyVersionDialog}=load('components/chat/offline-reply-version-dialog.tsx',{'@/components/ui/modal':modal,'@/lib/chat-offline-storage':store,'./offline-reply-version-dialog.module.css':new Proxy({},{get:(_,p)=>p})});
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=require('react-dom/client'),app=createRoot(document.getElementById('root'));let used=0,closed=0;
React.act(()=>app.render(React.createElement(OfflineReplyVersionDialog,{sessionId:'s',turnId:turn.id,busy:false,onClose:()=>closed++,onUse:(id,fingerprint,versionsFingerprint)=>{store.selectChatOfflineReplyVersion('s',turn.id,id,fingerprint,versionsFingerprint);used++;}})));
assert(document.body.textContent.includes('回复版本'));const options=[...document.querySelectorAll('button[aria-pressed]')];assert.equal(options.length,6);assert(options[0].textContent.includes('初版'));assert(options.at(-1).textContent.includes('重回 7'));
React.act(()=>options[0].click());assert.equal(options[0].getAttribute('aria-pressed'),'true');assert.equal(store.loadChatOfflineTurns('s')[0].assistantContent,'RETRY_7','Choosing is provisional until confirmation');assert.equal(used,0);
assert.equal(document.querySelectorAll('details summary').length,6,'Every option has a full-text comparison view');
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
React.act(()=>button('使用此版本').click());assert.equal(used,1);assert.equal(store.loadChatOfflineTurns('s')[0].assistantContent,'ORIGINAL');assert.equal(store.loadChatOfflineTurns('s').length,1,'Selection replaces existing turn without creating a new message');assert.equal(store.loadChatOfflineReplyVersionSets('s')[turn.id].versions.length,6,'Selection does not confirm story or discard alternatives');
React.act(()=>button('取消').click());assert.equal(closed,1);React.act(()=>app.unmount());dom.window.close();
console.log('PASS offline version dialog: six compact options, initial/retry numbering, provisional selection, explicit confirm, full-text view and cancel; one official turn, no model calls.');
// Switching selected narrative while TTS is loading must invalidate the older synthesis.
(async()=>{
 const dom=new JSDOM('<div id="speech-root"></div>',{url:'http://localhost'});global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;
 const bilingual=load('lib/bilingual-text.ts',{}),dialogue=load('lib/offline-dialogue.ts',{'./bilingual-text':bilingual});
 let resolveOld;const played=[];
 const speech=load('components/chat/offline-dialogue-text.tsx',{'@/lib/voice-expression-tags':{stripVoiceExpressionTags:x=>x},'@/lib/offline-dialogue':dialogue,'@/lib/tts-service':{resolveVoiceConfig:()=>({voice:'test'}),resolveUserVoiceConfig:()=>({voice:'test'}),synthesizeSpeech:text=>text==='OLD'?new Promise(r=>resolveOld=r):Promise.resolve({text}),playAudioBlobViaMediaElement:(blob,onStart)=>{played.push(blob.text);onStart();return{abort(){},promise:Promise.resolve()};}},'./message-bubble':{BilingualTextBlock:({text})=>React.createElement('span',null,text),isStandaloneHtmlPreviewContent:()=>false}});
 const app=createRoot(document.getElementById('speech-root'));
 const render=text=>React.act(()=>app.render(React.createElement(speech.OfflineDialogueText,{text:`<speech speaker="a">${text}|翻译</speech>`,role:'assistant',characterId:'a',speakers:{a:'a'}})));
 render('OLD');React.act(()=>document.querySelector('[aria-label="播放原文对白"]').click());assert.equal(typeof resolveOld,'function');
 render('NEW');await React.act(async()=>{resolveOld({text:'OLD'});await Promise.resolve();});assert.deepEqual(played,[],'Unselected reply cannot play after pending synthesis resolves');
 await React.act(async()=>{document.querySelector('[aria-label="播放原文对白"]').click();await Promise.resolve();});assert.deepEqual(played,['NEW'],'Selected reply speaks its own dialogue');
 React.act(()=>app.unmount());dom.window.close();console.log('PASS version speech: changing selected reply aborts/invalidates pending old TTS; only the selected new dialogue plays.');
})().catch(e=>{console.error(e);process.exitCode=1;});
