"use client";
import {useState} from "react";
import {ChevronDown,ChevronRight,Phone,Video} from "lucide-react";
import {CallVisualPreview} from "./call-visual-preview";
import {Toggle} from "@/components/ui/form";
import {loadChatAppSettings,saveChatAppSettings} from "@/lib/chat-storage";
import {readCallVisual,defaultCallVisual,normalizeCallVisual,type CallVisualKind,type CallVisualGroup,type CallVisualSurface,type CallVisualConfig} from "@/lib/chat-call-appearance";

function ColorRow({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
  return <label className="menu-item"><span className="menu-label">{label}</span><div className="menu-right gap-2"><span className="menu-desc">{value.toUpperCase()}</span><input type="color" aria-label={label} value={value} onChange={e=>onChange(e.target.value)} className="h-7 w-9 shrink-0 rounded-md cursor-pointer"/></div></label>;
}
function RangeRow({label,value,onChange,max=100,unit="%"}:{label:string;value:number;onChange:(value:number)=>void;max?:number;unit?:string}){
  return <label className="menu-item call-visual-range"><span className="menu-label">{label}</span><div className="menu-right gap-2"><input className="ui-slider" type="range" min={0} max={max} step={1} aria-label={label} value={value} onChange={e=>onChange(Number(e.target.value))}/><span className="menu-desc tabular-nums">{value}{unit}</span></div></label>;
}
function SurfaceEditor({title,value,onChange}:{title:string;value:CallVisualSurface;onChange:(patch:Partial<CallVisualSurface>)=>void}){
  const [open,setOpen]=useState(false);
  return <section className="call-visual-subsection"><button type="button" className="menu-item w-full" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span className="menu-label font-medium">{title}</span><span className="menu-right">{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</span></button>
    {open&&<>
    <ColorRow label="背景颜色" value={value.color} onChange={color=>onChange({color})}/>
    <ColorRow label="文字颜色" value={value.text} onChange={text=>onChange({text})}/>
    <RangeRow label="不透明度" value={value.opacity} onChange={opacity=>onChange({opacity})}/>
    <RangeRow label="圆角" value={value.radius} max={36} unit="px" onChange={radius=>onChange({radius})}/>
    <ColorRow label="阴影颜色" value={value.shadowColor} onChange={shadowColor=>onChange({shadowColor})}/>
    <RangeRow label="阴影强度" value={value.shadow} onChange={shadow=>onChange({shadow})}/>
    </>}
  </section>;
}
export function CallVisualSettings({kind}:{kind:CallVisualKind}){
  const [group,setGroup]=useState(()=>readCallVisual(kind)),[open,setOpen]=useState(false),[name,setName]=useState(""),[selected,setSelected]=useState(""),[previewOpen,setPreviewOpen]=useState(false);
  const [buttonsOpen,setButtonsOpen]=useState(false);
  const title=kind==="video"?"视频通话美化":"语音通话美化";
  function persist(next:CallVisualGroup){setGroup(next);const current=loadChatAppSettings();saveChatAppSettings({...current,callVisualAppearance:{...current.callVisualAppearance,[kind]:next}});}
  const update=(patch:Partial<CallVisualConfig>)=>persist({...group,config:normalizeCallVisual(kind,{...group.config,...patch})});
  const selectedPreset=group.presets.find(p=>p.id===selected);
  const c=group.config;
  return <div className="call-visual-settings">
    <button type="button" className="menu-item w-full" aria-expanded={open} onClick={()=>{if(!open)setGroup(readCallVisual(kind));setOpen(v=>!v);}}>{kind==="video"?<Video size={20} className="text-[var(--c-icon)] shrink-0"/>:<Phone size={20} className="text-[var(--c-icon)] shrink-0"/>}<div className="menu-label-group"><span className="menu-label">{title}</span><span className="menu-desc">{group.enabled?"已启用":"原生样式"}</span></div><div className="menu-right">{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</div></button>
    {open&&<div className="call-visual-editor">
      <div className="menu-item"><div className="menu-label-group"><span className="menu-label">启用自定义美化</span><span className="menu-desc">关闭时恢复原生样式，保留设置</span></div><div className="menu-right"><Toggle checked={group.enabled} onChange={enabled=>persist({...group,enabled})}/></div></div>
      <button type="button" className="menu-item w-full" aria-expanded={previewOpen} onClick={()=>setPreviewOpen(v=>!v)}><div className="menu-label-group"><span className="menu-label">预览</span><span className="menu-desc">调整参数时实时显示</span></div><span className="menu-right">{previewOpen?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</span></button>
      {previewOpen&&<CallVisualPreview kind={kind} group={group}/>}
      {group.enabled&&<>
        <RangeRow label="背景模糊" value={c.blur} onChange={blur=>update({blur})}/>
        <RangeRow label="背景不透明度" value={c.backgroundOpacity} onChange={backgroundOpacity=>update({backgroundOpacity})}/>
        <SurfaceEditor title={kind==="video"?"对方气泡":"对方通话卡片"} value={c.other} onChange={p=>update({other:{...c.other,...p}})}/>
        <SurfaceEditor title={kind==="video"?"我方气泡":"我方通话卡片"} value={c.my} onChange={p=>update({my:{...c.my,...p}})}/>
        {kind==="video"?<SurfaceEditor title="输入栏" value={c.input} onChange={p=>update({input:{...c.input,...p}})}/>:<section className="call-visual-subsection"><button type="button" className="menu-item w-full" aria-expanded={buttonsOpen} onClick={()=>setButtonsOpen(v=>!v)}><span className="menu-label font-medium">通话按钮</span><span className="menu-right">{buttonsOpen?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</span></button>{buttonsOpen&&<><ColorRow label="背景颜色" value={c.buttons.color} onChange={color=>update({buttons:{...c.buttons,color}})}/><ColorRow label="图标颜色" value={c.buttons.text} onChange={text=>update({buttons:{...c.buttons,text}})}/><RangeRow label="不透明度" value={c.buttons.opacity} onChange={opacity=>update({buttons:{...c.buttons,opacity}})}/></>}</section>}
        <div className="menu-item"><div className="menu-label-group"><span className="menu-label">美化预设</span><span className="menu-desc">语音与视频预设独立保存</span></div><select className="ui-input call-visual-preset" aria-label="选择美化预设" value={selected} onChange={e=>{const id=e.target.value;setSelected(id);const p=group.presets.find(p=>p.id===id);if(p){setName(p.name);persist({...group,config:normalizeCallVisual(kind,p.config)});}else setName("");}}><option value="">选择预设</option>{group.presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="menu-item"><input className="ui-input flex-1 min-w-0" aria-label="预设名称" placeholder="预设名称" value={name} onChange={e=>setName(e.target.value)}/><button className="ui-btn ui-btn-outline shrink-0" type="button" disabled={!name.trim()} onClick={()=>{const id="call-visual-"+Date.now()+"-"+Math.random().toString(36).slice(2,6);persist({...group,presets:[...group.presets,{id,name:name.trim(),config:c}]});setSelected(id);}}>另存预设</button></div>
        {selectedPreset&&<div className="menu-item call-visual-preset-actions"><button type="button" className="ui-btn ui-btn-outline" disabled={!name.trim()} onClick={()=>persist({...group,presets:group.presets.map(p=>p.id===selected?{...p,name:name.trim()}:p)})}>重命名</button><button type="button" className="ui-btn ui-btn-outline" onClick={()=>persist({...group,presets:group.presets.map(p=>p.id===selected?{...p,config:c}:p)})}>保存修改</button><button type="button" className="ui-btn ui-btn-outline" onClick={()=>{if(!window.confirm("删除这个美化预设？"))return;persist({...group,presets:group.presets.filter(p=>p.id!==selected)});setSelected("");setName("");}}>删除</button></div>}
        <button type="button" className="menu-item" onClick={()=>{update(defaultCallVisual(kind));setSelected("");setName("");}}><span className="menu-label">恢复默认参数</span></button>
      </>}
    </div>}
  </div>;
}
