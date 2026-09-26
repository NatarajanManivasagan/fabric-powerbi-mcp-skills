/*
 * list-mcp-tools.js — ask any stdio MCP server what tools it exposes.
 *
 *   node list-mcp-tools.js "npx -y @microsoft/powerbi-modeling-mcp@latest --start --readonly"
 *   node list-mcp-tools.js "C:/tools/powerbi-modeling-mcp.exe --readwrite"
 *   node list-mcp-tools.js "<any stdio MCP server command>" --full
 *
 * Speaks the raw MCP protocol: JSON-RPC 2.0 over stdio.
 *   initialize  ->  notifications/initialized  ->  tools/list
 *
 * Why not just `echo '{...}' | server`? The server exits when stdin closes,
 * which on a slow-booting server happens before it has answered. The stream
 * has to stay open, so this holds it.
 *
 * The `description` text this prints is exactly what the LLM reads when it
 * decides which tool to call. That text IS the routing logic.
 */
const { spawn } = require("child_process");

const cmd = process.argv[2] || "npx -y @microsoft/powerbi-modeling-mcp@latest --start --readonly";
const full = process.argv.includes("--full");

const p = spawn(cmd, { shell: true });
let buf = "";
let lastStderr = Date.now();
let sent = false;

p.stderr.on("data", () => { lastStderr = Date.now(); });

p.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.id === 1) {
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    }

    if (msg.id === 2 && msg.result && msg.result.tools) {
      const tools = msg.result.tools;
      console.log(`\n${tools.length} tools exposed by this server\n`);
      for (const t of tools) {
        const desc = (t.description || "").replace(/\s+/g, " ");
        console.log("  " + t.name);
        console.log("      " + (full ? desc : desc.slice(0, 110) + (desc.length > 110 ? "…" : "")));
        if (full && t.inputSchema) {
          const props = Object.keys(t.inputSchema.properties || {});
          if (props.length) console.log("      params: " + props.join(", "));
        }
        console.log("");
      }
      p.kill();
      process.exit(0);
    }
  }
});

// The server logs its boot to stderr. Send `initialize` once that goes quiet.
const tick = setInterval(() => {
  if (!sent && Date.now() - lastStderr > 4000) {
    sent = true;
    clearInterval(tick);
    p.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "list-mcp-tools", version: "1.0" },
      },
    }) + "\n");
  }
}, 1000);

setTimeout(() => {
  console.error("Timed out. The server never answered tools/list.");
  p.kill();
  process.exit(1);
}, 240000);
