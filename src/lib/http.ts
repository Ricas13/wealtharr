// Client-safe JSON request helper for forms. It never throws and never leaves the caller waiting:
// network failures, non-JSON bodies and error statuses all resolve to a result object, so a form can
// always reset its busy state (`try { ... } finally { setBusy(false) }` is still recommended).

export const NETWORK_ERROR_TEXT="Could not reach the server. Check your connection and try again.";
export const UNEXPECTED_RESPONSE_TEXT="The server sent an unexpected response. Please try again.";

export type JsonResult<T=any>={
  ok:boolean;
  /** HTTP status, or 0 when the request never reached the server. */
  status:number;
  /** Parsed JSON body; `{}` when the body was empty or not JSON. */
  data:T;
  /** Empty when `ok`; otherwise a message that is safe to show the user. */
  errorText:string;
};

export type JsonRequestOptions={
  method?:"POST"|"PUT"|"PATCH"|"DELETE"|"GET";
  body?:unknown;
  headers?:Record<string,string>;
  /** Shown when the server returned a failure without an `error` message. */
  fallbackError?:string;
};

export async function requestJson<T=any>(url:string,options:JsonRequestOptions={}):Promise<JsonResult<T>>{
  const {method="POST",body,headers,fallbackError="Something went wrong. Please try again."}=options;
  let response:Response;
  try{
    response=await fetch(url,{
      method,
      headers:{...(body!==undefined?{"content-type":"application/json"}:{}),...headers},
      body:body===undefined?undefined:JSON.stringify(body)
    });
  }catch{
    return {ok:false,status:0,data:{} as T,errorText:NETWORK_ERROR_TEXT};
  }
  let parsed:unknown;
  let parseFailed=false;
  try{
    parsed=await response.json();
  }catch{
    parseFailed=true;
  }
  const data=(parsed&&typeof parsed==="object"?parsed:{}) as T;
  if(response.ok)return {ok:true,status:response.status,data,errorText:""};
  const serverMessage=(data as {error?:unknown}).error;
  const errorText=typeof serverMessage==="string"&&serverMessage.trim()
    ?serverMessage
    :parseFailed?UNEXPECTED_RESPONSE_TEXT:fallbackError;
  return {ok:false,status:response.status,data,errorText};
}

export function postJson<T=any>(url:string,body?:unknown,options:Omit<JsonRequestOptions,"method"|"body">={}){
  return requestJson<T>(url,{...options,method:"POST",body});
}
