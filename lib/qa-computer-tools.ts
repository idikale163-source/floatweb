// 工坊的「电脑」工具：小坊的云端工作机（用户自部署的 agent-computer Worker）。
// 只在设置里连接了角色电脑后才注入（getQaTools 里按 isAgentComputerConfigured 判断），
// 未配置时这些工具对模型完全不可见。
// 小坊固定使用 workshop 工作区，与各角色的电脑相互隔离。

import {
    WORKSHOP_WORKSPACE,
    agentComputerRequest,
} from "./agent-computer";

// 与 qa-agent-tools 的 QaTool 结构保持一致（避免循环依赖，重复声明最小形状）
type QaComputerTool = {
    name: string;
    nativeName: string;
    description: string;
    schemaLines: string[];
    parameters: Record<string, unknown>;
    run: (args: Record<string, unknown>) => Promise<string>;
};

function text(value: unknown, max = 4000): string {
    return typeof value === "string" ? value.slice(0, max).trim() : "";
}

const computerListTool: QaComputerTool = {
    name: "电脑列目录",
    nativeName: "computer_list_dir",
    description:
        "列出工作机（云端电脑）某个目录下的文件和子目录。工作机的硬盘是持久的，之前存的文件重启后还在。",
    schemaLines: [
        "  参数：",
        "    · path (可选) — 目录路径，默认根目录 /",
        '  调用：[执行动作:电脑列目录({"path":"/"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "目录路径，默认 /" },
        },
    },
    async run(args) {
        const path = text(args.path) || "/";
        const data = await agentComputerRequest<{ entries: Array<{ name: string; dir: boolean }> }>(
            "list", WORKSHOP_WORKSPACE, { path });
        if (!data.entries.length) return `${path} 是空目录。`;
        return `${path} 下共 ${data.entries.length} 项：\n` + data.entries
            .map(entry => `  ${entry.dir ? "📁" : "📄"} ${entry.name}`)
            .join("\n");
    },
};

const computerReadTool: QaComputerTool = {
    name: "电脑读文件",
    nativeName: "computer_read_file",
    description: "读取工作机上一个文本文件的内容。",
    schemaLines: [
        "  参数：",
        "    · path (必填) — 文件路径，如 /scripts/test.js",
        "    · maxChars (可选) — 最多读取的字符数",
        '  调用：[执行动作:电脑读文件({"path":"/notes.md"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "文件路径" },
            maxChars: { type: "number", description: "最多读取字符数" },
        },
        required: ["path"],
    },
    async run(args) {
        const path = text(args.path);
        if (!path) return "缺少 path。";
        const maxChars = typeof args.maxChars === "number" ? args.maxChars : undefined;
        const data = await agentComputerRequest<{ content: string; truncated: boolean }>(
            "read", WORKSHOP_WORKSPACE, { path, ...(maxChars ? { maxChars } : {}) });
        return `${path} 的内容：\n${data.content}${data.truncated ? "\n…（文件较长已截断，可用 maxChars 调整）" : ""}`;
    },
};

const computerWriteTool: QaComputerTool = {
    name: "电脑写文件",
    nativeName: "computer_write_file",
    description:
        "把内容写入工作机上的文件（整文件覆盖写入，父目录自动创建）。适合保存脚本、中间结果、要交付的文件。",
    schemaLines: [
        "  参数：",
        "    · path (必填) — 文件路径",
        "    · content (必填) — 完整文件内容",
        '  调用：[执行动作:电脑写文件({"path":"/scripts/clean.js","content":"…"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "文件路径" },
            content: { type: "string", description: "完整文件内容" },
        },
        required: ["path", "content"],
    },
    async run(args) {
        const path = text(args.path);
        if (!path) return "缺少 path。";
        const content = typeof args.content === "string" ? args.content : "";
        await agentComputerRequest("write", WORKSHOP_WORKSPACE, { path, content });
        return `✓ 已写入 ${path}（${content.length} 字符）。`;
    },
};

const computerExecTool: QaComputerTool = {
    name: "电脑执行命令",
    nativeName: "computer_exec",
    description:
        "在工作机上执行 shell 命令（ls/cat/grep/sed 等常用命令）。用于验证脚本、处理文本、检查文件。"
        + "注意：基础模式的电脑没有 shell（会返回明确提示），此时改用读写文件工具完成任务。",
    schemaLines: [
        "  参数：",
        "    · command (必填) — 要执行的命令",
        '  调用：[执行动作:电脑执行命令({"command":"ls /"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            command: { type: "string", description: "shell 命令" },
        },
        required: ["command"],
    },
    async run(args) {
        const command = text(args.command);
        if (!command) return "缺少 command。";
        try {
            const data = await agentComputerRequest<{ exitCode: number; stdout: string; stderr: string }>(
                "exec", WORKSHOP_WORKSPACE, { command });
            const parts = [`$ ${command}`, `退出码：${data.exitCode}`];
            if (data.stdout) parts.push(`stdout：\n${data.stdout}`);
            if (data.stderr) parts.push(`stderr：\n${data.stderr}`);
            if (!data.stdout && !data.stderr) parts.push("（无输出）");
            return parts.join("\n");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/shell 不可用|execution backend/i.test(message)) {
                return "这台工作机是基础模式（没有 shell），无法执行命令。请改用「电脑读文件/电脑写文件/电脑列目录」完成任务，需要计算或转换时在对话里自行完成后写回文件。";
            }
            throw err;
        }
    },
};

const computerDeleteTool: QaComputerTool = {
    name: "电脑删除文件",
    nativeName: "computer_delete",
    description: "删除工作机上的文件或目录（递归）。删前先用列目录确认路径，删掉就找不回来了。",
    schemaLines: [
        "  参数：",
        "    · path (必填) — 要删除的文件或目录",
        '  调用：[执行动作:电脑删除文件({"path":"/tmp-work"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "要删除的路径" },
        },
        required: ["path"],
    },
    async run(args) {
        const path = text(args.path);
        if (!path) return "缺少 path。";
        await agentComputerRequest("delete", WORKSHOP_WORKSPACE, { path });
        return `✓ 已删除 ${path}。`;
    },
};

export const QA_COMPUTER_TOOLS = [
    computerListTool,
    computerReadTool,
    computerWriteTool,
    computerExecTool,
    computerDeleteTool,
];
