import {ImageResponse} from "next/og";

export const runtime="nodejs";
export const alt="Wealtharr — research-led portfolio tracking and rebalancing calculations";
export const size={width:1200,height:630};
export const contentType="image/png";

export default function OpenGraphImage(){
 return new ImageResponse(
  <div style={{display:"flex",width:"100%",height:"100%",flexDirection:"column",
   background:"linear-gradient(135deg,#081217 0%,#122a2a 62%,#16412f 100%)",
   padding:"64px 78px",color:"#edf8f2",fontFamily:"Arial,sans-serif",justifyContent:"space-between"}}>
   <div style={{display:"flex",alignItems:"center",gap:20}}>
    <div style={{width:62,height:62,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:18,
     background:"#b7f5cc",color:"#102a24",fontSize:41,fontWeight:800}}>W</div>
    <div style={{fontSize:39,fontWeight:700,letterSpacing:-1}}>Wealtharr</div>
   </div>
   <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div style={{display:"flex",flexDirection:"column",fontSize:63,fontWeight:800,lineHeight:1.06,letterSpacing:-2}}>
     <span>Track your strategy.</span><span>Know your next review.</span>
    </div>
    <div style={{fontSize:27,color:"#b5d8c8"}}>
     Portfolio calculations · Research tools · Self-directed investing
    </div>
   </div>
   <div style={{display:"flex",width:"100%",alignItems:"center",justifyContent:"space-between"}}>
    <div style={{fontSize:21,color:"#a9c5b7"}}>For research purposes only · Not investment advice</div>
    <div style={{width:120,height:5,background:"#b7f5cc",borderRadius:3}}/>
   </div>
  </div>,size);
}
