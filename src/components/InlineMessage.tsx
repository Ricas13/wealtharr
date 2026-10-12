"use client";
import { useCallback, useState, type ReactNode } from "react";

// One place that decides how a form-level outcome is announced. The tone is state, never inferred from
// the wording of the text, so changing copy cannot silently turn an error green.
//
//   error / warning -> role="alert"  (announced immediately)
//   success / info  -> role="status" (announced politely)
//
// Styling reuses the existing `.error`, `.success`, `.attention-message` and `.help` classes.
export type MessageTone="success"|"error"|"warning"|"info";
export type Message={tone:MessageTone;text:string};

const TONE_CLASS:Record<MessageTone,string>={
  success:"success",
  error:"error",
  warning:"attention-message",
  info:"help"
};

export function messageRole(tone:MessageTone){
  return tone==="error"||tone==="warning"?"alert":"status";
}

export function InlineMessage({tone,children,id,className,as:Tag="div"}:{
  tone:MessageTone;
  children:ReactNode;
  id?:string;
  className?:string;
  as?:"div"|"span"|"p";
}){
  return <Tag id={id} className={TONE_CLASS[tone]+(className?" "+className:"")} role={messageRole(tone)}>{children}</Tag>;
}

/** `{tone,text}` state for a form, plus setters that make the tone explicit at the call site. */
export function useMessage(){
  const [message,setMessage]=useState<Message|null>(null);
  const clear=useCallback(()=>setMessage(null),[]);
  const success=useCallback((text:string)=>setMessage({tone:"success",text}),[]);
  const error=useCallback((text:string)=>setMessage({tone:"error",text}),[]);
  const warning=useCallback((text:string)=>setMessage({tone:"warning",text}),[]);
  const info=useCallback((text:string)=>setMessage({tone:"info",text}),[]);
  return {message,setMessage,clear,success,error,warning,info};
}

/** Renders the current message, or nothing. */
export function MessageView({message,as,id,className}:{message:Message|null;as?:"div"|"span"|"p";id?:string;className?:string}){
  if(!message)return null;
  return <InlineMessage tone={message.tone} as={as} id={id} className={className}>{message.text}</InlineMessage>;
}
