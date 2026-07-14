export type ToolProperty = {
  type: string;
  description: string;
  default?: unknown;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: { type: "object"; required?: readonly string[]; properties: Record<string, ToolProperty> };
};

export const tools: ToolDefinition[] = [
  {
    name: "list_documents",
    description: "列出工作空间根目录中当前连接可访问的文档、表格和文件。",
    inputSchema: { type: "object", properties: { page_size: { type: "integer", minimum: 1, maximum: 200, default: 50, description: "返回条数，范围 1–200。" } } },
  },
  {
    name: "add_image_watermark",
    description: "给 JPEG、PNG 或 WebP 图片添加文字水印，并直接返回处理后的图片。",
    inputSchema: {
      type: "object",
      required: ["image_base64", "text"],
      properties: {
        image_base64: { type: "string", description: "原始图片的 Base64 数据，不含 data URL 前缀，最大 3 MB。" },
        text: { type: "string", maxLength: 200, description: "水印文字，最多 200 个字符。" },
        position: { type: "string", enum: ["northwest", "northeast", "center", "southwest", "southeast"], default: "southeast", description: "水印位置：左上、右上、居中、左下或右下。" },
        opacity: { type: "number", minimum: 0, maximum: 1, default: 0.35, description: "水印透明度，0 为完全透明，1 为完全不透明。" },
        font_size: { type: "integer", minimum: 8, maximum: 500, description: "字体大小；不传时按图片短边自动计算。" },
      },
    },
  },
  { name: "list_calendars", description: "列出当前连接可访问的日历。", inputSchema: { type: "object", properties: {} } },
  { name: "get_team_calendar", description: "查看团队共享日历及订阅方法；日历不存在时自动创建一个公开共享日历。", inputSchema: { type: "object", properties: {} } },
  { name: "get_current_time_and_team_calendar", description: "返回当前 Unix 秒时间戳、系统版本号、最近提交哈希、部署时间和团队共享日历信息；日历不存在时自动创建。", inputSchema: { type: "object", properties: {} } },
  {
    name: "list_calendar_events",
    description: "列出指定日历中的可见日程；未指定日历时使用团队共享日历。",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "日历 ID；可选，默认使用团队共享日历。" },
        start_time: { type: "string", description: "查询起始时间，Unix 秒时间戳。" },
        end_time: { type: "string", description: "查询结束时间，Unix 秒时间戳。" },
      },
    },
  },
  {
    name: "create_calendar_event",
    get description() { return `创建日程；未指定 calendar_id 时使用团队共享日历。当前上海日期是 ${new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())}；“今天”、“明天”等相对日期必须以此为准换算。`; },
    inputSchema: eventInputSchema(false),
  },
  { name: "update_calendar_event", description: "编辑指定日程；必须提供完整的标题和起止时间，未指定日历时使用团队共享日历。", inputSchema: eventInputSchema(true) },
  { name: "delete_calendar_event", description: "删除指定日程；未指定日历时使用团队共享日历。", inputSchema: { type: "object", required: ["event_id"], properties: { calendar_id: { type: "string", description: "日历 ID；可选，默认使用团队共享日历。" }, event_id: { type: "string", description: "要删除的日程 ID。" } } } },
  { name: "create_calendar", description: "创建一个共享日历。", inputSchema: calendarSchema(false) },
  { name: "update_calendar", description: "修改指定共享日历的名称、描述和权限。", inputSchema: calendarSchema(true) },
  { name: "delete_calendar", description: "删除指定共享日历。", inputSchema: { type: "object", required: ["calendar_id"], properties: { calendar_id: { type: "string", description: "要删除的日历 ID。" } } } },
  { name: "create_article", description: "创建一篇纯文本文档文章。", inputSchema: articleSchema(false) },
  { name: "get_article", description: "读取指定文章的标题和纯文本正文。", inputSchema: { type: "object", required: ["document_id"], properties: { document_id: { type: "string", description: "要读取的文档 ID。" } } } },
  { name: "update_article", description: "修改指定文章的标题和纯文本正文。", inputSchema: articleSchema(true) },
  { name: "delete_article", description: "删除指定文章。", inputSchema: { type: "object", required: ["document_id"], properties: { document_id: { type: "string", description: "要删除的文档 ID。" } } } },
];

function eventInputSchema(editing: boolean): ToolDefinition["inputSchema"] {
  return {
    type: "object",
    required: editing ? ["event_id", "summary", "start_time", "end_time"] : ["summary"],
    properties: {
      calendar_id: { type: "string", description: "日历 ID；可选，默认使用团队共享日历。" },
      ...(editing ? { event_id: { type: "string", description: "要编辑的日程 ID。" } } : {}),
      summary: { type: "string", description: "日程标题。" },
      description: { type: "string", description: "日程备注，可选。" },
      start_time: { type: "string", description: editing ? "开始时间，Unix 秒时间戳。" : "开始时间，Unix 秒时间戳；可选，默认当前时间后 1 小时。" },
      end_time: { type: "string", description: editing ? "结束时间，Unix 秒时间戳。" : "结束时间，Unix 秒时间戳；可选，默认开始时间后 2 小时。" },
      timezone: { type: "string", default: "Asia/Shanghai", description: "IANA 时区名称。" },
    },
  };
}

function calendarSchema(editing: boolean): ToolDefinition["inputSchema"] {
  return { type: "object", required: editing ? ["calendar_id", "summary"] : ["summary"], properties: { ...(editing ? { calendar_id: { type: "string", description: "要修改的日历 ID。" } } : {}), summary: { type: "string", description: "日历名称。" }, description: { type: "string", description: "日历描述，可选。" }, permissions: { type: "string", enum: ["private", "show_only_free_busy", "public"], default: "private", description: "日历权限：私密、仅显示忙闲或公开。" } } };
}

function articleSchema(editing: boolean): ToolDefinition["inputSchema"] {
  return { type: "object", required: editing ? ["document_id", "title"] : ["title"], properties: { ...(editing ? { document_id: { type: "string", description: "要修改的文档 ID。" } } : {}), title: { type: "string", description: "文章标题。" }, content: { type: "string", description: "纯文本正文，可选。" }, folder_token: { type: "string", description: "目标文件夹 token，可选。" } } };
}
