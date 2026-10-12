"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AdminError({reset}:{error:Error&{digest?:string};reset:()=>void}){
  return <section className="glass app-error" role="alert">
    <div className="app-error-icon"><AlertTriangle size={24}/></div>
    <div className="eyebrow">Something did not load</div>
    <h1>This administration page hit a problem.</h1>
    <p>No configuration was changed by loading it. Try again, or open another section from the navigation.</p>
    <button className="button primary" onClick={reset}><RotateCcw size={16}/>Try again</button>
  </section>;
}
