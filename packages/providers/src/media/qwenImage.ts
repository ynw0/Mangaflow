// 阿里云百炼 Qwen 图像。地址沿用 Manga 的兼容模式根地址，真正提交时换成 multimodal 出图接口。
const rules = [
  {
    type: "input",
    field: "baseUrl" as const,
    title: "请求地址",
    value: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    props: { placeholder: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" },
  },
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

function generationUrl(baseUrl: string) {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (!url) throw new Error("请填写 Qwen 图像请求地址");
  if (url.endsWith("/multimodal-generation/generation") || url.endsWith("/images/generations")) return url;
  const compatible = url.indexOf("/compatible-mode");
  if (compatible >= 0) return `${url.slice(0, compatible)}/api/v1/services/aigc/multimodal-generation/generation`;
  if (url.endsWith("/api/v1")) return `${url}/services/aigc/multimodal-generation/generation`;
  return `${url}/api/v1/services/aigc/multimodal-generation/generation`;
}

function imageData(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data.replace(/^data:[^;]+;base64,/, "");
  const mimeType = input.mimeType || "image/png";
  return data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`;
}

function pixelSize(size: string | undefined, ratio: string | undefined) {
  const pair = /^(\d{2,5})x(\d{2,5})$/i.exec(size?.trim() ?? "");
  if (pair) return `${pair[1]}*${pair[2]}`;
  const mapped: Record<string, string> = {
    "8:3": "2048*768",
    "1:1": "1024*1024",
    "16:9": "1344*768",
    "3:4": "768*1024",
    "4:3": "1024*768",
    "9:16": "768*1344",
  };
  return mapped[ratio?.trim() ?? ""] ?? "1024*1024";
}

type Context = {
  config: { apiKey?: string; baseUrl?: string };
  signal?: AbortSignal;
  tool: {
    fetch: typeof fetch;
    errorMessage(value: unknown): string;
  };
};

export default {
  id: "qwenImage",
  label: "Qwen 图像",
  icon: "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPlF3ZW48L3RpdGxlPjxwYXRoIGQ9Ik0xMi42MDQgMS4zNGMuMzkzLjY5Ljc4NCAxLjM4MiAxLjE3NCAyLjA3NWEuMTguMTggMCAwMC4xNTcuMDkxaDUuNTUyYy4xNzQgMCAuMzIyLjExLjQ0Ni4zMjdsMS40NTQgMi41N2MuMTkuMzM3LjI0LjQ3OC4wMjQuODM3LS4yNi40My0uNTEzLjg2NC0uNzYgMS4zbC0uMzY3LjY1OGMtLjEwNi4xOTYtLjIyMy4yOC0uMDQuNTEybDIuNjUyIDQuNjM3Yy4xNzIuMzAxLjExMS40OTQtLjA0My43Ny0uNDM3Ljc4NS0uODgyIDEuNTY0LTEuMzM1IDIuMzQtLjE1OS4yNzItLjM1Mi4zNzUtLjY4LjM3LS43NzctLjAxNi0xLjU1Mi0uMDEtMi4zMjcuMDE2YS4wOTkuMDk5IDAgMDAtLjA4MS4wNSA1NzUuMDk3IDU3NS4wOTcgMCAwMS0yLjcwNSA0Ljc0Yy0uMTY5LjI5My0uMzguMzYzLS43MjUuMzY0LS45OTcuMDAzLTIuMDAyLjAwNC0zLjAxNy4wMDJhLjUzNy41MzcgMCAwMS0uNDY1LS4yNzFsLTEuMzM1LTIuMzIzYS4wOS4wOSAwIDAwLS4wODMtLjA0OUg0Ljk4MmMtLjI4NS4wMy0uNTUzLS4wMDEtLjgwNS0uMDkybC0xLjYwMy0yLjc3YS41NDMuNTQzIDAgMDEtLjAwMi0uNTRsMS4yMDctMi4xMmEuMTk4LjE5OCAwIDAwMC0uMTk3IDU1MC45NTEgNTUwLjk1MSAwIDAxLTEuODc1LTMuMjcybC0uNzktMS4zOTVjLS4xNi0uMzEtLjE3My0uNDk2LjA5NS0uOTY1LjQ2NS0uODEzLjkyNy0xLjYyNSAxLjM4Ny0yLjQzNi4xMzItLjIzNC4zMDQtLjMzNC41ODQtLjMzNWEzMzguMyAzMzguMyAwIDAxMi41ODktLjAwMS4xMjQuMTI0IDAgMDAuMTA3LS4wNjNsMi44MDYtNC44OTVhLjQ4OC40ODggMCAwMS40MjItLjI0NmMuNTI0LS4wMDEgMS4wNTMgMCAxLjU4My0uMDA2TDExLjcwNCAxYy4zNDEtLjAwMy43MjQuMDMyLjkuMzR6bS0zLjQzMi40MDNhLjA2LjA2IDAgMDAtLjA1Mi4wM0w2LjI1NCA2Ljc4OGEuMTU3LjE1NyAwIDAxLS4xMzUuMDc4SDMuMjUzYy0uMDU2IDAtLjA3LjAyNS0uMDQxLjA3NGw1LjgxIDEwLjE1NmMuMDI1LjA0Mi4wMTMuMDYyLS4wMzQuMDYzbC0yLjc5NS4wMTVhLjIxOC4yMTggMCAwMC0uMi4xMTZsLTEuMzIgMi4zMWMtLjA0NC4wNzgtLjAyMS4xMTguMDY4LjExOGw1LjcxNi4wMDhjLjA0NiAwIC4wOC4wMi4xMDQuMDYxbDEuNDAzIDIuNDU0Yy4wNDYuMDgxLjA5Mi4wODIuMTM5IDBsNS4wMDYtOC43Ni43ODMtMS4zODJhLjA1NS4wNTUgMCAwMS4wOTYgMGwxLjQyNCAyLjUzYS4xMjIuMTIyIDAgMDAuMTA3LjA2MmwyLjc2My0uMDJhLjA0LjA0IDAgMDAuMDM1LS4wMi4wNDEuMDQxIDAgMDAwLS4wNGwtMi45LTUuMDg2YS4xMDguMTA4IDAgMDEwLS4xMTNsLjI5My0uNTA3IDEuMTItMS45NzdjLjAyNC0uMDQxLjAxMi0uMDYyLS4wMzUtLjA2Mkg5LjJjLS4wNTkgMC0uMDczLS4wMjYtLjA0My0uMDc3bDEuNDM0LTIuNTA1YS4xMDcuMTA3IDAgMDAwLS4xMTRMOS4yMjUgMS43NzRhLjA2LjA2IDAgMDAtLjA1My0uMDMxem02LjI5IDguMDJjLjA0NiAwIC4wNTguMDIuMDM0LjA2bC0uODMyIDEuNDY1LTIuNjEzIDQuNTg1YS4wNTYuMDU2IDAgMDEtLjA1LjAyOS4wNTguMDU4IDAgMDEtLjA1LS4wMjlMOC40OTggOS44NDFjLS4wMi0uMDM0LS4wMS0uMDUyLjAyOC0uMDU0bC4yMTYtLjAxMiA2LjcyMi0uMDEyeiIgZmlsbD0idXJsKCNsb2JlLWljb25zLXF3ZW4tX1JfMF8pIiBmaWxsLXJ1bGU9Im5vbnplcm8iPjwvcGF0aD48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImxvYmUtaWNvbnMtcXdlbi1fUl8wXyIgeDE9IjAlIiB4Mj0iMTAwJSIgeTE9IjAlIiB5Mj0iMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM2MzM2RTciIHN0b3Atb3BhY2l0eT0iLjg0Ij48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjNkY2OUY3IiBzdG9wLW9wYWNpdHk9Ii44NCI+PC9zdG9wPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjwvc3ZnPg==",
  version: "1.0.0",
  readme: "使用阿里云百炼的 qwen-image-3.0-pro 出原画。请求地址填写兼容模式根地址即可。",
  rules,
  models: [
    {
      id: "qwen-image-3.0-pro",
      label: "Qwen Image 3.0 Pro",
      type: "image",
      mode: ["text", "multiReference"],
      imageSizes: ["2048x768", "1024x1024", "1344x768", "768x1024"],
      imageRatios: ["8:3", "1:1", "16:9", "3:4"],
    },
  ],
  async generateImage(this: Context, request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 Qwen 图像 API Key");
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error("请先填写图片提示词");
    const content: { image?: string; text?: string }[] = [];
    for (const image of request.images ?? []) content.push({ image: imageData(image) });
    content.push({ text: prompt });
    const response = await this.tool.fetch(generationUrl(this.config.baseUrl ?? ""), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: request.model,
        input: { messages: [{ role: "user", content }] },
        parameters: {
          n: 1,
          size: pixelSize(request.size, request.ratio),
          prompt_extend: false,
          watermark: false,
        },
      }),
      signal: this.signal,
    });
    if (!response.ok) throw new Error(this.tool.errorMessage(await response.json().catch(() => response.statusText)) || `Qwen 图像请求失败（HTTP ${response.status}）`);
    const data = await response.json() as {
      code?: string;
      message?: string;
      output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
      data?: { url?: string }[];
    };
    if (data.code) throw new Error(data.message || `Qwen 图像失败 ${data.code}`);
    const fromChoice = data.output?.choices?.[0]?.message?.content?.find(item => item.image)?.image;
    const url = fromChoice || data.data?.[0]?.url;
    if (!url) throw new Error("Qwen 图像未返回图片地址");
    return [{ type: "url", url, mimeType: "image/png", mediaType: "image" }];
  },
};
