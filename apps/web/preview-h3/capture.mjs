import { chromium } from "playwright";
import { join } from "node:path";
const dest=process.argv[2];
const browser=await chromium.launch({channel:"chrome",args:["--no-sandbox"]});
try {
 for(const [w,h] of [[1440,900],[1280,720],[390,760]]){
  const page=await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
  page.on("pageerror",e=>console.error("pageerror",e));
  await page.goto("http://127.0.0.1:4173/");
  await page.getByRole("button",{name:"视频生成设置"}).click();
  const panel=page.locator(".generationSettings");
  await panel.waitFor({state:"visible"});
  await page.waitForTimeout(300);
  await page.screenshot({path:join(dest,w+"-01-top.png")});
  await panel.evaluate(el=>el.scrollTop=el.querySelector(".h3Advanced").offsetTop-16);
  await page.waitForTimeout(300);
  await page.screenshot({path:join(dest,w+"-02-advanced.png")});
  await page.getByLabel("附加 LoRA",{exact:true}).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({path:join(dest,w+"-03-dropdown.png")});
  await page.keyboard.press("Escape");
  await panel.evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.waitForTimeout(300);
  await page.screenshot({path:join(dest,w+"-04-bottom.png")});
  const metrics=await panel.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight}));
  console.log(JSON.stringify({viewport:w,...metrics}));
  if(metrics.scrollWidth>metrics.width+1) throw Error("Settings panel horizontal overflow");
  if(metrics.scrollHeight<=metrics.height) throw Error("Scrollable content expected");
  await page.close();
 }
} finally {await browser.close();}
