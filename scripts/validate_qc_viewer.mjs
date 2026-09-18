import { chromium } from "playwright-core";

const args=Object.fromEntries(process.argv.slice(2).map(entry=>{const [key,...rest]=entry.replace(/^--/,"").split("=");return [key,rest.join("=")||true];}));
const baseUrl=String(args["base-url"]||"").replace(/\/?$/,"/");
const mode=String(args.mode||"local");
if(!baseUrl) throw new Error("--base-url is required");
const retextureAssets=["PROP_Chair_A","PROP_PlasticContainer_A","PROP_TrashBag_A","PROP_Wardrobe_A","PROP_MedicalCabinet_A","PROP_IVStand_A","PROP_Wheelchair_A"];
const directAssets=["PROP_CardboardBox_A","PROP_Debris_A","PROP_Bed_A","PROP_Table_A","PROP_Sofa_A","PROP_HospitalBed_A"];
const allAssets=[...retextureAssets,...directAssets];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--disable-dev-shm-usage"]});
const results=[];
try {
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  page.on("console",message=>{if(message.type()==="error") console.error(`browser console: ${message.text()}`);});
  let lastError;
  for(let attempt=1;attempt<=12;attempt+=1){try{const response=await page.goto(baseUrl,{waitUntil:"domcontentloaded",timeout:120000});if(!response||!response.ok())throw new Error(`Viewer HTTP ${response?.status()}`);lastError=null;break;}catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,10000));}}
  if(lastError)throw lastError;
  const registry=await page.evaluate(async()=>await (await fetch("asset-registry.json",{cache:"no-store"})).json());
  if(registry.assetCount!==13||registry.retextureCount!==7||registry.directCount!==6)throw new Error(`Invalid registry counts: ${JSON.stringify(registry)}`);
  if(registry.sourceCommit!=="176588265b8a170d54910e9686d35a65bef3c10a")throw new Error(`Unexpected source commit: ${registry.sourceCommit}`);
  for(const assetId of allAssets){
    await page.selectOption("#asset-select",assetId);
    await page.waitForFunction(expected=>{const s=document.querySelector("#load-status"),v=document.querySelector("#qc-viewer");return s?.dataset.state==="loaded"&&s.textContent.includes(expected)&&v?.loaded;},assetId,{timeout:mode==="remote"?600000:300000});
    const check=await page.evaluate(()=>{const v=document.querySelector("#qc-viewer"),d=v.getDimensions(),canvas=v.shadowRoot?.querySelector("canvas");return{dimensions:[d.x,d.y,d.z],materialCount:v.model?.materials?.length||0,canvasWidth:canvas?.width||0,canvasHeight:canvas?.height||0};});
    if(check.dimensions.some(value=>!Number.isFinite(value))||Math.max(...check.dimensions)<=0)throw new Error(`${assetId} has invalid rendered dimensions`);
    if(check.materialCount<1||check.canvasWidth<1||check.canvasHeight<1)throw new Error(`${assetId} did not expose rendered material/canvas evidence`);
    results.push({assetId,route:retextureAssets.includes(assetId)?"RETEXTURE":"DIRECT",status:"LOADED",...check});
  }
  await page.selectOption("#asset-select","PROP_Chair_A");
  await page.waitForFunction(()=>document.querySelector("#load-status")?.dataset.state==="loaded",null,{timeout:300000});
  const camera=await page.evaluate(async()=>{const v=document.querySelector("#qc-viewer"),settle=async()=>{await v.updateComplete;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};const before=v.getCameraOrbit();v.cameraOrbit=`${before.theta+.45}rad ${before.phi}rad ${before.radius}m`;await settle();v.jumpCameraToGoal();await settle();const afterOrbit=v.getCameraOrbit();document.querySelector("#zoom-in").click();await settle();const afterZoom=v.getCameraOrbit();const beforeTarget=v.getCameraTarget();v.cameraTarget=`${beforeTarget.x+.1}m ${beforeTarget.y}m ${beforeTarget.z}m`;await settle();v.jumpCameraToGoal();await settle();const afterPan=v.getCameraTarget();document.querySelector("#auto-frame").click();await settle();document.querySelector("#reset-camera").click();await settle();const afterReset=v.getCameraOrbit();return{orbitDelta:Math.abs(afterOrbit.theta-before.theta),zoomDelta:Math.abs(afterZoom.radius-afterOrbit.radius),panDelta:Math.abs(afterPan.x-beforeTarget.x),resetTheta:afterReset.theta,resetPhi:afterReset.phi};});
  if(camera.orbitDelta<.1||camera.zoomDelta<=0||camera.panDelta<.05)throw new Error(`Camera controls failed: ${JSON.stringify(camera)}`);
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}),mobilePage=await mobile.newPage();
  const mobileResponse=await mobilePage.goto(`${baseUrl}?asset=PROP_Chair_A`,{waitUntil:"domcontentloaded",timeout:120000});
  if(!mobileResponse||!mobileResponse.ok())throw new Error(`Mobile HTTP ${mobileResponse?.status()}`);
  await mobilePage.waitForFunction(()=>document.querySelector("#load-status")?.dataset.state==="loaded",null,{timeout:mode==="remote"?300000:180000});
  const mobileLayout=await mobilePage.evaluate(()=>{const viewer=document.querySelector("#qc-viewer").getBoundingClientRect(),select=document.querySelector("#asset-select").getBoundingClientRect();return{viewerWidth:viewer.width,viewerHeight:viewer.height,selectWidth:select.width};});
  if(mobileLayout.viewerWidth<300||mobileLayout.viewerHeight<300||mobileLayout.selectWidth<250)throw new Error(`Mobile layout failed: ${JSON.stringify(mobileLayout)}`);
  await mobile.close();
  console.log(JSON.stringify({status:"SUCCESS",mode,baseUrl,registeredAssets:13,retextureLoaded:results.filter(x=>x.route==="RETEXTURE").length,directLoaded:results.filter(x=>x.route==="DIRECT").length,camera,mobile:{status:"LOADED",...mobileLayout},credits:0,results},null,2));
} finally { await browser.close(); }

