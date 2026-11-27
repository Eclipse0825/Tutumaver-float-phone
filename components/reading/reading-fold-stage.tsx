"use client";
import {useEffect,useLayoutEffect,useRef,useState,useId,type ReactNode,type PointerEvent,type MutableRefObject} from "react";
import {readingFoldGeometry,foldClipPath,foldClamp,type FoldPoint} from "@/lib/reading-fold-geometry";

export type ReadingFoldDirection="forward"|"backward";
export type ReadingFoldTarget={content:ReactNode;commit:()=>void};
type Turn={dir:1|-1;corner:FoldPoint;point:FoldPoint;width:number;height:number;target:ReadingFoldTarget};
type Drag={id:number;from:FoldPoint;moved:boolean};
type Props={pageKey:string;turnRef:MutableRefObject<((direction:ReadingFoldDirection)=>void)|null>;prepareTarget:(direction:ReadingFoldDirection)=>ReadingFoldTarget|null;disabled?:boolean;children:ReactNode};
const interactive="button,input,select,textarea,a,[data-no-nav='true']";

export function ReadingFoldStage({pageKey,turnRef,prepareTarget,disabled,children}:Props){
 const stageRef=useRef<HTMLDivElement>(null),drag=useRef<Drag|null>(null),active=useRef<Turn|null>(null);
 const raf=useRef(0),suppressClick=useRef(false),settling=useRef(false);
 const [frame,setFrame]=useState<Turn|null>(null);
 const latest=useRef({prepareTarget,disabled});latest.current={prepareTarget,disabled};
 const uid=useId().replace(/:/g,"");
 const paint=(turn:Turn)=>{active.current=turn;setFrame({...turn});};
 const clear=()=>{cancelAnimationFrame(raf.current);raf.current=0;const id=drag.current?.id;drag.current=null;active.current=null;settling.current=false;if(id!==undefined&&stageRef.current?.hasPointerCapture(id))stageRef.current.releasePointerCapture(id);setFrame(null);};
 useLayoutEffect(()=>{clear();},[pageKey]);
 useEffect(()=>{
  const node=stageRef.current;if(!node)return;
  let width=node.clientWidth,height=node.clientHeight;
  const observer=new ResizeObserver(()=>{if(node.clientWidth!==width||node.clientHeight!==height){width=node.clientWidth;height=node.clientHeight;if(active.current||drag.current)clear();}});
  observer.observe(node);
  return()=>{observer.disconnect();cancelAnimationFrame(raf.current);};
 },[]);
 const point=(event:PointerEvent<HTMLDivElement>):FoldPoint=>{
  const r=event.currentTarget.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};
 };
 const makeTurn=(dir:1|-1,y:number,auto=false)=>{
  const r=stageRef.current?.getBoundingClientRect();
  if(!r||!r.width||!r.height||latest.current.disabled)return null;
  const target=latest.current.prepareTarget(dir===1?"forward":"backward");if(!target)return null;
  const corner={x:dir===1?r.width:0,y:auto?r.height:y>r.height/2?r.height:0};
  return {dir,corner,point:auto?{x:corner.x-dir*r.width*.06,y:corner.y-r.height*.08}:{...corner},width:r.width,height:r.height,target};
 };
 const animate=(finish:boolean)=>{
  const t=active.current;if(!t||settling.current)return;
  settling.current=true;cancelAnimationFrame(raf.current);
  const from={...t.point},dest=finish?{x:t.corner.x-t.dir*(2*t.width+30),y:t.corner.y}:t.corner;
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration=reduced?1:finish?Math.max(170,Math.min(440,440*(1-foldClamp(Math.abs(from.x-t.corner.x)/(2*t.width),0,1)))):270;
  const started=performance.now();
  const step=(now:number)=>{
   if(active.current!==t&&active.current?.target!==t.target)return;
   const p=foldClamp((now-started)/duration,0,1),e=1-Math.pow(1-p,3);
   paint({...t,point:{x:from.x+(dest.x-from.x)*e,y:from.y+(dest.y-from.y)*e}});
   if(p<1)raf.current=requestAnimationFrame(step);else{
    active.current=null;settling.current=false;raf.current=0;setFrame(null);
    if(finish)t.target.commit();
   }
  };
  raf.current=requestAnimationFrame(step);
 };
 const autoTurn=(direction:ReadingFoldDirection)=>{
  if(active.current||drag.current||settling.current)return;
  const t=makeTurn(direction==="forward"?1:-1,0,true);if(!t)return;
  paint(t);animate(true);
 };
 useLayoutEffect(()=>{turnRef.current=autoTurn;return()=>{turnRef.current=null;};});
 const down=(e:PointerEvent<HTMLDivElement>)=>{
  suppressClick.current=false;
  if(disabled||active.current||!e.isPrimary||(e.pointerType==="mouse"&&e.button!==0)||(e.target as HTMLElement).closest(interactive))return;
  drag.current={id:e.pointerId,from:point(e),moved:false};
 };
 const move=(e:PointerEvent<HTMLDivElement>)=>{
  const d=drag.current;if(!d||d.id!==e.pointerId)return;
  const p=point(e);
  if(Math.hypot(p.x-d.from.x,p.y-d.from.y)>=9){d.moved=true;suppressClick.current=true;}
 };
 const end=(e:PointerEvent<HTMLDivElement>,cancel=false)=>{
  const d=drag.current;if(!d||d.id!==e.pointerId)return;
  const p=point(e);drag.current=null;
  if(cancel||d.moved||Math.hypot(p.x-d.from.x,p.y-d.from.y)>=9)suppressClick.current=true;
 };
 const g=frame?readingFoldGeometry(frame.width,frame.height,frame.corner,frame.point):null;
 const front=frame&&g?foldClipPath(g.front,frame.width,frame.height):undefined;
 const targetClip=frame&&g?foldClipPath(g.revealed,frame.width,frame.height):"polygon(0 0,0 0,0 0)";
 const pts=(ps:FoldPoint[])=>ps.map(p=>p.x+","+p.y).join(" ");
 return <div ref={stageRef} className="reading-page-stage reading-fold-stage"
  onPointerDown={down} onPointerMove={move} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)}
  onPointerLeave={e=>{if(drag.current&&!e.currentTarget.hasPointerCapture(e.pointerId))end(e,true);}}
  onLostPointerCapture={e=>{if(drag.current?.id===e.pointerId)end(e,true);}}
  onClickCapture={e=>{if(suppressClick.current||active.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}>
  {frame&&<div aria-hidden="true" className="reading-page-surface reading-fold-target" style={{clipPath:targetClip,pointerEvents:"none"}}>{frame.target.content}</div>}
  <div className="reading-page-surface" style={{clipPath:front,pointerEvents:frame?"none":undefined}}>{children}</div>
  {frame&&g&&<svg className="reading-fold-paper" aria-hidden="true" viewBox={"0 0 "+frame.width+" "+frame.height} preserveAspectRatio="none">
   <defs>
    <linearGradient id={uid+"-paper"} gradientUnits="userSpaceOnUse" x1={g.mid.x} y1={g.mid.y} x2={g.mid.x-g.normal.x*g.depth} y2={g.mid.y-g.normal.y*g.depth}>
     <stop offset="0" stopColor="#000" stopOpacity=".20"/><stop offset=".13" stopColor="#fff" stopOpacity=".055"/><stop offset="1" stopColor="#000" stopOpacity=".07"/>
    </linearGradient>
    <filter id={uid+"-shadow"} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
   </defs>
   {g.crease.length>=2&&<line x1={g.crease[0].x} y1={g.crease[0].y} x2={g.crease[1].x} y2={g.crease[1].y} stroke="#000" strokeOpacity={.28*(1-g.progress)} strokeWidth="7" filter={"url(#"+uid+"-shadow)"}/>}
   {g.flap.length>=3&&<><polygon points={pts(g.flap)} fill="#000" opacity=".17" transform={"translate("+(-g.normal.x*3)+" 2)"} filter={"url(#"+uid+"-shadow)"}/><polygon points={pts(g.flap)} fill="var(--reading-warm-bg, #fffced)"/><polygon points={pts(g.flap)} fill={"url(#"+uid+"-paper)"} stroke="#000" strokeOpacity=".10" strokeWidth=".7"/></>}
  </svg>}
 </div>;
}
