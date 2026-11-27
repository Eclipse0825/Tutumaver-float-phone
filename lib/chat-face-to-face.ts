import type { ChatMessage, ChatSession } from "./chat-storage";

export const DEFAULT_FACE_TO_FACE_ACTION_PROMPT = `根据当前面对面交流的情境，自然描写人物的动作、神态、姿态、周围环境以及正在发生的事情，使语言交流与实际场景相互衔接。
默认使用第三人称进行动作描写。单人场景中可以自然省略明确的主语；多人场景中应通过姓名、称呼或明确的代词区分人物，避免混淆动作的执行者。
动作描写不局限于单个角色，可以在同一段落中描写多人的动作、相互反应、共同活动以及环境变化。根据情境自由决定段落的长度、数量和描写对象，不要求每段动作都包含所有在场人物。
按照实际发生的顺序自然穿插动作与语言。可以连续进行多段对话，也可以连续描写动作；可以在一段动作后由不同角色分别接话，再根据交流的发展补充新的动作描写。不强制动作与语言交替出现，也不要求每轮必须包含动作。
动作描写应与当前人物关系、场景和交流节奏相符，避免重复交代已有环境、堆砌无意义的小动作或过度文学化的叙述。
尊重用户的行动自主权，不擅自代替用户说话、行动、做出决定或描述其未经表达的心理活动。可以描写其他角色对用户已经明确表达的言语和动作所产生的反应。`;
export const FACE_TO_FACE_FORMAT_RULE = `【程序固定格式规则，优先于自定义描写风格】
所有非语言描写必须独立放在中文全角方头括号【】中，例如【他放下杯子，窗外的雨声渐渐变大。】。这里直接写描写正文，不要字面添加“动作”前缀。
非语言内容包括人物动作、神态、表情、姿态、多人互动、环境、天气、光线、声音及场景变化。普通聊天台词只允许角色真正说出口的话，不得夹带动作或环境旁白。不得用星号、小括号或 Markdown 斜体代替动作括号。
动作与台词按发生顺序排列，不强制交替，不要求每轮有动作，不限制动作或台词段数。台词保留既有翻译、语音、工具及状态栏协议，协议标记不属于场景旁白，不要包进动作。
尊重用户的行动自主权，不代替用户决定动作、台词或心理。历史中的【现场动作】正文【/现场动作】是旧存储格式，仍代表已发生的现场动作，不得引用动作。`;
export function faceToFaceInstruction(session:ChatSession):string {
    if(!session.faceToFaceEnabled||session.isSpectator)return "";
    return ["【当前交流场景】现在与用户面对面见面，不是隔着手机打字、电话或视频，也不是线下长篇剧情模式。当前场景规则优先于预设中的远程聊天假设。历史中标记为面对面的内容是当时的真实现场；不要重新解释之前的线上历史。普通文字代表实际说出口的话。不要替用户发言。现场动作不是聊天消息，不能引用动作；引用功能只可用于台词。",
        session.faceToFaceActions ? "【动作描写风格】"+(session.faceToFaceActionPrompt?.trim()||DEFAULT_FACE_TO_FACE_ACTION_PROMPT)+"\n"+FACE_TO_FACE_FORMAT_RULE : "本轮只输出实际说出口的话，不输出动作或叙述。历史中的动作仍然有效。"
        ,session.isGroup?(session.faceToFaceActions?"群聊的语言仍以 [角色本名]: 开头；共享动作单独使用【非语言描写正文】，不带角色前缀。":"群聊的语言仍以 [角色本名]: 开头。"):"",
    ].filter(Boolean).join("\n");
}
export function parseUserFaceAction(text:string):string|null {
    const input = text.trim();
    const legacy = input.match(/^【(?:动作|现场动作)】([\s\S]+?)(?:【\/现场动作】)?$/);
    if (legacy) return legacy[1].trim() || null;
    if (!input.startsWith("【") || !input.endsWith("】")) return null;
    let depth = 0;
    for (let index = 0; index < input.length; index++) {
        if (input[index] === "【") depth++;
        if (input[index] === "】") depth--;
        if (depth < 0 || (depth === 0 && index < input.length - 1)) return null;
    }
    return depth === 0 ? input.slice(1, -1).trim() || null : null;
}
export function faceActionText(text:string):string {
    return text.replace(/^【现场动作】/,"").replace(/【\/现场动作】$/,"").trim();
}

export const FACE_SCENE_ID = "__face_scene__";
export function faceHistoryText(message:{content:string;faceToFaceMode?:true;faceToFaceKind?:"speech"|"action"}):string {return message.faceToFaceMode?"[当时为面对面交流] "+message.content:message.content;}

export function canQuoteChatMessage(message: Pick<ChatMessage, "faceToFaceKind">): boolean {
    return message.faceToFaceKind !== "action";
}

/** Remove the quote shell only; keep the actual reply when a model quotes a scene. */
export function withoutFaceActionQuote<T extends Pick<ChatMessage, "content"> & Partial<Pick<ChatMessage, "mediaType" | "mediaData">>>(
    message: T, history: readonly ChatMessage[],
): T {
    if (message.mediaType !== "quote") return message;
    const data = message.mediaData;
    const preview = String(data?.quotePreview || "").trim();
    const normalize = (value: string) => (parseUserFaceAction(value) ?? faceActionText(value)).replace(/\s+/g, "").trim();
    const text = normalize(preview);
    const quotesAction = preview.includes("【现场动作】") || history.some(candidate => {
        if (canQuoteChatMessage(candidate)) return false;
        if (data?.quoteMessageId === candidate.id) return true;
        const action = normalize(candidate.content);
        return !!text && !!action && (text === action || (Math.min(text.length, action.length) >= 4 && (action.includes(text) || text.includes(action))));
    });
    return quotesAction ? { ...message, mediaType: undefined, mediaData: undefined } : message;
}


export type FaceTextSegment = { kind: "speech" | "action"; text: string };
/** Balanced scan shared by private/group parsers. Partial action prefixes never become speech. */
export function splitFaceToFaceText(text: string, options: { newFormat: boolean; streaming?: boolean }): FaceTextSegment[] {
    const segments: FaceTextSegment[] = [];
    let speech = "";
    const flush = () => { if (speech.trim()) segments.push({kind:"speech",text:speech}); speech=""; };
    const action = (body: string) => { flush(); if (body.trim()) segments.push({kind:"action",text:`【现场动作】${body.trim()}【/现场动作】`}); };
    for (let i=0;i<text.length;) {
        const rest=text.slice(i);
        // Protocol payloads may contain brackets of their own; preserve them byte-for-byte.
        const protocol=rest.match(/^(\[(状态栏|内心)\]|<(thinking|thought|think)>|```)/i);
        if (protocol) {
            const closing=protocol[2]?`[/${protocol[2]}]`:protocol[3]?`</${protocol[3]}>`:"```";
            const end=text.indexOf(closing,i+protocol[0].length);
            if(end<0){speech+=rest;break;}
            speech+=text.slice(i,end+closing.length);i=end+closing.length;continue;
        }
        // Preserve rich-message brackets, including tool JSON and literal 【】 inside voice/quote payloads.
        if (text[i] === "[") {
            let depth=1,j=i+1,quoted=false,escaped=false;
            for(;j<text.length&&depth;j++) {
                const char=text[j];
                if(quoted){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')quoted=false;continue;}
                if(char==='"'){quoted=true;continue;}
                if(char==="[")depth++;else if(char==="]")depth--;
            }
            speech+=text.slice(i,j);i=j;continue;
        }
        if (rest.startsWith("【现场动作】")) {
            const start=i+"【现场动作】".length, end=text.indexOf("【/现场动作】",start);
            if(end<0){if(!options.streaming)action(text.slice(start));break;}
            action(text.slice(start,end));i=end+"【/现场动作】".length;continue;
        }
        if (options.newFormat && text[i]==="【") {
            let depth=1,j=i+1;
            for(;j<text.length&&depth;j++){if(text[j]==="【")depth++;else if(text[j]==="】")depth--;}
            if(depth){if(!options.streaming)action(text.slice(i+1));break;}
            const body=text.slice(i+1,j-1);
            // Explicit rich-message/control markers remain owned by their existing parsers.
            const reserved=/^(?:\/?(?:状态栏|内心|现场动作)|(?:照片|图片|语音|视频|引用|表情包|音乐|工具|搜索|转账|红包|好感度|心情|情绪)[：:])/i.test(body.trim());
            if(reserved)speech+=text.slice(i,j);else action(body);
            i=j;continue;
        }
        speech+=text[i++];
    }
    flush();return segments;
}
