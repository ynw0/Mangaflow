// 桌面配置的类型声明。仓库不提交 .hutch，类型检查不依赖生成目录。
export interface ElectrobunConfig {
  app: {
    name: string;
    identifier: string;
    version: string;
    urlSchemes?: string[];
  };
  build: {
    mainProcess: "bun";
    bun: { entrypoint: string; minify?: boolean; external?: string[] };
    copy: Record<string, string>;
    buildFolder: string;
    artifactFolder: string;
    win?: { icon: string };
    mac?: { icons: string; codesign?: boolean; notarize?: boolean };
  };
  release: { baseUrl: string; generatePatch?: boolean };
  scripts?: { postBuild?: string; postWrap?: string };
}
