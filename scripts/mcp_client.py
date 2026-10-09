#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""极简 MCP 客户端（Streamable HTTP），只依赖标准库。

用于「麦门开饭 McRogue」拉取麦当劳 MCP 的真实数据。

用法：
    export MCD_MCP_TOKEN=xxx
    python mcp_client.py list-tools
    python mcp_client.py call now-time-info '{}'
    python mcp_client.py call query-nearby-stores '{"address":"杭州西湖"}'
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_URL = "https://mcp.mcd.cn"
PROTOCOL_VERSION = "2025-06-18"


class MCPError(RuntimeError):
    pass


class MCPClient:
    def __init__(self, token: str, url: str = DEFAULT_URL, timeout: int = 60):
        if not token:
            raise MCPError("缺少 Token：请设置环境变量 MCD_MCP_TOKEN")
        self.token = token
        self.url = url
        self.timeout = timeout
        self.session_id: str | None = None
        self._id = 0

    # -- 底层 ---------------------------------------------------------------
    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def _post(self, payload: dict, expect_response: bool = True) -> list[dict]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": "Bearer " + self.token,
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id

        req = urllib.request.Request(
            self.url, data=json.dumps(payload).encode("utf-8"),
            headers=headers, method="POST",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:400]
            except Exception:
                pass
            if e.code == 401:
                raise MCPError(f"401 未授权：Token 无效或已过期。{detail}") from e
            if e.code == 429:
                raise MCPError(f"429 触发限流（600 次/分钟），请退避重试。{detail}") from e
            raise MCPError(f"HTTP {e.code}: {detail}") from e

        sid = resp.headers.get("Mcp-Session-Id")
        if sid:
            self.session_id = sid
        body = resp.read().decode("utf-8", "replace")
        if not expect_response and not body.strip():
            return []
        return _parse_body(body)

    # -- 协议 ---------------------------------------------------------------
    def initialize(self) -> dict:
        msgs = self._post({
            "jsonrpc": "2.0", "id": self._next_id(), "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "mcd-rogue", "version": "0.1.0"},
            },
        })
        result = _first_result(msgs)
        # 完成握手通知（无响应）
        self._post(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            expect_response=False,
        )
        return result

    def list_tools(self) -> list[dict]:
        msgs = self._post({"jsonrpc": "2.0", "id": self._next_id(), "method": "tools/list"})
        return _first_result(msgs).get("tools", [])

    def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        msgs = self._post({
            "jsonrpc": "2.0", "id": self._next_id(), "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        })
        return _first_result(msgs)


# -- 解析 -------------------------------------------------------------------

def _parse_body(body: str) -> list[dict]:
    """兼容 JSON 与 text/event-stream 两种返回。"""
    text = body.strip()
    if not text:
        return []
    if text.startswith("{"):
        return [json.loads(text)]
    out: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            chunk = line[5:].strip()
            if chunk:
                try:
                    out.append(json.loads(chunk))
                except json.JSONDecodeError:
                    pass
    return out


def _first_result(msgs: list[dict]) -> dict:
    for m in msgs:
        if "error" in m:
            raise MCPError(f"JSON-RPC error: {json.dumps(m['error'], ensure_ascii=False)}")
        if "result" in m:
            return m["result"]
    raise MCPError("响应中没有 result 字段")


def _load_token() -> str:
    token = os.environ.get("MCD_MCP_TOKEN", "").strip()
    if token:
        return token
    # 允许从 .env.local 读取（该文件已被 .gitignore 忽略）
    here = os.path.dirname(os.path.abspath(__file__))
    for name in (".env.local", ".env"):
        p = os.path.join(os.path.dirname(here), name)
        if os.path.isfile(p):
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if line.startswith("MCD_MCP_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise MCPError("未找到 Token：请设置环境变量 MCD_MCP_TOKEN，或在仓库根目录放置 .env.local")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cli = MCPClient(_load_token())
    info = cli.initialize()
    server = info.get("serverInfo", {})
    cmd = argv[1]

    if cmd == "list-tools":
        tools = cli.list_tools()
        print(f"server: {server.get('name')} {server.get('version')}  工具数: {len(tools)}")
        for t in tools:
            print(f"  - {t['name']}")
        return 0

    if cmd == "call":
        if len(argv) < 3:
            print("用法: python mcp_client.py call <tool> '<json>'")
            return 2
        args = json.loads(argv[3]) if len(argv) > 3 else {}
        res = cli.call_tool(argv[2], args)
        print(json.dumps(res, ensure_ascii=False, indent=2)[:6000])
        return 0

    print(f"未知命令: {cmd}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
