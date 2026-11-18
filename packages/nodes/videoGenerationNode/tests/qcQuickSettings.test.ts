import { describe, expect, test } from "bun:test";
import { changeQcAuto, changeQcLevel, getQcDisplayState } from "../src/components/qcQuickSettings";
const defaults = {qcLevel:"videoAudio",qcTrigger:"auto"};
describe("视频节点 QC 快捷配置向后兼容",()=>{
  test("继承配置可读且不会写入不必要的覆盖",()=>{
    expect(getQcDisplayState(undefined, defaults)).toEqual({level:"videoAudio",automatic:true});
  });
  test("旧 mode off 仅关自动，保留手动质检范围",()=>{
    expect(getQcDisplayState({mode:"off"},defaults)).toEqual({level:"videoAudio",automatic:false});
    expect(changeQcAuto(undefined,false)).toEqual({mode:"off"});
  });
  test("从 legacy off 修改范围，继承的手动状态不能误变为自动",()=>{
    const custom=changeQcLevel({mode:"off"},"video");
    expect(custom).toEqual({mode:"custom",qcLevel:"video",qcTrigger:"manual"});
    expect(getQcDisplayState(custom,defaults).automatic).toBe(false);
  });
  test("自动开关不丢失已有模型与 QC 方式",()=>{
    const before={mode:"custom" as const,qcLevel:"video" as const,qcTrigger:"auto" as const,
      qcMethod:"agentFramesAndModel" as const,videoQcModelId:"custom-vision"};
    expect(changeQcAuto(before,false)).toEqual({...before,qcTrigger:"manual"});
    expect(changeQcAuto(before,true)).toEqual(before);
  });
  test("完全关闭质检不会误报自动开启；恢复继承通过清除覆盖完成",()=>{
    const disabled=changeQcLevel(undefined,"none");
    expect(getQcDisplayState(disabled,defaults)).toEqual({level:"none",automatic:false});
    expect(changeQcAuto({mode:"off"},true)).toEqual({mode:"custom",qcTrigger:"auto"});
  });
});
