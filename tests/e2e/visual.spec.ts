import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

// Midnight Ink theme: 2026-10-11 digests are CI's renderer output, checked against local renders of
// the same pages (landing and demo). Earlier review notes below describe the previous design.
// Reviewed 2026-10-08 against the rendered Wealtharr pages (accessible mobile menu, demo chart
// settled). Digests are those produced by CI's renderer (Playwright Chromium 153, ubuntu-latest) and
// are reviewed against CI screenshots (the mobile demo has two visually equivalent raster variants).
// A different browser build may produce new hashes: review the attached screenshot before updating.
const expected:Record<string,Record<string,string | string[]>>={
  // Two equivalent mobile-demo renders were visually reviewed from the CI retry traces; tiny
  // subpixel raster differences affect only text/chart labels, not layout or user-visible content.
  "mobile-chromium":{
    landing:"4c549e5fab2390ff3c14644e70c4fb4544d5dbcf353c02874731c974293f070c",
    demo:["e86bf5f269fceed69cb54695196576dd5a0f7ff7efc6be5d19692fb3e5cd30d0","2efb7e98989e5418fad7c474e3a0631b7b4518de6c2f63b820e54bfdd44b8a49"]
  },
  "desktop-chromium":{
    landing:"8417d6a87de2a2baa323234f6a47ffbedea486b1dbe0cf811baae3ed358a938c",
    // 2026-10-09: the second settled raster was inspected from the GitHub trace PNG
    // (1280x1442). Header, value cards, next-action panel, chart, legends and
    // footer cards are intact; differences are rendering-only, not missing UI.
    demo:["e23ed51d198a7f2a4ccad3088ab9d5eba9a99dda77de2ad83558923d82e97753"]
  }
};

function paeth(a:number,b:number,c:number){
  const p=a+b-c;
  const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

function rgbPixels(png:Buffer){
  const signature="89504e470d0a1a0a";
  if(png.subarray(0,8).toString("hex")!==signature)throw new Error("INVALID_PNG");
  let offset=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0;
  const idat:Buffer[]=[];
  while(offset<png.length){
    const length=png.readUInt32BE(offset);
    const type=png.subarray(offset+4,offset+8).toString("ascii");
    const start=offset+8,end=start+length;
    if(type==="IHDR"){
      width=png.readUInt32BE(start);
      height=png.readUInt32BE(start+4);
      bitDepth=png[start+8];
      colorType=png[start+9];
      interlace=png[start+12];
    }else if(type==="IDAT")idat.push(png.subarray(start,end));
    offset=end+4;
    if(type==="IEND")break;
  }
  if(!width||!height||bitDepth!==8||colorType!==2||interlace!==0)throw new Error("UNSUPPORTED_PNG_FORMAT");
  const bytesPerPixel=3,stride=width*bytesPerPixel;
  const inflated=inflateSync(Buffer.concat(idat));
  const pixels=Buffer.alloc(height*stride);
  for(let y=0;y<height;y++){
    const sourceStart=y*(stride+1);
    const filter=inflated[sourceStart];
    const rowStart=y*stride;
    const priorStart=(y-1)*stride;
    for(let x=0;x<stride;x++){
      const raw=inflated[sourceStart+1+x];
      const a=x>=bytesPerPixel?pixels[rowStart+x-bytesPerPixel]:0;
      const b=y>0?pixels[priorStart+x]:0;
      const c=y>0&&x>=bytesPerPixel?pixels[priorStart+x-bytesPerPixel]:0;
      let value:number;
      if(filter===0)value=raw;
      else if(filter===1)value=(raw+a)&255;
      else if(filter===2)value=(raw+b)&255;
      else if(filter===3)value=(raw+Math.floor((a+b)/2))&255;
      else if(filter===4)value=(raw+paeth(a,b,c))&255;
      else throw new Error("UNSUPPORTED_PNG_FILTER");
      pixels[rowStart+x]=value;
    }
  }
  return pixels;
}

for(const entry of [
  {path:"/",name:"landing"},
  {path:"/demo",name:"demo"}
]){
  test(entry.name+" visual regression",async({page},testInfo)=>{
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto(entry.path);
    await expect(page.locator("body")).toBeVisible();
    await page.evaluate(async()=>{
      await document.fonts.ready;
      await new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    });
    if(entry.name==="demo"){
      await expect(page.locator(".chart-wrap svg")).toBeVisible();
      // Capture only once the chart geometry has stopped changing (500 ms unchanged, up to 8 s).
      // A fixed sleep photographed whichever animation frame the runner happened to reach, which
      // made the mobile demo hash differ between attempts of the same commit.
      await page.evaluate(async()=>{
        const signature=()=>Array.from(document.querySelectorAll(".chart-wrap svg path,.chart-wrap svg circle,.chart-wrap svg rect"))
          .map((node)=>node.tagName+":"+(node.getAttribute("d")??node.getAttribute("cx")??node.getAttribute("width")??"")).join("|");
        let previous=signature();
        let unchangedFor=0;
        for(let waited=0;waited<8000&&unchangedFor<500;waited+=100){
          await new Promise<void>((resolve)=>setTimeout(resolve,100));
          const current=signature();
          unchangedFor=current===previous?unchangedFor+100:0;
          previous=current;
        }
      });
    }
    // Accept a frame only once two consecutive captures are pixel-identical (up to 6 captures), so a
    // late paint on a loaded runner cannot be mistaken for the page's real appearance.
    const capture=async()=>{
      const image=await page.screenshot({fullPage:true,animations:"disabled",caret:"hide",scale:"css"});
      return {image,digest:createHash("sha256").update(rgbPixels(image)).digest("hex")};
    };
    let {image:screenshot,digest}=await capture();
    for(let attempt=0;attempt<5;attempt+=1){
      const next=await capture();
      const settled=next.digest===digest;
      screenshot=next.image;
      digest=next.digest;
      if(settled)break;
    }
    const baseline=expected[testInfo.project.name]?.[entry.name];
    expect(baseline,"Missing visual baseline for "+testInfo.project.name+" / "+entry.name).toBeTruthy();
    const reviewed=Array.isArray(baseline)?baseline:[baseline];
    if(!reviewed.includes(digest))await testInfo.attach(entry.name+"-actual.png",{body:screenshot,contentType:"image/png"});
    expect(reviewed).toContain(digest);
  });
}
